from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260717185011_aggregate_highlightly_daily_request_usage.sql"
SMOKE = ROOT / "supabase/tests/highlightly_daily_request_usage_smoke.sql"


class HighlightlyDailyUsageContractTests(unittest.TestCase):
    def test_rpc_aggregates_in_postgres_and_is_service_role_only(self):
        sql = MIGRATION.read_text(encoding="utf-8").casefold()

        self.assertIn("sum(usage.requests_used)", sql)
        self.assertIn("security invoker", sql)
        self.assertIn("set search_path = ''", sql)
        self.assertIn("from public, anon, authenticated", sql)
        self.assertIn("to service_role", sql)

    def test_smoke_exceeds_the_postgrest_default_row_cap(self):
        sql = SMOKE.read_text(encoding="utf-8").casefold()

        self.assertIn("generate_series(1, 1001)", sql)
        self.assertIn("aggregate_usage <> 1001", sql)
        self.assertIn("rollback", sql)


if __name__ == "__main__":
    unittest.main()
