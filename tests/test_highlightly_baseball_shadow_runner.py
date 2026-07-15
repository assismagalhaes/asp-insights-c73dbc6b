import unittest
from unittest.mock import Mock, patch

from api.highlightly.worker import WorkerResult
from scripts import run_highlightly_baseball_shadow as shadow


class HighlightlyBaseballShadowRunnerTests(unittest.TestCase):
    @staticmethod
    def _context():
        return {
            "provider": {"id": "provider-1", "enabled": False, "contract_version": "6.13.2"},
            "sport": {"id": "sport-1"},
            "bookmakers": [],
        }

    @patch.object(shadow, "_validate_shadow")
    @patch.object(shadow, "_assert_empty_queue")
    @patch.object(shadow, "HighlightlyWorker")
    @patch.object(shadow, "HighlightlyClient")
    @patch.object(shadow, "HighlightlyRepository")
    def test_bounded_mlb_shadow_restores_provider(
        self,
        repository_factory,
        client_factory,
        worker_factory,
        assert_empty_queue,
        validate_shadow,
    ):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.ingestion_context.side_effect = [self._context(), self._context()]
        worker_factory.return_value.run_once.side_effect = [
            WorkerResult(status="succeeded", job_id="job-1", run_id="run-1"),
            WorkerResult(status="idle"),
        ]
        validate_shadow.return_value = {"match_mapped": True, "counts": {}, "quality_issues": 0}

        argv = ["run_highlightly_baseball_shadow", "--match-id", "99", "--confirm-bounded-shadow"]
        with patch("sys.argv", argv), patch("builtins.print"):
            exit_code = shadow.main()

        self.assertEqual(exit_code, 0)
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        assert_empty_queue.assert_called_once_with(repository)
        job = repository.enqueue_job.call_args.kwargs
        self.assertEqual(job["sport"], "baseball")
        self.assertTrue(job["request_params"]["_fanout"])

    @patch.object(shadow, "_assert_empty_queue")
    @patch.object(shadow, "HighlightlyWorker")
    @patch.object(shadow, "HighlightlyClient")
    @patch.object(shadow, "HighlightlyRepository")
    def test_unexpected_mlb_worker_exception_still_restores_provider(
        self,
        repository_factory,
        client_factory,
        worker_factory,
        assert_empty_queue,
    ):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.ingestion_context.return_value = self._context()
        worker_factory.return_value.run_once.side_effect = RuntimeError("unexpected")

        argv = ["run_highlightly_baseball_shadow", "--match-id", "99", "--confirm-bounded-shadow"]
        with patch("sys.argv", argv), self.assertRaisesRegex(RuntimeError, "unexpected"):
            shadow.main()

        repository.set_provider_enabled.assert_any_call("highlightly", False)


if __name__ == "__main__":
    unittest.main()
