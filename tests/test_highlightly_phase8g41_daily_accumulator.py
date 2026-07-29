from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts import run_highlightly_phase8g41_accumulator as accumulator


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729213012_create_highlightly_phase8g41_daily_accumulator.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g41_daily_accumulator_smoke.sql"
)
SERVICE = (
    ROOT
    / "config/systemd/"
    "highlightly-training-accumulator.service"
)
TIMER = (
    ROOT
    / "config/systemd/"
    "highlightly-training-accumulator.timer"
)
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


class HighlightlyPhase8G41DailyAccumulatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.service = SERVICE.read_text(encoding="utf-8")
        cls.timer = TIMER.read_text(encoding="utf-8")
        cls.bridge = BRIDGE.read_text(encoding="utf-8")

    def test_migration_orchestrates_all_stored_data_stages(self) -> None:
        for rpc_name in (
            "materialize_highlightly_football_score_labels_v1",
            "backfill_highlightly_football_labeled_features_v2",
            "build_highlightly_football_training_dataset_v1",
            "get_highlightly_training_readiness_report_v1",
        ):
            self.assertIn(rpc_name, self.migration)
        self.assertIn("hl_training_accumulation_runs", self.migration)

    def test_rpcs_are_invoker_and_least_privilege(self) -> None:
        self.assertIn("SECURITY INVOKER", self.migration)
        self.assertIn("FROM PUBLIC, anon, authenticated;", self.migration)
        self.assertIn("TO service_role;", self.migration)
        self.assertIn("TO authenticated, service_role;", self.migration)

    def test_systemd_uses_global_lock_and_bounded_limits(self) -> None:
        self.assertIn("/run/lock/asp-highlightly-future.lock", self.service)
        self.assertIn("--wait 14400", self.service)
        self.assertIn("--label-limit 200", self.service)
        self.assertIn("--feature-limit 200", self.service)
        self.assertIn("--dataset-limit 5000", self.service)
        self.assertIn("--confirm-accumulate", self.service)
        self.assertIn("scripts.ensure_highlightly_provider_disabled", self.service)
        self.assertIn("01:40:00 America/Sao_Paulo", self.timer)

    @patch.object(accumulator.HighlightlyRepository, "from_environment")
    def test_dry_run_calls_only_preview_and_report(
        self,
        repository_factory,
    ) -> None:
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"enabled": False}
        }
        repository.rpc.side_effect = [
            {"recommendation": "ready_for_daily_accumulation_canary"},
            {"recommendation": "ready_for_daily_accumulation_canary"},
        ]
        repository_factory.return_value = repository

        with patch("builtins.print") as output:
            exit_code = accumulator.main([])

        self.assertEqual(exit_code, 0)
        self.assertEqual(repository.rpc.call_count, 2)
        self.assertEqual(
            repository.rpc.call_args_list[0].args[0],
            "get_highlightly_training_accumulation_preview_v1",
        )
        payload = json.loads(output.call_args.args[0])
        self.assertEqual(payload["mode"], "dry-run")
        self.assertFalse(payload["automatic_training"])

    @patch.object(accumulator.HighlightlyRepository, "from_environment")
    def test_confirm_runs_single_coordinator_and_writes_report_atomically(
        self,
        repository_factory,
    ) -> None:
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"enabled": False}
        }
        repository.rpc.return_value = {
            "status": "completed_with_exceptions"
        }
        repository_factory.return_value = repository

        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "latest.json"
            with patch("builtins.print"):
                exit_code = accumulator.main(
                    [
                        "--confirm-accumulate",
                        "--output",
                        str(output_path),
                    ]
                )
            stored = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_called_once()
        self.assertEqual(stored["mode"], "execute")
        self.assertFalse(stored["automatic_training"])

    def test_bridge_allows_accumulator_rpcs(self) -> None:
        for rpc_name in (
            "get_highlightly_training_accumulation_preview_v1",
            "run_highlightly_football_training_accumulation_v1",
            "get_highlightly_training_accumulation_report_v1",
        ):
            self.assertIn(f'"{rpc_name}"', self.bridge)

    def test_smoke_is_transactional_and_keeps_provider_disabled(self) -> None:
        self.assertIn("BEGIN;", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)
        self.assertIn(
            "Highlightly provider must remain disabled at rest",
            self.smoke,
        )


if __name__ == "__main__":
    unittest.main()
