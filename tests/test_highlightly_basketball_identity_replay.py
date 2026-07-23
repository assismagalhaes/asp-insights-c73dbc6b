import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from api.highlightly.worker import WorkerResult
from scripts import replay_highlightly_dead_basketball_identity as replay


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/20260723144147_requeue_highlightly_dead_basketball_identity_job.sql"
)
SMOKE = ROOT / "supabase/tests/highlightly_basketball_identity_requeue_smoke.sql"


def candidate(error: str | None = None):
    return {
        "id": "job-1",
        "status": "dead",
        "sport": "basketball",
        "endpoint_key": replay.ENDPOINT,
        "last_error": error
        or (
            'Supabase returned HTTP 409: duplicate key value violates unique constraint '
            '"sports_match_participants_match_team_unique"'
        ),
        "attempts": 5,
        "max_attempts": 5,
        "request_params": {"_fanout": True},
    }


class HighlightlyBasketballIdentityReplayTests(unittest.TestCase):
    def test_migration_is_narrow_invoker_and_service_role_only(self):
        sql = MIGRATION.read_text(encoding="utf-8").casefold()
        smoke = SMOKE.read_text(encoding="utf-8")

        self.assertIn("security invoker", sql)
        self.assertIn("sports_match_participants_match_team_unique", sql)
        self.assertIn("job.sport = 'basketball'", sql)
        self.assertIn(
            "job.endpoint_key = 'basketball.matchescontroller_getmatches'", sql
        )
        self.assertIn("job.status = 'dead'", sql)
        self.assertIn("max_attempts = 1", sql)
        self.assertIn("'{_fanout}'", sql)
        self.assertIn("from public, anon, authenticated", sql)
        self.assertIn("to service_role", sql)
        self.assertTrue(smoke.lstrip().startswith("BEGIN;"))
        self.assertTrue(smoke.rstrip().endswith("ROLLBACK;"))

    @patch.object(replay.HighlightlyRepository, "from_environment")
    def test_dry_run_selects_only_exact_identity_error(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.select_rows.side_effect = [
            [],
            [],
            [],
            [
                candidate(),
                candidate("Supabase returned HTTP 409: another constraint"),
            ],
        ]

        with patch(
            "sys.argv",
            ["replay", "--scope", "future-20260722T2210-night"],
        ), patch("builtins.print") as output:
            exit_code = replay.main()

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["mode"], "dry-run")
        self.assertEqual(report["eligible"], 1)

    @patch.object(replay, "HighlightlyWorker")
    @patch.object(replay, "HighlightlyClient")
    @patch.object(replay.HighlightlyRepository, "from_environment")
    def test_confirmed_replay_uses_one_call_restores_provider_and_finalizes(
        self, repository_factory, client_factory, worker_factory
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.select_rows.side_effect = [
            [],
            [],
            [],
            [candidate()],
            [],
        ]
        repository.daily_request_usage.side_effect = [200, 201]
        repository.rpc.side_effect = [[candidate()], {"status": "passed"}]
        worker_factory.return_value.run_once.return_value = WorkerResult(
            status="partial",
            job_id="job-1",
            run_id="run-1",
            records_rejected=1,
        )

        with patch(
            "sys.argv",
            [
                "replay",
                "--scope",
                "future-20260722T2210-night",
                "--confirm-basketball-identity-replay",
            ],
        ), patch("builtins.print") as output:
            exit_code = replay.main()

        self.assertEqual(exit_code, 0)
        requeue_call = repository.rpc.call_args_list[0]
        self.assertEqual(
            requeue_call.args[0],
            "requeue_highlightly_dead_basketball_identity_jobs",
        )
        self.assertEqual(
            requeue_call.args[1],
            {"p_scope": "future-20260722T2210-night", "p_limit": 1},
        )
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        self.assertEqual(worker_factory.call_args.kwargs["daily_quota_ceiling"], 201)
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["highlightly_requests_recorded"], 1)
        self.assertEqual(
            report["recommended_action"], "basketball_identity_replay_complete"
        )


if __name__ == "__main__":
    unittest.main()
