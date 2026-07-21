from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260721201500_harden_highlightly_raw_lineage_and_wnba_standings.sql"
SMOKE = ROOT / "supabase/tests/highlightly_wnba_standings_lineage_smoke.sql"


class HighlightlyWnbaStandingsLineageContractTests(unittest.TestCase):
    def test_migration_enforces_run_lineage_and_catalog_quarantine(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        folded = sql.casefold()

        self.assertIn("create unique index if not exists idx_hl_raw_objects_run_unique", folded)
        self.assertIn("where run_id is not null", folded)
        self.assertIn("'{standings}', 'false'::jsonb", folded)
        self.assertIn("'standingspolicy', 'provider_quarantined'", folded)
        self.assertIn("provider_competition_id = '11847'", folded)

    def test_smoke_is_transactional_and_proves_distinct_occurrences(self):
        sql = SMOKE.read_text(encoding="utf-8")
        folded = sql.casefold()

        self.assertTrue(sql.lstrip().startswith("BEGIN;"))
        self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
        self.assertIn("count(distinct run_id)", folded)
        self.assertIn("basketball_standings_corrupted", folded)
        self.assertIn("highlightly provider must remain disabled", folded)


if __name__ == "__main__":
    unittest.main()
