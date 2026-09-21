from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260921131824_fix_football_canary_freshness_semantics.sql"


class FootballCanaryFreshnessSemanticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_no_due_matches_are_explicitly_not_applicable(self) -> None:
        self.assertIn("not_applicable_no_due_matches", self.sql)
        self.assertIn("matches_due_next_24h = 0", self.sql)

    def test_monitor_and_actionable_odds_freshness_are_separate(self) -> None:
        self.assertIn("monitor_freshness_seconds", self.sql)
        self.assertIn("odds_freshness_p95_seconds", self.sql)
        self.assertIn("monitor_heartbeat_and_due_match_odds_p95", self.sql)

    def test_missing_or_stale_monitor_still_blocks(self) -> None:
        self.assertIn("monitor_missing", self.sql)
        self.assertIn("monitor_stale", self.sql)
        self.assertIn(
            "freshness.status NOT IN ('ready', 'not_applicable_no_due_matches')",
            self.sql,
        )

    def test_function_keeps_restricted_invoker_execution(self) -> None:
        self.assertIn("SECURITY INVOKER", self.sql)
        self.assertIn("FROM PUBLIC, anon, authenticated", self.sql)
        self.assertIn("TO service_role", self.sql)


if __name__ == "__main__":
    unittest.main()
