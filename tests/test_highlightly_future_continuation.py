import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from scripts import run_highlightly_future_continuation as continuation


class HighlightlyFutureContinuationTests(unittest.TestCase):
    def test_systemd_services_share_lock_and_timer_retries_every_five_minutes(self):
        root = Path(__file__).resolve().parents[1]
        window_service = (
            root / "config/systemd/highlightly-future-window.service"
        ).read_text(encoding="utf-8")
        continuation_service = (
            root / "config/systemd/highlightly-future-continuation.service"
        ).read_text(encoding="utf-8")
        continuation_timer = (
            root / "config/systemd/highlightly-future-continuation.timer"
        ).read_text(encoding="utf-8")

        lock_path = "/run/lock/asp-highlightly-future.lock"
        self.assertIn(lock_path, window_service)
        self.assertIn(lock_path, continuation_service)
        self.assertIn("--conflict-exit-code 0", window_service)
        self.assertIn("--conflict-exit-code 0", continuation_service)
        self.assertIn("OnUnitInactiveSec=5min", continuation_timer)

    def test_available_requests_preserves_contractual_reserve(self):
        self.assertEqual(continuation.available_requests(0), 6_750)
        self.assertEqual(continuation.available_requests(2_500), 4_250)
        self.assertEqual(continuation.available_requests(6_750), 0)
        self.assertEqual(continuation.available_requests(7_500), 0)

    def test_scope_must_be_one_canonical_future_scope(self):
        self.assertEqual(
            continuation.resolve_future_scope(
                [
                    {"shadow_scope": "future-20260722T2210-night"},
                    {"shadow_scope": "future-20260722T2210-night"},
                ]
            ),
            "future-20260722T2210-night",
        )
        with self.assertRaisesRegex(RuntimeError, "more than one"):
            continuation.resolve_future_scope(
                [
                    {"shadow_scope": "future-one"},
                    {"shadow_scope": "future-two"},
                ]
            )
        with self.assertRaisesRegex(RuntimeError, "non-future"):
            continuation.resolve_future_scope(
                [{"shadow_scope": "phase7-20260701-15-all-sports"}]
            )

    @patch.object(continuation.HighlightlyRepository, "from_environment")
    def test_dry_run_does_not_touch_database(self, repository_factory):
        with patch("builtins.print") as output:
            exit_code = continuation.main([])

        self.assertEqual(exit_code, 0)
        repository_factory.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "future_continuation_plan")
        self.assertEqual(report["reserve_requests"], 750)

    @patch.object(continuation, "_active_jobs")
    @patch.object(continuation.HighlightlyRepository, "from_environment")
    def test_idle_queue_retries_unfinished_future_finalization(
        self,
        repository_factory,
        active_jobs,
    ):
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.select_rows.return_value = [
            {
                "id": "window-1",
                "scope": "future-20260722T2210-night",
                "status": "running",
                "config": {"window_kind": "future"},
            }
        ]
        repository.rpc.return_value = {
            "scope": "future-20260722T2210-night",
            "status": "completed",
        }
        repository_factory.return_value = repository
        active_jobs.return_value = []

        with patch("builtins.print") as output:
            exit_code = continuation.main(["--confirm-continuation"])

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_called_once_with(
            "finalize_highlightly_shadow_window",
            {"p_scope": "future-20260722T2210-night"},
        )
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "future_continuation_finalized_idle")
        self.assertEqual(len(report["finalized_windows"]), 1)

    @patch.object(continuation, "_active_jobs")
    @patch.object(continuation.HighlightlyRepository, "from_environment")
    def test_exhausted_quota_waits_without_enabling_provider(
        self,
        repository_factory,
        active_jobs,
    ):
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.daily_request_usage.return_value = 6_750
        repository_factory.return_value = repository
        active_jobs.return_value = [
            {
                "id": "job-1",
                "status": "pending",
                "shadow_scope": "future-20260722T2210-night",
            }
        ]

        with patch("builtins.print") as output:
            exit_code = continuation.main(["--confirm-continuation"])

        self.assertEqual(exit_code, 0)
        repository.set_provider_enabled.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "future_continuation_waiting_quota")
        self.assertEqual(report["requests_available"], 0)

    @patch.object(continuation, "HighlightlyClient")
    @patch.object(continuation, "HighlightlyWorker")
    @patch.object(continuation, "_active_jobs")
    @patch.object(continuation.HighlightlyRepository, "from_environment")
    def test_continuation_drains_scope_and_finalizes_window(
        self,
        repository_factory,
        active_jobs,
        worker_class,
        _client_class,
    ):
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.daily_request_usage.side_effect = [2_500, 2_501]
        repository.select_rows.return_value = [
            {
                "id": "window-1",
                "scope": "future-20260722T2210-night",
                "status": "running",
                "config": {"window_kind": "future"},
            }
        ]
        repository.rpc.return_value = [{
            "scope": "future-20260722T2210-night",
            "status": "completed",
        }]
        repository_factory.return_value = repository
        active_jobs.side_effect = [
            [
                {
                    "id": "job-1",
                    "status": "pending",
                    "shadow_scope": "future-20260722T2210-night",
                }
            ],
            [],
        ]
        worker = worker_class.return_value
        worker.run_once.side_effect = [
            SimpleNamespace(
                status="succeeded",
                message=None,
                job_id="job-1",
            ),
            SimpleNamespace(
                status="idle",
                message=None,
                job_id=None,
            ),
        ]

        with patch("builtins.print") as output:
            exit_code = continuation.main(["--confirm-continuation"])

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            worker_class.call_args.kwargs["daily_quota_ceiling"],
            6_750,
        )
        self.assertEqual(
            repository.set_provider_enabled.call_args_list[0].args,
            ("highlightly", True),
        )
        self.assertEqual(
            repository.set_provider_enabled.call_args_list[-1].args,
            ("highlightly", False),
        )
        repository.rpc.assert_called_once_with(
            "finalize_highlightly_shadow_window",
            {"p_scope": "future-20260722T2210-night"},
        )
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "future_continuation_completed")
        self.assertEqual(report["active_after"], 0)
        self.assertTrue(report["provider_restored_disabled"])
        self.assertEqual(len(report["finalized_windows"]), 1)


if __name__ == "__main__":
    unittest.main()
