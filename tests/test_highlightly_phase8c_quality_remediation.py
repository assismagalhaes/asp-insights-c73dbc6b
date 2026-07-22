from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260722190000_remediate_highlightly_phase7_quality_gate.sql"
SMOKE = ROOT / "supabase/tests/highlightly_phase8c_quality_remediation_smoke.sql"


class HighlightlyPhase8CQualityRemediationContractTests(unittest.TestCase):
    def test_gate_uses_latest_state_instead_of_summing_snapshots(self):
        sql = MIGRATION.read_text(encoding="utf-8").casefold()

        self.assertIn("distinct on (observation.window_id, observation.sport)", sql)
        self.assertIn("from latest_observation as observation", sql)
        self.assertNotIn("sum(observation.jobs_dead), 0)::bigint as unrecovered_jobs\n  from public.hl_shadow_observations", sql)

    def test_odds_availability_uses_only_eligible_odds_jobs(self):
        sql = MIGRATION.read_text(encoding="utf-8").casefold()

        self.assertIn("matches_odds_eligible", sql)
        self.assertIn("matches_eligible_with_odds", sql)
        self.assertIn("odds_availability_pct", sql)
        self.assertIn("eligible_odds_jobs", sql)
        self.assertIn("hl_highlightly_future_gate_v", sql)
        self.assertIn("observed_sport_days", sql)

    def test_remediation_rpcs_are_narrow_and_service_role_only(self):
        sql = MIGRATION.read_text(encoding="utf-8").casefold()

        self.assertIn("issue.details #>> '{context,leagueid}' = '11847'", sql)
        self.assertIn("job.last_error = 'highlightly returned http 521'", sql)
        self.assertIn("job.endpoint_key = 'football.footballstatisticscontroller_getstatistics'", sql)
        self.assertIn("max_attempts = 1", sql)
        for function in (
            "accept_highlightly_quarantined_wnba_standings_issues(text)",
            "requeue_highlightly_dead_521_jobs(text, integer)",
            "finalize_highlightly_shadow_window(text)",
        ):
            self.assertIn(function, sql)
        self.assertGreaterEqual(sql.count("from public, anon, authenticated"), 3)
        self.assertGreaterEqual(sql.count("to service_role"), 3)

    def test_views_are_security_invoker_and_smoke_is_transactional(self):
        migration = MIGRATION.read_text(encoding="utf-8").casefold()
        smoke = SMOKE.read_text(encoding="utf-8")

        self.assertGreaterEqual(migration.count("with (security_invoker = true)"), 2)
        self.assertTrue(smoke.lstrip().startswith("BEGIN;"))
        self.assertTrue(smoke.rstrip().endswith("ROLLBACK;"))
        self.assertIn("latest-state gate still double counts", smoke)
        self.assertIn("WNBA acceptance is not idempotent", smoke)


if __name__ == "__main__":
    unittest.main()
