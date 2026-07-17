from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/20260717010000_create_highlightly_competition_scope_catalog.sql"
)
SMOKE = ROOT / "supabase/tests/highlightly_phase8a_competition_scope_smoke.sql"


class HighlightlyPhase8AContractTests(unittest.TestCase):
    def test_catalog_is_admin_read_only_and_disabled_by_default(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        folded = sql.casefold()
        self.assertIn("with (security_invoker = true)", folded)
        self.assertIn("enable row level security", folded)
        self.assertIn("from public, anon, authenticated", folded)
        self.assertIn("to authenticated", folded)
        self.assertIn("to service_role", folded)
        self.assertNotIn("true,\n  'resolved'", folded)

        seeds = re.findall(
            r"^    \('(baseball|basketball|american_football|hockey)', '([^']+)'",
            sql,
            flags=re.MULTILINE,
        )
        self.assertEqual(len(seeds), 54)
        self.assertEqual(len({scope_key for _, scope_key in seeds}), 54)

    def test_selected_provider_families_are_explicit(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        expected = {
            "('baseball', 'mlb', 'baseball'",
            "('baseball', 'college-world-series', 'baseball'",
            "('basketball', 'wnba', 'basketball', '11847'",
            "('american_football', 'nfl', 'american-football'",
            "('american_football', 'ncaa-fbs', 'american-football'",
            "('hockey', 'nhl', 'nhl'",
            "('hockey', 'ncaa-hockey', 'nhl'",
            "('hockey', 'khl', 'hockey', '30569'",
            "('hockey', 'shl', 'hockey', '40781'",
        }
        for fragment in expected:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, sql)

    def test_smoke_is_transactional_and_checks_provider_gate(self):
        sql = SMOKE.read_text(encoding="utf-8")
        self.assertTrue(sql.lstrip().startswith("BEGIN;"))
        self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
        self.assertIn("Highlightly provider must remain disabled", sql)
        self.assertIn("Expected 54 selected scopes", sql)


if __name__ == "__main__":
    unittest.main()
