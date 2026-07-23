import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from api.highlightly.normalizers.baseball import normalize_baseball
from api.highlightly.normalizers.basketball import normalize_basketball
from api.highlightly.normalizers.common import NormalizationContext
from api.highlightly.normalizers.football import normalize_football
from api.highlightly.worker import WorkerResult
from scripts import run_highlightly_phase8d_odds_refresh as phase8d


PROVIDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
RAW_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
ROOT = Path(__file__).resolve().parents[1]


def context(sport: str):
    return NormalizationContext(
        provider_id=PROVIDER_ID,
        sport_id=SPORT_ID,
        sport=sport,
        endpoint_key=f"{sport}.odds",
        normalizer=f"{sport}.odds",
        request_params={"matchId": 99},
        raw_object_id=RAW_ID,
        captured_at="2026-07-23T12:00:00+00:00",
        bookmaker_ids={"bet365": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    )


class HighlightlyPhaseEightDOddsQualityTests(unittest.TestCase):
    def test_systemd_timer_is_frequent_and_shares_the_future_collection_lock(self):
        timer = (
            ROOT / "config/systemd/highlightly-odds-refresh.timer"
        ).read_text(encoding="utf-8")
        service = (
            ROOT / "config/systemd/highlightly-odds-refresh.service"
        ).read_text(encoding="utf-8")

        self.assertIn("*:00/15:00 America/Sao_Paulo", timer)
        self.assertIn("/run/lock/asp-highlightly-future.lock", service)
        self.assertIn("--confirm-odds-refresh", service)
        self.assertIn("--request-budget 750", service)

    def test_empty_provider_payload_is_classified_for_every_sport(self):
        for sport, normalizer in (
            ("football", normalize_football),
            ("baseball", normalize_baseball),
            ("basketball", normalize_basketball),
        ):
            with self.subTest(sport=sport):
                batch = normalizer(
                    {"data": [{"matchId": 99, "odds": []}]},
                    context(sport),
                )
                self.assertEqual(batch.odds_quotes, [])
                self.assertIn("ODDS_PROVIDER_EMPTY", {issue["code"] for issue in batch.issues})

    def test_non_preferred_bookmaker_has_a_stable_reason(self):
        payload = {
            "data": [
                {
                    "matchId": 99,
                    "odds": [
                        {
                            "bookmakerName": "Other Book",
                            "type": "prematch",
                            "market": "Full Time Result",
                            "values": [{"value": "Home", "odd": 2.1}],
                        }
                    ],
                }
            ]
        }

        batch = normalize_football(payload, context("football"))

        self.assertEqual(batch.odds_quotes, [])
        self.assertIn("ODDS_BOOKMAKER_MISSING", {issue["code"] for issue in batch.issues})

    def test_unsupported_market_has_a_stable_reason(self):
        payload = {
            "data": [
                {
                    "matchId": 99,
                    "odds": [
                        {
                            "bookmakerName": "bet365",
                            "type": "prematch",
                            "market": "Player To Score",
                            "values": [{"value": "Player", "odd": 2.1}],
                        }
                    ],
                }
            ]
        }

        batch = normalize_football(payload, context("football"))

        self.assertEqual(batch.odds_quotes, [])
        self.assertIn("ODDS_MARKET_MISSING", {issue["code"] for issue in batch.issues})

    @patch.object(phase8d.HighlightlyRepository, "from_environment")
    def test_dry_run_reads_candidates_without_enqueuing_or_calling_provider(
        self,
        repository_factory,
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.rpc.return_value = [
            {
                "match_id": "match-1",
                "sport": "basketball",
                "external_match_id": "99",
                "kickoff_at": "2026-07-23T18:00:00+00:00",
                "refresh_horizon": "t6h",
                "endpoint_key": "basketball.BasketballOddsController_getOddsV2",
                "dedupe_key": "phase8d:odds:basketball:99:1:t6h",
            }
        ]

        with patch("builtins.print") as output:
            exit_code = phase8d.main(
                ["--at", "2026-07-23T12:00:00+00:00", "--max-jobs", "20"]
            )

        self.assertEqual(exit_code, 0)
        repository.enqueue_job.assert_not_called()
        repository.set_provider_enabled.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "phase8d_odds_refresh_plan")
        self.assertEqual(report["by_horizon"], {"t6h": 1})
        self.assertTrue(report["odds_only"])

    @patch.object(phase8d, "_active_jobs")
    @patch.object(phase8d, "HighlightlyWorker")
    @patch.object(phase8d, "HighlightlyClient")
    @patch.object(phase8d.HighlightlyRepository, "from_environment")
    def test_confirmed_refresh_enqueues_only_odds_and_restores_provider(
        self,
        repository_factory,
        _client_factory,
        worker_factory,
        active_jobs,
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        candidate = {
            "match_id": "match-1",
            "sport": "football",
            "external_match_id": "99",
            "kickoff_at": "2026-07-24T12:00:00+00:00",
            "refresh_horizon": "t24h",
            "endpoint_key": "football.FootballOddsController_getOddsV2",
            "dedupe_key": "phase8d:odds:football:99:1:t24h",
        }
        repository.rpc.side_effect = [[candidate], {"by_sport": [], "by_cause": []}]
        repository.daily_request_usage.return_value = 100
        active_jobs.side_effect = [[], []]
        worker_factory.return_value.run_once.side_effect = [
            WorkerResult(status="succeeded"),
            WorkerResult(status="idle"),
        ]

        with patch("builtins.print"):
            exit_code = phase8d.main(
                [
                    "--at",
                    "2026-07-23T12:00:00+00:00",
                    "--max-jobs",
                    "20",
                    "--confirm-odds-refresh",
                ]
            )

        self.assertEqual(exit_code, 0)
        repository.enqueue_job.assert_called_once()
        enqueue = repository.enqueue_job.call_args.kwargs
        self.assertEqual(enqueue["resource"], "odds")
        self.assertEqual(enqueue["request_params"]["_phase8d_horizon"], "t24h")
        self.assertNotIn("_fanout", enqueue["request_params"])
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        self.assertEqual(worker_factory.call_args.kwargs["daily_quota_ceiling"], 850)

    @patch.object(phase8d, "_active_jobs")
    @patch.object(phase8d.HighlightlyRepository, "from_environment")
    def test_foreign_active_queue_is_not_interleaved(self, repository_factory, active_jobs):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.rpc.return_value = []
        active_jobs.return_value = [
            {"id": "job-1", "shadow_scope": "future-20260723T2210-night"}
        ]

        with patch("builtins.print") as output:
            exit_code = phase8d.main(
                ["--at", "2026-07-23T12:00:00+00:00", "--confirm-odds-refresh"]
            )

        self.assertEqual(exit_code, 0)
        repository.enqueue_job.assert_not_called()
        repository.set_provider_enabled.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["reason"], "active_foreign_queue")


if __name__ == "__main__":
    unittest.main()
