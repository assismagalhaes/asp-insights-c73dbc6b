import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from scripts import replay_highlightly_dead_football_identity as replay


ROOT = Path(__file__).resolve().parents[1]
SCOPE = "future-20260727T1255-recovery"


def identity_job():
    return {
        "id": "job-1",
        "status": "dead",
        "sport": "football",
        "endpoint_key": replay.ENDPOINT,
        "last_error": (
            "Supabase returned HTTP 409: duplicate key value violates unique "
            "constraint sports_match_participants_match_team_unique"
        ),
        "attempts": 5,
        "max_attempts": 5,
        "request_params": {"date": "2026-07-31", "_fanout": True},
    }


class HighlightlyFootballIdentityReplayTests(unittest.TestCase):
    def test_migration_is_invoker_only_and_bounded(self):
        sql = (
            ROOT
            / "supabase/migrations/"
            "20260727173000_requeue_highlightly_dead_football_identity_jobs.sql"
        ).read_text(encoding="utf-8")
        normalized = sql.casefold()

        self.assertIn("security invoker", normalized)
        self.assertNotIn("security definer", normalized)
        self.assertIn("p_limit > 10", normalized)
        self.assertIn("sports_match_participants_match_team_unique", sql)
        self.assertIn("job.sport = 'football'", sql)
        self.assertIn("job.endpoint_key = 'football.matchescontroller_getmatches'", normalized)
        self.assertIn("from public, anon, authenticated", normalized)
        self.assertIn("to service_role", normalized)

    @patch.object(replay.HighlightlyRepository, "from_environment")
    def test_dry_run_identifies_exact_error_without_requeue(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.select_rows.side_effect = [
            [],
            [],
            [],
            [identity_job()],
        ]

        with patch("builtins.print") as output:
            exit_code = replay.main(["--scope", SCOPE, "--max-jobs", "1"])

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["mode"], "dry-run")
        self.assertEqual(report["eligible"], 1)

    @patch.object(replay, "HighlightlyClient")
    @patch.object(replay, "HighlightlyWorker")
    @patch.object(replay.HighlightlyRepository, "from_environment")
    def test_confirmed_replay_is_single_job_and_restores_provider(
        self,
        repository_factory,
        worker_factory,
        _client_factory,
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.side_effect = [
            {"provider": {"id": "provider-1", "enabled": False}},
            {"provider": {"id": "provider-1", "enabled": False}},
        ]
        repository.select_rows.side_effect = [
            [],
            [],
            [],
            [identity_job()],
            [],
        ]
        repository.daily_request_usage.side_effect = [500, 501]
        repository.rpc.side_effect = [
            [{"id": "job-1"}],
            {"scope": SCOPE, "status": "completed_with_exceptions"},
        ]
        worker_factory.return_value.run_once.return_value = SimpleNamespace(
            status="succeeded",
            job_id="job-1",
            records_received=10,
            records_normalized=9,
            records_rejected=1,
            message=None,
            __dict__={
                "status": "succeeded",
                "job_id": "job-1",
                "records_received": 10,
                "records_normalized": 9,
                "records_rejected": 1,
            },
        )

        with patch("builtins.print") as output:
            exit_code = replay.main(
                [
                    "--scope",
                    SCOPE,
                    "--max-jobs",
                    "1",
                    "--confirm-football-identity-replay",
                ]
            )

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_any_call(
            replay.REQUEUE_RPC,
            {"p_scope": SCOPE, "p_limit": 1},
        )
        self.assertEqual(
            worker_factory.call_args.kwargs["daily_quota_ceiling"],
            501,
        )
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["statuses"], ["succeeded"])
        self.assertEqual(
            report["recommended_action"],
            "football_identity_replay_complete",
        )


if __name__ == "__main__":
    unittest.main()
