from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729185127_a3b7cee2-8618-47d9-bfe7-ca615333fa92.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g31_labeled_feature_backfill_smoke.sql"
)
SCRIPT = ROOT / "scripts/backfill_highlightly_phase8g31_features.py"
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


class HighlightlyPhase8G31LabeledFeatureBackfillTests(
    unittest.TestCase
):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.bridge = BRIDGE.read_text(encoding="utf-8")

    def test_backfill_targets_only_valid_labeled_missing_matches(self) -> None:
        self.assertIn(
            "backfill_highlightly_football_labeled_features_v1",
            self.migration,
        )
        self.assertIn(
            "get_highlightly_labeled_feature_backfill_preview_v1",
            self.migration,
        )
        self.assertIn(
            "label.quality_status = 'valid'",
            self.migration,
        )
        self.assertIn(
            "AND NOT EXISTS (",
            self.migration,
        )
        self.assertIn(
            "snapshot.horizon_key = 't24h'",
            self.migration,
        )
        self.assertIn(
            "snapshot.kickoff_at = match_row.kickoff_at",
            self.migration,
        )

    def test_backfill_reuses_stored_feature_materializer(self) -> None:
        self.assertIn(
            "public.materialize_highlightly_football_features_v3(",
            self.migration,
        )
        self.assertIn(
            "candidate.kickoff_at + interval '1 millisecond'",
            self.migration,
        )
        self.assertIn("'provider_calls', 0", self.migration)
        self.assertIn("'stored_data_only', true", self.migration)
        self.assertIn("'labels_generated', 0", self.migration)
        self.assertIn("'automatic_training', false", self.migration)
        self.assertIn("'automatic_predictions', false", self.migration)

    def test_functions_are_invoker_and_service_role_only(self) -> None:
        self.assertIn("SECURITY INVOKER", self.migration)
        self.assertIn(
            "FROM PUBLIC, anon, authenticated;",
            self.migration,
        )
        self.assertIn("TO service_role;", self.migration)

    def test_smoke_is_transactional_and_provider_free(self) -> None:
        self.assertIn("BEGIN;", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)
        self.assertIn("snapshots_created')::integer <> 1", self.smoke)
        self.assertIn("labels_before <> labels_after", self.smoke)
        self.assertIn("provider_calls", self.smoke)

    def test_operator_defaults_to_dry_run(self) -> None:
        self.assertIn("--confirm-backfill", self.script)
        self.assertIn(
            "get_highlightly_labeled_feature_backfill_preview_v1",
            self.script,
        )
        self.assertIn(
            "backfill_highlightly_football_labeled_features_v1",
            self.script,
        )
        self.assertIn("provider_calls", self.script)

    def test_bridge_allows_phase8g31_rpcs(self) -> None:
        self.assertIn(
            '"get_highlightly_labeled_feature_backfill_preview_v1"',
            self.bridge,
        )
        self.assertIn(
            '"backfill_highlightly_football_labeled_features_v1"',
            self.bridge,
        )


if __name__ == "__main__":
    unittest.main()
