from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260722001338_create_highlightly_collection_monitor.sql"
SMOKE = ROOT / "supabase/tests/highlightly_phase8b_monitor_smoke.sql"


class HighlightlyPhase8BMonitorContractTests(unittest.TestCase):
    def test_monitor_is_admin_gated_invoker_and_explicitly_granted(self):
        sql = MIGRATION.read_text(encoding="utf-8").casefold()

        self.assertIn("security invoker", sql)
        self.assertIn("administrator access required", sql)
        self.assertIn("public.has_role", sql)
        self.assertIn("from public, anon, authenticated", sql)
        self.assertIn("to authenticated, service_role", sql)

    def test_monitor_reports_queue_quota_quality_and_current_slice(self):
        sql = MIGRATION.read_text(encoding="utf-8").casefold()

        for contract in (
            "daily_usage",
            "current_slice",
            "running_jobs",
            "by_sport",
            "by_endpoint",
            "recent_errors",
            "quality",
            "hl_phase7_window_health_v",
        ):
            self.assertIn(contract, sql)

    def test_smoke_is_transactional(self):
        sql = SMOKE.read_text(encoding="utf-8")
        self.assertTrue(sql.lstrip().startswith("BEGIN;"))
        self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
        self.assertIn("SECURITY INVOKER", sql)


if __name__ == "__main__":
    unittest.main()
