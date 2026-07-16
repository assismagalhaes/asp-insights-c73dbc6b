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
            [],
            [],
            [{"id": "raw-1", "job_id": "job-1", "captured_at": "2026-07-16T12:00:00Z"}],
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
        repository.patch_rows.assert_called_once()
        patch_values = repository.patch_rows.call_args.args[1]
        self.assertEqual(patch_values["reprocess_raw_object_id"], "raw-1")
        self.assertEqual(patch_values["priority"], 0)
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        self.assertEqual(repository.daily_request_usage.call_count, 2)


if __name__ == "__main__":
    unittest.main()
