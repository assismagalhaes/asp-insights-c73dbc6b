import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scripts import plan_highlightly_football_selective_enrichment as selective


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260908153000_require_scope_for_selective_highlightly_jobs.sql"


class HighlightlySelectiveScopeTests(unittest.TestCase):
    def test_database_rejects_selective_job_without_scope(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("is_selective AND derived_scope IS NULL", sql)
        self.assertIn("Selective Highlightly jobs require", sql)
        self.assertIn("NEW.shadow_scope := derived_scope", sql)

    @patch.object(selective.HighlightlyRepository, "from_environment")
    def test_enqueue_requires_explicit_scope_before_repository_access(self, repository_factory):
        with self.assertRaises(SystemExit):
            selective.main(["--match-id", "00000000-0000-0000-0000-000000000001", "--enqueue"])
        repository_factory.assert_not_called()

    @patch.object(selective.HighlightlyRepository, "from_environment")
    def test_enqueue_propagates_and_verifies_scope(self, repository_factory):
        repository = Mock()
        repository.ingestion_context.return_value = {"provider": {"id": "provider-1", "enabled": False}}
        repository.daily_request_usage.return_value = 100
        repository.rpc.return_value = {
            "jobs": [{
                "endpoint_key": "football.FootballStatisticsController_getStatistics",
                "resource": "match_statistics",
                "dedupe_key": "selective:test",
                "request_params": {"matchId": 123, "_selective_enrichment": True},
                "priority": 2,
            }]
        }
        repository.enqueue_job.return_value = {"id": "job-1", "shadow_scope": "future-test"}
        repository_factory.return_value = repository

        with patch("builtins.print"):
            result = selective.main([
                "--match-id", "00000000-0000-0000-0000-000000000001",
                "--scope", "future-test",
                "--enqueue",
            ])

        self.assertEqual(result, 0)
        request_params = repository.enqueue_job.call_args.kwargs["request_params"]
        self.assertEqual(request_params["_shadow_scope"], "future-test")
        self.assertTrue(request_params["_selective_enrichment"])


if __name__ == "__main__":
    unittest.main()
