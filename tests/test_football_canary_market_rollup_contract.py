from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260905002341_reconcile_football_canary_and_market_rollup.sql"


class FootballCanaryMarketRollupContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_canary_is_scoped_to_the_three_approved_competitions(self):
        for competition_id in (
            "9247cd02-df38-519b-8791-512a016a9a38",
            "1839d176-a7b8-5f92-adaa-40475560a5d8",
            "1eaaa858-ec27-5162-ac9e-3f63a529a294",
        ):
            self.assertIn(competition_id, self.sql)
        self.assertIn("canonical_due_schedule", self.sql)
        self.assertIn("not_independently_measurable", self.sql)
        self.assertNotIn("from public.odds_jogos", self.sql)

    def test_only_approved_half_lines_are_persisted(self):
        for line in ("1.5", "2.5", "3.5", "4.5", "5.5"):
            self.assertIn(f"('total', {line})", self.sql)
        for line in ("0.5", "1.5", "2.5", "3.5", "4.5", "5.5"):
            self.assertIn(f"('handicap', {line})", self.sql)
        self.assertIn("abs(quote.line_value)", self.sql)

    def test_absent_markets_are_non_blocking_and_table_is_private(self):
        self.assertIn("automatic_exclusions', false", self.sql)
        self.assertIn("an absent market does not invalidate a league or match", self.sql)
        self.assertIn("enable row level security", self.sql)
        self.assertIn("from public, anon, authenticated", self.sql)
        self.assertIn("to service_role", self.sql)


if __name__ == "__main__":
    unittest.main()
