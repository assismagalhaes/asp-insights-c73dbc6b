from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class HighlightlyPhaseSevenContractTests(unittest.TestCase):
    def test_observability_migration_is_locked_down_and_security_invoker(self):
        sql = (
            ROOT
            / "supabase/migrations/20260715230000_create_highlightly_phase7_observability.sql"
        ).read_text(encoding="utf-8")
        folded = sql.casefold()
        self.assertIn("hl_shadow_windows", sql)
        self.assertIn("hl_shadow_observations", sql)
        self.assertIn("hl_source_reconciliations", sql)
        self.assertIn("with (security_invoker = true)", folded)
        self.assertIn("set search_path = ''", folded)
        self.assertIn("from public, anon, authenticated", folded)
        self.assertIn("to service_role", folded)
        self.assertIn("daily_request_budget + reserve_requests <= 7500", folded)
        self.assertIn("count(distinct observation.observed_on) < 7", folded)
        self.assertIn("count(observation.match_coverage_pct)", folded)

    def test_phase_seven_smoke_is_transactional_and_keeps_provider_disabled(self):
        sql = (ROOT / "supabase/tests/highlightly_phase7_smoke.sql").read_text(
            encoding="utf-8"
        )
        self.assertTrue(sql.lstrip().startswith("BEGIN;"))
        self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
        self.assertIn("Highlightly provider must stay disabled", sql)
        self.assertIn("Phase 7 observation RPC privileges are invalid", sql)

    def test_runbook_uses_explicit_all_football_leagues_mode(self):
        runbook = (
            ROOT / "docs/highlightly/phase-7-backfill-shadow-runbook.md"
        ).read_text(encoding="utf-8")
        self.assertIn("--all-football-leagues", runbook)
        self.assertIn("páginas de 100 ligas", runbook)
        self.assertIn("sem filtro de liga", runbook)


if __name__ == "__main__":
    unittest.main()
