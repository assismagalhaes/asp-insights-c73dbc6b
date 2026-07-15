import unittest
from unittest.mock import Mock, patch

from api.highlightly.worker import WorkerResult
from scripts import drain_highlightly_shadow_queue as drain


class HighlightlyShadowDrainTests(unittest.TestCase):
    @staticmethod
    def _context():
        return {
            "provider": {"id": "provider-1", "enabled": False},
            "sport": {"id": "sport-1"},
            "bookmakers": [],
        }

    @patch.object(drain, "HighlightlyWorker")
    @patch.object(drain, "HighlightlyClient")
    @patch.object(drain, "HighlightlyRepository")
    def test_bounded_drain_restores_provider_and_empties_scope(
        self,
        repository_factory,
        client_factory,
        worker_factory,
    ):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.ingestion_context.side_effect = [self._context(), self._context()]
        repository.select_rows.side_effect = [
            [{"id": "job-1", "status": "pending", "endpoint_key": "players", "dedupe_key": "scope-1:players"}],
            [],
            [],
            [],
            [],
            [],
        ]
        worker_factory.return_value.run_once.side_effect = [
            WorkerResult(status="succeeded", job_id="job-1"),
            WorkerResult(status="idle"),
        ]
        argv = [
            "drain_highlightly_shadow_queue",
            "--scope", "scope-1",
            "--sport", "basketball",
            "--max-jobs", "10",
            "--confirm-bounded-drain",
        ]

        with patch("sys.argv", argv), patch("builtins.print"):
            exit_code = drain.main()

        self.assertEqual(exit_code, 0)
        self.assertEqual(repository.ingestion_context.call_args_list[0].args, ("basketball",))
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        worker_factory.assert_called_once()

    @patch.object(drain, "HighlightlyClient")
    @patch.object(drain, "HighlightlyRepository")
    def test_drain_refuses_jobs_outside_scope(self, repository_factory, client_factory):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.ingestion_context.return_value = self._context()
        repository.select_rows.side_effect = [
            [{"id": "job-1", "status": "pending", "endpoint_key": "players", "dedupe_key": "other:players"}],
            [],
            [],
        ]
        argv = [
            "drain_highlightly_shadow_queue",
            "--scope", "scope-1",
            "--confirm-bounded-drain",
        ]

        with patch("sys.argv", argv), self.assertRaisesRegex(RuntimeError, "outside"):
            drain.main()

        repository.set_provider_enabled.assert_not_called()
        client_factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
