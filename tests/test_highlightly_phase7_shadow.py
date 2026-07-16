import json
import unittest
from datetime import date
from unittest.mock import Mock, patch

from api.highlightly.worker import WorkerResult
from scripts import run_highlightly_phase7_shadow as phase7


class HighlightlyPhaseSevenShadowTests(unittest.TestCase):
    def test_seed_plan_is_paginated_bounded_and_covers_all_sports(self):
        jobs = phase7.build_seed_jobs(
            scope="phase7-test",
            start_date=date(2026, 7, 15),
            days=2,
            sports=phase7.SPORTS,
            football_league_ids=(42, 84),
        )
        self.assertEqual(len(jobs), 8)
        self.assertEqual({job.sport for job in jobs}, set(phase7.SPORTS))
        self.assertTrue(all(job.request_params["limit"] == 10 for job in jobs))
        self.assertTrue(all(job.request_params["_fanout_scope"] == "phase7-test" for job in jobs))
        self.assertTrue(all("phase7-test" in job.dedupe_key for job in jobs))

    def test_football_requires_an_explicit_league_boundary(self):
        with self.assertRaisesRegex(ValueError, "all-football-leagues"):
            phase7.build_seed_jobs(
                scope="phase7-test",
                start_date=date(2026, 7, 15),
                days=1,
                sports=("football",),
                football_league_ids=(),
            )

    def test_all_football_leagues_uses_one_catalog_and_global_daily_matches(self):
        jobs = phase7.build_seed_jobs(
            scope="phase7-all-football",
            start_date=date(2026, 7, 15),
            days=2,
            sports=("football",),
            football_league_ids=(),
            all_football_leagues=True,
        )

        self.assertEqual(len(jobs), 3)
        catalog = jobs[0]
        self.assertEqual(catalog.endpoint_key, "football.LeaguesController_getLeagues")
        self.assertEqual(catalog.request_params["limit"], 100)
        self.assertEqual(catalog.request_params["_shadow_batch"], "2026-07-15")
        self.assertEqual(catalog.request_params["_pagination_priority"], 0)
        matches = jobs[1:]
        self.assertTrue(all(job.endpoint_key == "football.MatchesController_getMatches" for job in matches))
        self.assertTrue(all("leagueId" not in job.request_params for job in matches))
        self.assertTrue(all(job.request_params["limit"] == 10 for job in matches))
        self.assertTrue(all(job.request_params["_fanout"] for job in matches))

    def test_all_football_leagues_rejects_explicit_ids(self):
        with self.assertRaisesRegex(ValueError, "mutually exclusive"):
            phase7.build_seed_jobs(
                scope="phase7-invalid",
                start_date=date(2026, 7, 15),
                days=1,
                sports=("football",),
                football_league_ids=(42,),
                all_football_leagues=True,
            )

    @patch.object(phase7, "HighlightlyRepository")
    def test_dry_run_does_not_touch_supabase_or_highlightly(self, repository_factory):
        argv = [
            "run_highlightly_phase7_shadow",
            "--scope",
            "phase7-dry",
            "--data-start",
            "2026-07-15",
            "--sport",
            "baseball",
        ]
        with patch("sys.argv", argv), patch("builtins.print") as output:
            exit_code = phase7.main()

        self.assertEqual(exit_code, 0)
        repository_factory.from_environment.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["mode"], "dry-run")
        self.assertEqual(report["seed_jobs"], 1)

    @patch.object(phase7, "HighlightlyRepository")
    def test_all_football_dry_run_is_global_and_does_not_touch_supabase(
        self, repository_factory
    ):
        argv = [
            "run_highlightly_phase7_shadow",
            "--scope",
            "phase7-all-dry",
            "--data-start",
            "2026-07-15",
            "--all-football-leagues",
        ]
        with patch("sys.argv", argv), patch("builtins.print") as output:
            exit_code = phase7.main()

        self.assertEqual(exit_code, 0)
        repository_factory.from_environment.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertTrue(report["all_football_leagues"])
        football_matches = [
            job
            for job in report["jobs"]
            if job["endpoint_key"] == "football.MatchesController_getMatches"
        ]
        self.assertEqual(len(football_matches), 1)
        self.assertNotIn("leagueId", football_matches[0]["request_params"])

    @patch.object(phase7, "HighlightlyWorker")
    @patch.object(phase7, "HighlightlyClient")
    @patch.object(phase7, "HighlightlyRepository")
    def test_confirmed_slice_restores_provider_and_preserves_reserve(
        self,
        repository_factory,
        client_factory,
        worker_factory,
    ):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        context = {
            "provider": {
                "id": "provider-1",
                "enabled": False,
                "contract_version": "6.13.2",
            },
            "sport": {"id": "sport-1"},
            "bookmakers": [],
        }
        repository.ingestion_context.return_value = context
        repository.select_rows.side_effect = [
            [],
            [],
            [],
            [],
            [{"id": "window-1", "scope": "phase7-live", "status": "running"}],
            [],
            [],
            [],
            [{"window_id": "window-1", "gate_status": "collecting"}],
        ]
        repository.daily_request_usage.return_value = 5_000
        repository.upsert_rows.return_value = [
            {"id": "window-1", "scope": "phase7-live", "status": "running"}
        ]
        repository.rpc.side_effect = [
            {"expected_matches": 5},
            {"matches_expected": 5, "matches_seen": 5},
        ]
        worker_factory.return_value.run_once.return_value = WorkerResult(status="idle")
        argv = [
            "run_highlightly_phase7_shadow",
            "--scope",
            "phase7-live",
            "--data-start",
            "2026-07-15",
            "--sport",
            "baseball",
            "--confirm-phase7-shadow",
        ]

        with patch("sys.argv", argv), patch("builtins.print"):
            exit_code = phase7.main()

        self.assertEqual(exit_code, 0)
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        self.assertEqual(worker_factory.call_args.kwargs["daily_quota_ceiling"], 6_500)
        self.assertLessEqual(
            worker_factory.call_args.kwargs["daily_quota_ceiling"],
            phase7.DAILY_LIMIT - phase7.RESERVE_REQUESTS,
        )


if __name__ == "__main__":
    unittest.main()
