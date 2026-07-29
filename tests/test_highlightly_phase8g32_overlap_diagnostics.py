from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729210000_create_highlightly_phase8g32_overlap_diagnostics.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g32_overlap_diagnostics_smoke.sql"
)
SCRIPT = ROOT / "scripts/report_highlightly_phase8g32_overlap.py"
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


class HighlightlyPhase8G32OverlapDiagnosticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.bridge = BRIDGE.read_text(encoding="utf-8")

    def test_diagnostic_covers_materialization_stages(self) -> None:
        for token in (
            "source_v100_snapshot_missing",
            "source_v110_snapshot_missing",
            "target_v120_snapshot_missing",
            "participants_incomplete",
            "canonical_status_not_supported",
            "kickoff_mismatch",
            "'v1.0.0'",
            "'v1.1.0'",
            "'v1.2.0'",
        ):
            self.assertIn(token, self.migration)

    def test_diagnostic_is_read_only_and_provider_free(self) -> None:
        self.assertNotIn("INSERT INTO", self.migration)
        self.assertNotIn("UPDATE public.", self.migration)
        self.assertNotIn("DELETE FROM", self.migration)
        self.assertIn("'read_only', true", self.migration)
        self.assertIn("'provider_calls', 0", self.migration)
        self.assertIn("'database_writes', 0", self.migration)
        self.assertIn("'automatic_training', false", self.migration)
        self.assertIn("'automatic_predictions', false", self.migration)

    def test_rpc_is_invoker_and_service_role_only(self) -> None:
        self.assertIn("SECURITY INVOKER", self.migration)
        self.assertIn("FROM PUBLIC, anon, authenticated;", self.migration)
        self.assertIn("TO service_role;", self.migration)

    def test_smoke_is_transactional_and_checks_no_writes(self) -> None:
        self.assertIn("BEGIN;", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)
        self.assertIn("labels_before <> labels_after", self.smoke)
        self.assertIn("snapshots_before <> snapshots_after", self.smoke)
        self.assertIn("source_v100_snapshot_missing", self.smoke)

    def test_operator_is_read_only(self) -> None:
        self.assertIn(
            "get_highlightly_labeled_feature_overlap_diagnostics_v2",
            self.script,
        )
        self.assertNotIn("--confirm", self.script)
        self.assertIn('"mode": "read-only"', self.script)
        self.assertIn('"database_writes": 0', self.script)

    def test_bridge_allows_diagnostic_rpc(self) -> None:
        self.assertIn(
            '"get_highlightly_labeled_feature_overlap_diagnostics_v2"',
            self.bridge,
        )


if __name__ == "__main__":
    unittest.main()
