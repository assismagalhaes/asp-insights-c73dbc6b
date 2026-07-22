import unittest
from unittest.mock import Mock, patch

from api.highlightly.worker import WorkerResult
from scripts import replay_highlightly_shadow_retries as replay


class HighlightlyShadowRetryReplayTests(unittest.TestCase):
    @patch.object(replay, "HighlightlyWorker")
    @patch.object(replay, "HighlightlyClient")
    @patch.object(replay, "HighlightlyRepository")
    def test_replays_saved_raw_without_adding_provider_requests(
        self,
        repository_factory,
        client_factory,
        worker_factory,
    ):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.ingestion_context.side_effect = [
            {"provider": {"id": "provider-1", "enabled": False}},
            {"provider": {"id": "provider-1", "enabled": False}},
        ]
        repository.select_rows.side_effect = [
            [],
            [{"id": "job-1", "endpoint_key": "football.OddsV2", "status": "retry"}],
            [{"id": "raw-1", "job_id": "job-1", "created_at": "2026-07-16T12:00:00Z"}],
        ]
        repository.daily_request_usage.side_effect = [237, 237]
        worker_factory.return_value.run_once.return_value = WorkerResult(
            status="succeeded",
            job_id="job-1",
        )
        argv = [
            "replay_highlightly_shadow_retries",
            "--scope", "scope-1",
            "--sport", "football",
            "--max-jobs", "50",
            "--confirm-raw-replay",
        ]

        with patch("sys.argv", argv), patch("builtins.print"):
            exit_code = replay.main()

        self.assertEqual(exit_code, 0)
        repository.upsert_rows.assert_called_once()
        replay_row = repository.upsert_rows.call_args.args[1][0]
        self.assertEqual(replay_row["reprocess_raw_object_id"], "raw-1")
        self.assertEqual(replay_row["priority"], 0)
        self.assertEqual(replay_row["scheduled_at"], "1970-01-01T00:00:00+00:00")
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        self.assertEqual(repository.daily_request_usage.call_count, 2)
        running_query = repository.select_rows.call_args_list[0]
        self.assertEqual(running_query.kwargs["order"], "lock_expires_at.desc")


if __name__ == "__main__":
    unittest.main()
