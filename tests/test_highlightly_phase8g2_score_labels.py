from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729180000_create_highlightly_phase8g2_score_label_canary.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g2_score_label_canary_smoke.sql"
)
SCRIPT = ROOT / "scripts/materialize_highlightly_phase8g_labels.py"
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


class HighlightlyPhase8G2ScoreLabelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.bridge = BRIDGE.read_text(encoding="utf-8")

    def test_migration_creates_audited_idempotent_materializer(self) -> None:
        self.assertIn(
            "create table if not exists public.hl_label_materialization_runs",
            self.migration.lower(),
        )
        self.assertIn(
            "materialize_highlightly_football_score_labels_v1",
            self.migration,
        )
        self.assertIn(
            "get_highlightly_label_materialization_report_v1",
            self.migration,
        )
        self.assertIn(
            "ON CONFLICT (match_id, label_version) DO NOTHING",
            self.migration,
        )
        self.assertIn("definition_count = 18", self.migration)
        self.assertIn("'provider_calls', 0", self.migration)
        self.assertIn("SECURITY INVOKER", self.migration)

    def test_materializer_is_service_role_only(self) -> None:
        signature = (
            "public.materialize_highlightly_football_score_labels_v1(\n"
            "    integer,\n"
            "    integer\n"
            "  )"
        )
        self.assertGreaterEqual(self.migration.count(signature), 3)
        self.assertIn(
            "FROM PUBLIC, anon, authenticated;",
            self.migration,
        )
        self.assertIn("TO service_role;", self.migration)

    def test_labels_are_immutable_and_score_scoped(self) -> None:
        self.assertIn(
            "trg_hl_match_labels_immutable",
            self.migration,
        )
        self.assertIn(
            "match labels are immutable; create a new label version instead",
            self.migration,
        )
        self.assertIn("'score_families_only', true", self.migration)
        self.assertIn(
            "writes no first-goal or corner labels",
            self.migration,
        )
        self.assertIn(
            "market_family' IN (\n"
            "        'full_time_result',\n"
            "        'total_goals',\n"
            "        'both_teams_to_score',\n"
            "        'asian_handicap'",
            self.migration,
        )

    def test_smoke_proves_idempotency_and_no_provider_calls(self) -> None:
        self.assertIn("BEGIN;", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)
        self.assertIn("labels_inserted')::integer <> 0", self.smoke)
        self.assertIn("labels_skipped')::integer <> 1", self.smoke)
        self.assertIn("provider_calls", self.smoke)
        self.assertIn("Stored labels must be immutable", self.smoke)

    def test_operator_script_defaults_to_dry_run(self) -> None:
        self.assertIn("--confirm-materialize", self.script)
        self.assertIn(
            "get_highlightly_label_settlement_preview_v2",
            self.script,
        )
        self.assertIn(
            "materialize_highlightly_football_score_labels_v1",
            self.script,
        )
        self.assertIn("provider_calls", self.script)
        self.assertIn("automatic_training", self.script)

    def test_bridge_allows_phase8g2_rpcs(self) -> None:
        self.assertIn(
            '"materialize_highlightly_football_score_labels_v1"',
            self.bridge,
        )
        self.assertIn(
            '"get_highlightly_label_materialization_report_v1"',
            self.bridge,
        )


if __name__ == "__main__":
    unittest.main()
