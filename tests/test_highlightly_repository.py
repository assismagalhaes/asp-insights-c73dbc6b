import gzip
import hashlib
import hmac
import json
import os
import unittest
from unittest.mock import patch

from api.highlightly_repository import (
    HighlightlyRepository,
    HighlightlyRepositoryError,
    redact_secrets,
)
from api.highlightly.worker import _safe_error


class _Response:
    def __init__(self, status_code=200, body=None, content=None):
        self.status_code = status_code
        self._body = body
        self.content = content if content is not None else (json.dumps(body).encode() if body is not None else b"")
        self.text = self.content.decode(errors="replace")

    def json(self):
        return self._body


class _Session:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.responses.pop(0)


class HighlightlyRepositoryTests(unittest.TestCase):
    def test_safe_error_preserves_structured_postgrest_conflict_details(self):
        error = HighlightlyRepositoryError(
            "Supabase returned HTTP 409",
            status=409,
            body={"code": "23505", "message": "duplicate country code", "api_key": "must-not-leak"},
        )
        message = _safe_error(error)
        self.assertIn('"code":"23505"', message)
        self.assertIn("duplicate country code", message)
        self.assertNotIn("must-not-leak", message)

    def test_bridge_signs_and_forwards_without_service_role_key(self):
        session = _Session([_Response(200, [{"id": "team-1"}])])
        secret = "bridge-secret-with-at-least-32-characters"
        repository = HighlightlyRepository(
            "",
            "",
            session=session,
            bridge_url="https://app.example.com/api/public/hooks/highlightly-ingest",
            bridge_secret=secret,
        )

        with patch("api.highlightly_repository.time.time", return_value=1_784_150_000), patch(
            "api.highlightly_repository.secrets.token_hex",
            return_value="0123456789abcdef0123456789abcdef",
        ):
            saved = repository.upsert_rows(
                "sports_teams",
                [{"id": "team-1"}],
                on_conflict="id",
            )

        self.assertEqual(saved, [{"id": "team-1"}])
        method, url, kwargs = session.calls[0]
        self.assertEqual(method, "POST")
        self.assertEqual(url, "https://app.example.com/api/public/hooks/highlightly-ingest")
        body = b'[{"id":"team-1"}]'
        self.assertEqual(kwargs["data"], body)
        headers = kwargs["headers"]
        self.assertNotIn("apikey", headers)
        self.assertNotIn("authorization", headers)
        self.assertEqual(headers["x-highlightly-forward-method"], "POST")
        self.assertEqual(
            headers["x-highlightly-forward-path"],
            "/rest/v1/sports_teams?on_conflict=id",
        )
        forward_headers = {
            "content-type": "application/json",
            "prefer": "resolution=merge-duplicates,return=representation",
        }
        signature_input = repository._bridge_signature_input(
            "1784150000",
            "0123456789abcdef0123456789abcdef",
            "POST",
            "/rest/v1/sports_teams?on_conflict=id",
            forward_headers,
            body,
        )
        expected = hmac.new(secret.encode(), signature_input, hashlib.sha256).hexdigest()
        self.assertEqual(headers["x-highlightly-signature"], expected)
        self.assertEqual(
            headers["x-highlightly-forward-prefer"],
            "resolution=merge-duplicates,return=representation",
        )

    def test_from_environment_accepts_bridge_only_configuration(self):
        environment = {
            "HIGHLIGHTLY_INGEST_BRIDGE_URL": "https://app.example.com/api/public/hooks/highlightly-ingest",
            "HIGHLIGHTLY_INGEST_BRIDGE_SECRET": "a" * 32,
        }
        with patch.dict(os.environ, environment, clear=True):
            repository = HighlightlyRepository.from_environment(session=_Session([]))
        self.assertEqual(repository.supabase_url, "")
        self.assertEqual(repository.service_role_key, "")
        self.assertEqual(repository.bridge_secret, "a" * 32)

    def test_bridge_rejects_partial_or_insecure_configuration(self):
        with self.assertRaises(ValueError):
            HighlightlyRepository("", "", bridge_url="https://app.example.com/hook")
        with self.assertRaises(ValueError):
            HighlightlyRepository(
                "",
                "",
                bridge_url="http://app.example.com/hook",
                bridge_secret="a" * 32,
            )

    def test_idempotent_get_retries_transient_bridge_error_with_fresh_nonce(self):
        session = _Session([_Response(503, {"message": "unavailable"}), _Response(200, [{"id": "1"}])])
        repository = HighlightlyRepository(
            "",
            "",
            session=session,
            bridge_url="https://app.example.com/api/public/hooks/highlightly-ingest",
            bridge_secret="a" * 32,
        )

        with patch("api.highlightly_repository.time.sleep") as sleep, patch(
            "api.highlightly_repository.secrets.token_hex",
            side_effect=["1" * 32, "2" * 32],
        ):
            rows = repository.select_rows("sports_teams", filters={"id": "1"})

        self.assertEqual(rows, [{"id": "1"}])
        self.assertEqual(len(session.calls), 2)
        self.assertEqual(
            [call[2]["headers"]["x-highlightly-nonce"] for call in session.calls],
            ["1" * 32, "2" * 32],
        )
        sleep.assert_called_once_with(1.0)

    def test_idempotent_upsert_and_patch_retry_transient_gateway_errors(self):
        session = _Session(
            [
                _Response(502, {"message": "bad gateway"}),
                _Response(201, [{"id": "team-1"}]),
                _Response(503, {"message": "unavailable"}),
                _Response(200, [{"code": "highlightly", "enabled": False}]),
            ]
        )
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        with patch("api.highlightly_repository.time.sleep") as sleep:
            saved = repository.upsert_rows("sports_teams", [{"id": "team-1"}], on_conflict="id")
            provider = repository.set_provider_enabled("highlightly", False)

        self.assertEqual(saved, [{"id": "team-1"}])
        self.assertFalse(provider["enabled"])
        self.assertEqual(len(session.calls), 4)
        self.assertEqual(sleep.call_count, 2)

    def test_rpc_is_not_retried_because_effect_may_be_ambiguous(self):
        session = _Session([_Response(503, {"message": "unavailable"})])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        with patch("api.highlightly_repository.time.sleep") as sleep:
            with self.assertRaisesRegex(HighlightlyRepositoryError, "HTTP 503"):
                repository.rpc("claim_highlightly_ingestion_job", {"p_worker_id": "worker-1"})

        self.assertEqual(len(session.calls), 1)
        sleep.assert_not_called()

    def test_redacts_credentials_recursively(self):
        clean = redact_secrets(
            {"query": {"teamId": 7}, "headers": {"x-api-key": "secret", "Authorization": "Bearer secret"}}
        )
        self.assertEqual(clean["query"]["teamId"], 7)
        self.assertEqual(clean["headers"]["x-api-key"], "[REDACTED]")
        self.assertEqual(clean["headers"]["Authorization"], "[REDACTED]")

    def test_enqueue_uses_service_role_rpc_and_redacted_params(self):
        session = _Session([_Response(200, {"id": "job-1", "status": "pending"})])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        row = repository.enqueue_job(
            endpoint_key="football.matches",
            sport="football",
            resource="matches",
            dedupe_key="football:matches:2026-07-14",
            request_params={"date": "2026-07-14", "api_key": "must-not-leak"},
        )

        self.assertEqual(row["id"], "job-1")
        method, url, kwargs = session.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/rest/v1/rpc/enqueue_highlightly_ingestion_job"))
        self.assertEqual(kwargs["json"]["p_request_params"]["api_key"], "[REDACTED]")
        self.assertEqual(kwargs["headers"]["apikey"], "service-secret")

    def test_claim_returns_none_for_empty_queue(self):
        session = _Session([_Response(200, [])])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)
        self.assertIsNone(repository.claim_job("worker-a"))

    def test_ensure_raw_bucket_creates_missing_private_bucket(self):
        session = _Session(
            [
                _Response(404, {"message": "not found"}),
                _Response(200, {"name": "highlightly-raw"}),
            ]
        )
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        result = repository.ensure_raw_bucket()

        self.assertTrue(result["created"])
        method, url, kwargs = session.calls[1]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/storage/v1/bucket"))
        self.assertFalse(kwargs["json"]["public"])
        self.assertEqual(kwargs["json"]["file_size_limit"], 26_214_400)
        self.assertIn("application/gzip", kwargs["json"]["allowed_mime_types"])

    def test_ensure_raw_bucket_reconciles_public_or_misconfigured_bucket(self):
        session = _Session(
            [
                _Response(
                    200,
                    {
                        "id": "highlightly-raw",
                        "public": True,
                        "file_size_limit": 100,
                        "allowed_mime_types": ["application/json"],
                    },
                ),
                _Response(200, {"message": "Successfully updated"}),
            ]
        )
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        result = repository.ensure_raw_bucket()

        self.assertTrue(result["updated"])
        method, url, kwargs = session.calls[1]
        self.assertEqual(method, "PUT")
        self.assertTrue(url.endswith("/storage/v1/bucket/highlightly-raw"))
        self.assertFalse(kwargs["json"]["public"])

    def test_ensure_raw_bucket_is_noop_when_configuration_matches(self):
        session = _Session(
            [
                _Response(
                    200,
                    {
                        "id": "highlightly-raw",
                        "public": False,
                        "file_size_limit": 26_214_400,
                        "allowed_mime_types": [
                            "application/x-gzip",
                            "application/json",
                            "application/gzip",
                        ],
                    },
                )
            ]
        )
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        result = repository.ensure_raw_bucket()

        self.assertEqual(result, {"created": False, "updated": False, "bucket": "highlightly-raw"})
        self.assertEqual(len(session.calls), 1)

    def test_raw_payload_round_trip_is_gzipped_and_checksum_verified(self):
        payload = {"data": [{"id": 10, "name": "São Paulo"}]}
        canonical = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        compressed = gzip.compress(canonical, mtime=0)
        digest = hashlib.sha256(canonical).hexdigest()
        saved = {
            "id": "raw-1",
            "storage_bucket": "highlightly-raw",
            "storage_path": f"football/2026/07/14/matches/{digest}.json.gz",
            "sha256": digest,
            "byte_size": len(compressed),
        }
        # PostgREST returns 200 when the content-addressed raw object already exists.
        session = _Session([_Response(200), _Response(200, [saved]), _Response(200, content=compressed)])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        raw_object = repository.store_raw_payload(
            payload,
            provider_id="provider-1",
            sport_id="sport-1",
            sport="football",
            endpoint_key="football.matches",
            request_metadata={"apiKey": "secret", "date": "2026-07-14"},
        )
        restored = repository.load_raw_payload(
            {
                "storage_bucket": raw_object.storage_bucket,
                "storage_path": raw_object.storage_path,
                "content_encoding": "gzip",
                "sha256": raw_object.sha256,
            }
        )

        self.assertEqual(restored, payload)
        upload_call = session.calls[0]
        self.assertEqual(upload_call[2]["data"], compressed)
        registry_call = session.calls[1]
        self.assertEqual(registry_call[2]["json"]["request_metadata"]["apiKey"], "[REDACTED]")
        self.assertIn("on_conflict=storage_bucket%2Cstorage_path", registry_call[1])

    def test_checksum_mismatch_stops_reprocessing(self):
        compressed = gzip.compress(b'{"data":[]}', mtime=0)
        session = _Session([_Response(200, content=compressed)])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        with self.assertRaises(HighlightlyRepositoryError):
            repository.load_raw_payload(
                {
                    "storage_path": "football/raw.json.gz",
                    "content_encoding": "gzip",
                    "sha256": "0" * 64,
                }
            )

    def test_reprocess_dedupe_includes_normalizer_version(self):
        session = _Session([_Response(200, {"id": "job-2"})])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)
        repository.enqueue_reprocess(
            {"id": "raw-1", "sport": "baseball", "endpoint_key": "baseball.matches"},
            normalizer_version="matches-v2",
        )
        payload = session.calls[0][2]["json"]
        self.assertEqual(payload["p_dedupe_key"], "reprocess:raw-1:matches-v2")
        self.assertEqual(payload["p_reprocess_raw_object_id"], "raw-1")

    def test_batch_upsert_is_chunked_and_uses_explicit_conflict_target(self):
        session = _Session([
            _Response(201, [{"id": "1"}, {"id": "2"}]),
            _Response(201, [{"id": "3"}]),
        ])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)
        saved = repository.upsert_rows(
            "sports_teams",
            [{"id": "1"}, {"id": "2"}, {"id": "3"}],
            on_conflict="id",
            chunk_size=2,
        )
        self.assertEqual([row["id"] for row in saved], ["1", "2", "3"])
        self.assertEqual(len(session.calls), 2)
        self.assertIn("on_conflict=id", session.calls[0][1])
        self.assertIn("resolution=merge-duplicates", session.calls[0][2]["headers"]["prefer"])

    def test_batch_upsert_merges_duplicate_conflict_targets_before_posting(self):
        session = _Session([_Response(201, [{"id": "1", "name": "latest", "metadata": {"a": 1}}])])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        saved = repository.upsert_rows(
            "sports_teams",
            [
                {"id": "1", "name": "first", "metadata": {"a": 1}},
                {"id": "1", "name": "latest"},
            ],
            on_conflict="id",
        )

        self.assertEqual(saved[0]["name"], "latest")
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(
            session.calls[0][2]["json"],
            [{"id": "1", "name": "latest", "metadata": {"a": 1}}],
        )

    def test_batch_upsert_splits_heterogeneous_rows_without_padding_nulls(self):
        session = _Session(
            [
                _Response(201, [{"id": "1"}, {"id": "3"}]),
                _Response(201, [{"id": "2", "metadata": {"side": "home"}}]),
            ]
        )
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        repository.upsert_rows(
            "sports_lineup_players",
            [
                {"id": "1", "role": "starter"},
                {"id": "2", "role": "starter", "metadata": {"side": "home"}},
                {"id": "3", "role": "substitute"},
            ],
            on_conflict="id",
        )

        self.assertEqual(len(session.calls), 2)
        for _, _, kwargs in session.calls:
            shapes = {tuple(sorted(row)) for row in kwargs["json"]}
            self.assertEqual(len(shapes), 1)
        self.assertNotIn("metadata", session.calls[0][2]["json"][0])

    def test_bulk_odds_writer_uses_one_rpc_per_chunk(self):
        session = _Session([_Response(200, [{"id": "q1"}, {"id": "q2"}])])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)
        saved = repository.upsert_odds_quotes([{"p_selection_key": "home"}, {"p_selection_key": "away"}])
        self.assertEqual(len(saved), 2)
        method, url, kwargs = session.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/rest/v1/rpc/upsert_sports_odds_quotes"))
        self.assertEqual(len(kwargs["json"]["p_quotes"]), 2)

    def test_bulk_odds_writer_keeps_latest_duplicate_quote(self):
        session = _Session([_Response(200, [{"id": "q1", "decimal_odds": 2.2}])])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)
        identity = {
            "p_match_id": "match-1",
            "p_bookmaker_id": "bookmaker-1",
            "p_market_definition_id": "market-1",
            "p_selection_key": "home",
            "p_line_key": "",
            "p_is_live": False,
        }

        repository.upsert_odds_quotes(
            [
                {**identity, "p_decimal_odds": 2.0},
                {**identity, "p_decimal_odds": 2.2},
            ]
        )

        quotes = session.calls[0][2]["json"]["p_quotes"]
        self.assertEqual(len(quotes), 1)
        self.assertEqual(quotes[0]["p_decimal_odds"], 2.2)

    def test_refresh_odds_consensus_uses_bounded_preferred_bookmaker_defaults(self):
        session = _Session([_Response(200, 3)])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)
        refreshed = repository.refresh_odds_consensus(
            "30000000-0000-4000-8000-000000000006",
            snapshot_at="2026-07-15T20:05:00Z",
        )
        self.assertEqual(refreshed, 3)
        method, url, kwargs = session.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/rest/v1/rpc/refresh_sports_odds_consensus"))
        self.assertEqual(kwargs["json"]["p_min_bookmakers"], 2)
        self.assertEqual(kwargs["json"]["p_max_bookmakers"], 7)

    def test_refresh_odds_consensus_rejects_bookmaker_bounds_outside_two_to_seven(self):
        session = _Session([])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)
        with self.assertRaisesRegex(ValueError, "min_bookmakers"):
            repository.refresh_odds_consensus(
                "30000000-0000-4000-8000-000000000006",
                min_bookmakers=1,
            )
        with self.assertRaisesRegex(ValueError, "max_bookmakers"):
            repository.refresh_odds_consensus(
                "30000000-0000-4000-8000-000000000006",
                max_bookmakers=8,
            )
        self.assertEqual(session.calls, [])

    def test_provider_kill_switch_requires_exactly_one_confirmed_row(self):
        session = _Session([_Response(200, [{"code": "highlightly", "enabled": True}])])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)
        row = repository.set_provider_enabled("highlightly", True)
        self.assertTrue(row["enabled"])
        method, url, kwargs = session.calls[0]
        self.assertEqual(method, "PATCH")
        self.assertIn("code=eq.highlightly", url)
        self.assertEqual(kwargs["json"], {"enabled": True})

    def test_daily_request_usage_is_aggregated_by_rpc_without_rest_row_cap(self):
        session = _Session([_Response(200, 1_108)])
        repository = HighlightlyRepository("https://example.supabase.co", "service-secret", session=session)

        usage = repository.daily_request_usage("provider-1", "2026-07-17")

        self.assertEqual(usage, 1_108)
        method, url, kwargs = session.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/rest/v1/rpc/get_highlightly_daily_request_usage"))
        self.assertEqual(
            kwargs["json"],
            {"p_provider_id": "provider-1", "p_request_date": "2026-07-17"},
        )


if __name__ == "__main__":
    unittest.main()
