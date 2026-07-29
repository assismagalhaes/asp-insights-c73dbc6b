from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729183643_bca27b94-4893-4280-a2c5-42deeb3d6da2.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g3_training_dataset_smoke.sql"
)
SCRIPT = ROOT / "scripts/build_highlightly_phase8g3_dataset.py"
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


class HighlightlyPhase8G3TrainingDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.bridge = BRIDGE.read_text(encoding="utf-8")

    def test_migration_creates_versioned_audited_dataset(self) -> None:
        lowered = self.migration.lower()
        self.assertIn(
            "create table if not exists public.hl_training_dataset_specs",
            lowered,
        )
        self.assertIn(
            "create table if not exists "
            "public.hl_training_dataset_build_runs",
            lowered,
        )
        self.assertIn(
            "create table if not exists public.hl_training_dataset_rows",
            lowered,
        )
        self.assertIn("'highlightly_football_prematch_score'", self.migration)
        self.assertIn("'t24h'", self.migration)

    def test_temporal_and_leakage_contracts_fail_closed(self) -> None:
        for contract in (
            "feature_cutoff_at < kickoff_at",
            "target_match_facts_not_explicitly_forbidden",
            "feature_source_after_cutoff",
            "feature_leakage_not_clean",
            "feature_not_model_eligible",
            "label_temporal_contract_invalid",
        ):
            self.assertIn(contract, self.migration)

    def test_dataset_rows_are_immutable_and_temporally_split(self) -> None:
        self.assertIn(
            "trg_hl_training_dataset_rows_immutable",
            self.migration,
        )
        self.assertIn(
            "training dataset rows are immutable",
            self.migration,
        )
        self.assertIn("'train_pct', 70", self.migration)
        self.assertIn("'validation_pct', 15", self.migration)
        self.assertIn("'test_pct', 15", self.migration)
        self.assertIn("'shuffle', false", self.migration)

    def test_rpc_privileges_and_provider_safeguards(self) -> None:
        for rpc_name in (
            "build_highlightly_football_training_dataset_v1",
            "get_highlightly_training_dataset_preview_v1",
            "get_highlightly_training_dataset_report_v1",
        ):
            self.assertIn(rpc_name, self.migration)
        self.assertIn("SECURITY INVOKER", self.migration)
        self.assertIn("provider_calls = 0", self.migration)
        self.assertIn("'automatic_training', false", self.migration)
        self.assertIn("'automatic_predictions', false", self.migration)

    def test_smoke_proves_temporal_join_and_immutability(self) -> None:
        self.assertIn("BEGIN;", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)
        self.assertIn("rows_inserted')::integer <> 1", self.smoke)
        self.assertIn("temporal_violations", self.smoke)
        self.assertIn("Training dataset rows must be immutable", self.smoke)

    def test_operator_script_defaults_to_dry_run(self) -> None:
        self.assertIn("--confirm-build", self.script)
        self.assertIn(
            "get_highlightly_training_dataset_preview_v1",
            self.script,
        )
        self.assertIn(
            "build_highlightly_football_training_dataset_v1",
            self.script,
        )
        self.assertIn("provider_calls", self.script)
        self.assertIn("automatic_training", self.script)

    def test_bridge_allows_phase8g3_rpcs(self) -> None:
        for rpc_name in (
            "get_highlightly_training_dataset_preview_v1",
            "build_highlightly_football_training_dataset_v1",
            "get_highlightly_training_dataset_report_v1",
        ):
            self.assertIn(f'"{rpc_name}"', self.bridge)


if __name__ == "__main__":
    unittest.main()
