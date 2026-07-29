from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729113347_override_highlightly_phase8f3_competition_profiles.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8f31_competition_overrides_smoke.sql"
)


class HighlightlyPhaseEightFCompetitionOverrideTests(unittest.TestCase):
    def test_migration_is_exact_auditable_and_fail_closed(self):
        migration = MIGRATION.read_text(encoding="utf-8")

        self.assertIn("55e0032f-b970-5df5-b7ac-640d0307096d", migration)
        self.assertIn("5d7f08ef-6b7e-56a5-82c8-d64aa3beb801", migration)
        self.assertIn("'MLS Next Pro'::text", migration)
        self.assertIn("'Esiliiga B'::text", migration)
        self.assertIn("classification_source = 'manual'", migration)
        self.assertIn("profile_key = 'league'", migration)
        self.assertIn("standings_policy = 'required'", migration)
        self.assertIn("is_model_eligible = true", migration)
        self.assertIn("'phase8f.3.1'", migration)
        self.assertIn("IF updated_count <> 2", migration)

    def test_migration_does_not_materialize_or_enable_features(self):
        migration = MIGRATION.read_text(encoding="utf-8")

        self.assertNotIn(
            "materialize_highlightly_football_features_v3(",
            migration,
        )
        self.assertNotIn("UPDATE public.sports_providers", migration)
        self.assertNotIn(
            "INSERT INTO public.hl_match_feature_snapshots",
            migration,
        )

    def test_smoke_preserves_draft_and_provider_safety_gates(self):
        smoke = SMOKE.read_text(encoding="utf-8")

        self.assertIn("version = '1.2.0'", smoke)
        self.assertIn("feature_set.status = 'draft'", smoke)
        self.assertIn("NOT feature_set.is_enabled", smoke)
        self.assertIn("Highlightly provider must remain disabled at rest", smoke)
        self.assertIn("get_highlightly_feature_store_report_v6", smoke)
        self.assertIn("ROLLBACK;", smoke)


if __name__ == "__main__":
    unittest.main()
