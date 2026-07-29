from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729135844_create_highlightly_phase8f32_stored_feature_report.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8f32_stored_feature_report_smoke.sql"
)


class HighlightlyPhaseEightFStoredReportTests(unittest.TestCase):
    def test_v7_uses_stored_competition_aware_semantics(self):
        migration = MIGRATION.read_text(encoding="utf-8")

        self.assertIn("get_highlightly_feature_store_report_v7", migration)
        self.assertIn("get_highlightly_feature_store_report_v6", migration)
        self.assertIn("'phase8f.3.2'", migration)
        self.assertIn("'stored_v120_competition_aware'", migration)
        self.assertIn("'competition_profile'", migration)
        self.assertIn("'standings_policy'", migration)
        self.assertIn("'eligibility_reason'", migration)
        self.assertIn("model_eligible_snapshots", migration)
        self.assertIn("ready_for_feature_review", migration)
        self.assertIn("profile_components", migration)

    def test_v7_is_read_only_and_restricted(self):
        migration = MIGRATION.read_text(encoding="utf-8")

        self.assertIn("STABLE", migration)
        self.assertIn("SECURITY INVOKER", migration)
        self.assertIn("FROM PUBLIC, anon, authenticated", migration)
        self.assertIn("TO authenticated, service_role", migration)
        self.assertNotIn(
            "materialize_highlightly_football_features_v3(",
            migration,
        )
        self.assertNotIn(
            "INSERT INTO public.hl_match_feature_snapshots",
            migration,
        )
        self.assertNotIn("UPDATE public.sports_providers", migration)

    def test_smoke_checks_corrected_contract_and_no_writes(self):
        smoke = SMOKE.read_text(encoding="utf-8")

        self.assertIn("snapshots_after <> snapshots_before", smoke)
        self.assertIn("runs_after <> runs_before", smoke)
        self.assertIn("labels_after <> labels_before", smoke)
        self.assertIn("ready_for_feature_review", smoke)
        self.assertIn("77.75", smoke)
        self.assertIn("Highlightly provider must remain disabled", smoke)
        self.assertIn("ROLLBACK;", smoke)


if __name__ == "__main__":
    unittest.main()
