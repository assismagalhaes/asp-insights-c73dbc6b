import json
import unittest
from unittest.mock import Mock, patch

from api.highlightly.worker import WorkerResult, _retry_delay_seconds
from api.highlightly_client import HighlightlyError
from scripts import replay_highlightly_dead_521 as replay


class HighlightlyDead521ReplayTests(unittest.TestCase):
    def test_521_backoff_grows_without_exceeding_rpc_limit(self):
        error = HighlightlyError("edge unavailable", status=521)

        self.assertEqual(_retry_delay_seconds(error, 1), 300)
        self.assertEqual(_retry_delay_seconds(error, 2), 900)
        self.assertEqual(_retry_delay_seconds(error, 3), 2_700)
        self.assertEqual(_retry_delay_seconds(error, 9), 21_600)

    @patch.object(replay.HighlightlyRepository, "from_environment")
    def test_dry_run_identifies_only_exact_dead_521_jobs(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        candidate = {
            "id": "job-1",
            "status": "dead",
            "sport": "football",
            "endpoint_key": replay.ENDPOINT,
            "last_error": replay.ERROR,
            "attempts": 5,
            "max_attempts": 5,
        }
        repository.select_rows.side_effect = [[], [], [], [candidate]]

        with patch("sys.argv", ["replay", "--scope", "phase7-history"]), patch(
            "builtins.print"
        ) as output:
            exit_code = replay.main()

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_not_called()
        repository.set_provider_enabled.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["mode"], "dry-run")
        self.assertEqual(report["eligible"], 1)
        candidate_call = repository.select_rows.call_args_list[-1]
        self.assertEqual(candidate_call.kwargs["filters"]["last_error"], replay.ERROR)
        self.assertEqual(candidate_call.kwargs["filters"]["endpoint_key"], replay.ENDPOINT)

    @patch.object(replay, "HighlightlyWorker")
    @patch.object(replay, "HighlightlyClient")
    @patch.object(replay.HighlightlyRepository, "from_environment")
    def test_confirmed_canary_preserves_reserve_and_restores_provider(
        self, repository_factory, client_factory, worker_factory
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        candidate = {
            "id": "job-1",
            "status": "dead",
            "sport": "football",
            "endpoint_key": replay.ENDPOINT,
            "last_error": replay.ERROR,
            "attempts": 5,
            "max_attempts": 5,
        }
        repository.select_rows.side_effect = [
            [],
            [],
            [],
            [candidate],
            [],
            [],
        ]
        repository.daily_request_usage.side_effect = [100, 101]
        repository.rpc.return_value = [candidate]
        worker_factory.return_value.run_once.return_value = WorkerResult(
            status="succeeded", job_id="job-1", run_id="run-1"
        )

        with patch(
            "sys.argv",
            [
                "replay",
                "--scope",
                "phase7-history",
                "--max-jobs",
                "1",
                "--confirm-dead-521-replay",
            ],
        ), patch("builtins.print") as output:
            exit_code = replay.main()

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_called_once_with(
            "requeue_highlightly_dead_521_jobs",
            {"p_scope": "phase7-history", "p_limit": 1},
        )
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        self.assertEqual(worker_factory.call_args.kwargs["daily_quota_ceiling"], 101)
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["success_rate"], 1.0)
        self.assertEqual(report["recommended_action"], "continue_bounded_replay")


if __name__ == "__main__":
    unittest.main()
