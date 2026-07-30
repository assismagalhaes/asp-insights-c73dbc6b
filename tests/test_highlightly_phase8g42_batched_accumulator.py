from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import Mock, patch

from api.highlightly_repository import HighlightlyRepositoryError
from scripts import run_highlightly_phase8g42_accumulator as accumulator


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260730133521_472e72d6-e41c-487e-9996-84b241ff993b.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g42_batched_accumulator_smoke.sql"
)
SERVICE = (
    ROOT
    / "config/systemd/"
    "highlightly-training-accumulator.service"
)
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


class HighlightlyPhase8G42BatchedAccumulatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.service = SERVICE.read_text(encoding="utf-8")
        cls.bridge = BRIDGE.read_text(encoding="utf-8")

    def test_migration_uses_keyset_and_resumable_checkpoints(self) -> None:
        self.assertIn(
            "(match_row.kickoff_at, match_row.id)",
            self.migration,
        )
        self.assertNotIn(" OFFSET ", self.migration.upper())
        self.assertIn(
            "checkpoint_highlightly_training_accumulation_cycle_v2",
            self.migration,
        )
        self.assertIn("pg_advisory_xact_lock", self.migration)
        self.assertIn("existing_labels_excluded", self.migration)

    def test_rpcs_are_invoker_and_least_privilege(self) -> None:
        self.assertNotIn("SECURITY DEFINER", self.migration)
        self.assertGreaterEqual(
            self.migration.count("SECURITY INVOKER"),
            6,
        )
        self.assertIn("FROM PUBLIC, anon, authenticated;", self.migration)
        self.assertIn("TO service_role;", self.migration)
        self.assertIn("TO authenticated, service_role;", self.migration)

    def test_systemd_uses_small_batches_and_keeps_safety_lock(self) -> None:
        self.assertIn(
            "scripts.run_highlightly_phase8g42_accumulator",
            self.service,
        )
        self.assertIn("--batch-size 20", self.service)
        self.assertIn("--max-batches 5", self.service)
        self.assertIn("--max-candidates-per-kickoff 50", self.service)
        self.assertIn("--dataset-limit 500", self.service)
        self.assertIn(
            "/run/lock/asp-highlightly-future.lock",
            self.service,
        )
        self.assertIn("--confirm-accumulate", self.service)

    @patch.object(accumulator.HighlightlyRepository, "from_environment")
    def test_dry_run_calls_only_batch_preview_and_report(
        self,
        repository_factory,
    ) -> None:
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"enabled": False}
        }
        repository.rpc.side_effect = [
            {
                "recommendation":
                    "ready_for_batched_label_materialization"
            },
            {"recommendation": "continue_daily_accumulation"},
        ]
        repository_factory.return_value = repository

        with patch("builtins.print") as output:
            exit_code = accumulator.main([])

        self.assertEqual(exit_code, 0)
        self.assertEqual(repository.rpc.call_count, 2)
        self.assertEqual(
            repository.rpc.call_args_list[0].args[0],
            "get_highlightly_score_label_batch_preview_v1",
        )
        payload = json.loads(output.call_args.args[0])
        self.assertEqual(payload["mode"], "dry-run")
        self.assertTrue(payload["cursor_pagination"])

    @patch.object(accumulator.HighlightlyRepository, "from_environment")
    def test_execute_checkpoints_batches_and_builds_dataset_once(
        self,
        repository_factory,
    ) -> None:
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"enabled": False}
        }
        repository.rpc.side_effect = [
            {
                "run_id": "run-1",
                "status": "running",
                "idempotent": False,
            },
            {
                "candidates_considered": 2,
                "candidates_eligible": 2,
                "candidates_blocked": 0,
                "labels_inserted": 2,
                "labels_skipped": 0,
                "has_more": False,
                "next_cursor": None,
            },
            {
                "kickoff_groups_processed": 1,
                "kickoff_groups_failed": 0,
                "labeled_snapshots_created": 2,
            },
            {"status": "running"},
            {"rows_inserted": 15, "rows_blocked": 0},
            {"readiness_pct": 40, "data_ready": False},
            {"status": "completed"},
            {"batching": {"summary": {"cycles": 1}}},
        ]
        repository_factory.return_value = repository

        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "result.json"
            with patch("builtins.print"):
                exit_code = accumulator.main(
                    [
                        "--confirm-accumulate",
                        "--cycle-key",
                        "phase8g42:football:test",
                        "--output",
                        str(output_path),
                    ]
                )
            stored = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        names = [call.args[0] for call in repository.rpc.call_args_list]
        self.assertEqual(
            names.count(
                "checkpoint_highlightly_training_accumulation_cycle_v2"
            ),
            1,
        )
        self.assertEqual(
            names.count("build_highlightly_football_training_dataset_v1"),
            1,
        )
        self.assertEqual(stored["result"]["cycle"]["status"], "completed")
        self.assertFalse(stored["automatic_training"])

    @patch.object(accumulator.HighlightlyRepository, "from_environment")
    def test_error_body_is_redacted_and_cycle_is_failed(
        self,
        repository_factory,
    ) -> None:
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"enabled": False}
        }
        repository.rpc.side_effect = [
            {
                "run_id": "run-2",
                "status": "running",
                "idempotent": False,
            },
            HighlightlyRepositoryError(
                "Supabase returned HTTP 500",
                status=500,
                body={
                    "message": "statement timeout",
                    "authorization": "must-not-leak",
                },
            ),
            {"status": "failed"},
        ]
        repository_factory.return_value = repository

        with patch("builtins.print") as output:
            exit_code = accumulator.main(
                [
                    "--confirm-accumulate",
                    "--cycle-key",
                    "phase8g42:football:error",
                ]
            )

        self.assertEqual(exit_code, 1)
        payload = json.loads(output.call_args.args[0])
        self.assertEqual(payload["error"]["http_status"], 500)
        self.assertEqual(
            payload["error"]["body"]["authorization"],
            "[REDACTED]",
        )
        self.assertEqual(
            repository.rpc.call_args_list[-1].args[0],
            "finish_highlightly_training_accumulation_cycle_v2",
        )

    def test_bridge_and_smoke_cover_all_phase8g42_rpcs(self) -> None:
        for rpc_name in (
            "get_highlightly_score_label_batch_preview_v1",
            "materialize_highlightly_football_score_labels_v2",
            "start_highlightly_training_accumulation_cycle_v2",
            "checkpoint_highlightly_training_accumulation_cycle_v2",
            "finish_highlightly_training_accumulation_cycle_v2",
            "get_highlightly_training_accumulation_report_v2",
        ):
            self.assertIn(f'"{rpc_name}"', self.bridge)
            self.assertIn(rpc_name, self.smoke)
        self.assertIn("BEGIN;", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)


if __name__ == "__main__":
    unittest.main()
