from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729213000_create_highlightly_phase8g33_grouped_backfill.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g33_grouped_backfill_smoke.sql"
)
SCRIPT = ROOT / "scripts/backfill_highlightly_phase8g33_features.py"
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


class HighlightlyPhase8G33GroupedBackfillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.bridge = BRIDGE.read_text(encoding="utf-8")

    def test_backfill_groups_shared_kickoffs(self) -> None:
        self.assertIn(
            "get_highlightly_labeled_feature_backfill_preview_v2",
            self.migration,
        )
        self.assertIn(
            "backfill_highlightly_football_labeled_features_v2",
            self.migration,
        )
        self.assertIn("GROUP BY match_row.kickoff_at", self.migration)
        self.assertIn("v_group.materializer_candidates", self.migration)
        self.assertIn(
            "public.materialize_highlightly_football_features_v3(",
            self.migration,
        )

    def test_backfill_is_bounded_and_provider_free(self) -> None:
        self.assertIn(
            "p_max_candidates_per_kickoff > 500",
            self.migration,
        )
        self.assertIn("'provider_calls', 0", self.migration)
        self.assertIn("'stored_data_only', true", self.migration)
        self.assertIn("'labels_generated', 0", self.migration)
        self.assertIn("'automatic_training', false", self.migration)
        self.assertIn("'automatic_predictions', false", self.migration)

    def test_functions_are_invoker_and_service_role_only(self) -> None:
        self.assertIn("SECURITY INVOKER", self.migration)
        self.assertIn("FROM PUBLIC, anon, authenticated;", self.migration)
        self.assertIn("TO service_role;", self.migration)

    def test_smoke_reproduces_limit_one_collision(self) -> None:
        self.assertIn("same kickoff", self.smoke.lower())
        self.assertIn(
            "backfill_result ->> 'labeled_snapshots_created'",
            self.smoke,
        )
        self.assertIn("labels_before <> labels_after", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)

    def test_operator_defaults_to_dry_run(self) -> None:
        self.assertIn("--confirm-backfill", self.script)
        self.assertIn(
            "get_highlightly_labeled_feature_backfill_preview_v2",
            self.script,
        )
        self.assertIn(
            "backfill_highlightly_football_labeled_features_v2",
            self.script,
        )
        self.assertIn("--max-candidates-per-kickoff", self.script)

    def test_bridge_allows_grouped_backfill_rpcs(self) -> None:
        self.assertIn(
            '"get_highlightly_labeled_feature_backfill_preview_v2"',
            self.bridge,
        )
        self.assertIn(
            '"backfill_highlightly_football_labeled_features_v2"',
            self.bridge,
        )


if __name__ == "__main__":
    unittest.main()
