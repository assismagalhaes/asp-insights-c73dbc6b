from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729211402_33f38735-ffee-456d-99bf-88544117f175.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g4_training_readiness_smoke.sql"
)
SCRIPT = ROOT / "scripts/report_highlightly_phase8g4_readiness.py"
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


class HighlightlyPhase8G4TrainingReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.bridge = BRIDGE.read_text(encoding="utf-8")

    def test_policy_is_draft_disabled_and_conservative(self) -> None:
        self.assertIn(
            "hl_training_readiness_policies",
            self.migration,
        )
        self.assertIn("minimum_total_rows", self.migration)
        self.assertIn("minimum_outcome_class_rows", self.migration)
        self.assertIn("ARRAY['home', 'draw', 'away']", self.migration)
        self.assertIn("'draft'", self.migration)
        self.assertIn("false", self.migration)

    def test_report_separates_readiness_from_authorization(self) -> None:
        self.assertIn(
            "get_highlightly_training_readiness_report_v1",
            self.migration,
        )
        self.assertIn("'data_ready'", self.migration)
        self.assertIn("'manual_training_authorized'", self.migration)
        self.assertIn("'outcome_distribution'", self.migration)
        self.assertIn("'gates_failed'", self.migration)

    def test_report_is_invoker_and_admin_gated(self) -> None:
        self.assertIn("SECURITY INVOKER", self.migration)
        self.assertIn(
            "Highlightly training readiness report requires an administrator",
            self.migration,
        )
        self.assertIn("FROM PUBLIC, anon;", self.migration)
        self.assertIn("TO authenticated, service_role;", self.migration)

    def test_report_forbids_automatic_actions(self) -> None:
        self.assertIn("'provider_calls', 0", self.migration)
        self.assertIn("'database_writes', 0", self.migration)
        self.assertIn("'automatic_training', false", self.migration)
        self.assertIn("'automatic_predictions', false", self.migration)

    def test_operator_is_read_only(self) -> None:
        self.assertIn(
            "get_highlightly_training_readiness_report_v1",
            self.script,
        )
        self.assertNotIn("--confirm", self.script)
        self.assertIn('"database_writes": 0', self.script)
        self.assertIn('"automatic_training": False', self.script)

    def test_bridge_allows_readiness_report(self) -> None:
        self.assertIn(
            '"get_highlightly_training_readiness_report_v1"',
            self.bridge,
        )

    def test_smoke_keeps_provider_disabled(self) -> None:
        self.assertIn("BEGIN;", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)
        self.assertIn(
            "Highlightly provider must remain disabled at rest",
            self.smoke,
        )


if __name__ == "__main__":
    unittest.main()
