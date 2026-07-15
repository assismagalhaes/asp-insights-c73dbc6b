import gzip
import hashlib
import json
import unittest

from api.highlightly_repository import (
    HighlightlyRepository,
    HighlightlyRepositoryError,
    redact_secrets,
)


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
        session = _Session([_Response(200), _Response(201, [saved]), _Response(200, content=compressed)])
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


if __name__ == "__main__":
    unittest.main()
