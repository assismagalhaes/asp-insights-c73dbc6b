import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from api.highlightly.worker import WorkerResult
from scripts import run_highlightly_phase8e_match_lifecycle as phase8e


ROOT = Path(__file__).resolve().parents[1]


def candidate(**overrides):
    row = {
        "match_id": "match-1",
        "sport": "football",
        "external_match_id": "99",
        "kickoff_at": "2026-07-23T18:00:00+00:00",
        "match_status": "live",
        "lifecycle_stage": "live",
        "cadence_key": "live-123",
        "resource": "events",
        "endpoint_key": "football.FootballLiveEventsController_getLiveEvents",
        "request_params": {"id": "99"},
        "dedupe_key": "phase8e:lifecycle:football:99:events:live-123",
        "priority": 1,
    }
    row.update(overrides)
    return row


class HighlightlyPhaseEightEMatchLifecycleTests(unittest.TestCase):
    def test_timer_is_five_minutes_and_shares_global_collection_lock(self):
        timer = (
            ROOT / "config/systemd/highlightly-match-lifecycle.timer"
        ).read_text(encoding="utf-8")
        service = (
            ROOT / "config/systemd/highlightly-match-lifecycle.service"
        ).read_text(encoding="utf-8")

        self.assertIn("*:00/5:00 America/Sao_Paulo", timer)
        self.assertIn("/run/lock/asp-highlightly-future.lock", service)
        self.assertIn("--confirm-lifecycle", service)
        self.assertIn("--request-budget 1500", service)
        self.assertIn("--max-jobs 1000", service)

    def test_bridge_allowlists_only_the_phase8e_tables_and_rpcs(self):
        bridge = (
            ROOT / "src/lib/highlightly-ingest-bridge.server.ts"
        ).read_text(encoding="utf-8")

        for token in (
            "hl_match_lifecycle_policies",
            "hl_match_lifecycle_states",
            "hl_match_lifecycle_resources",
            "get_highlightly_match_lifecycle_candidates",
            "refresh_highlightly_match_lifecycle_states",
            "get_highlightly_match_lifecycle_report",
        ):
            self.assertIn(f'"{token}"', bridge)

    @patch.object(phase8e.HighlightlyRepository, "from_environment")
    def test_dry_run_previews_disabled_policies_without_enqueuing(
        self,
        repository_factory,
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.rpc.return_value = [candidate()]

        with patch("builtins.print") as output:
            exit_code = phase8e.main(
                ["--at", "2026-07-23T17:00:00+00:00", "--max-jobs", "20"]
            )

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_called_once_with(
            "get_highlightly_match_lifecycle_candidates",
            {
                "p_at": "2026-07-23T17:00:00+00:00",
                "p_limit": 20,
                "p_include_disabled": True,
            },
        )
        repository.enqueue_job.assert_not_called()
        repository.set_provider_enabled.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "phase8e_lifecycle_plan")
        self.assertEqual(report["by_stage"], {"live": 1})
        self.assertEqual(report["by_resource"], {"events": 1})
        self.assertTrue(report["includes_disabled_policies"])

    @patch.object(phase8e, "_active_jobs")
    @patch.object(phase8e, "HighlightlyWorker")
    @patch.object(phase8e, "HighlightlyClient")
    @patch.object(phase8e.HighlightlyRepository, "from_environment")
    def test_confirmed_cycle_tracks_resource_and_restores_provider(
        self,
        repository_factory,
        _client_factory,
        worker_factory,
        active_jobs,
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.rpc.side_effect = [
            [candidate()],
            {"refreshed_at": "2026-07-23T17:00:00+00:00", "matches_affected": 1},
            {"by_stage": [{"sport": "football", "lifecycle_stage": "live", "matches": 1}]},
        ]
        repository.enqueue_job.return_value = {"id": "job-1", "attempts": 0}
        repository.daily_request_usage.return_value = 100
        active_jobs.side_effect = [[], []]
        worker_factory.return_value.run_once.side_effect = [
            WorkerResult(status="succeeded", job_id="job-1"),
            WorkerResult(status="idle"),
        ]

        with patch("builtins.print"):
            exit_code = phase8e.main(
                [
                    "--at",
                    "2026-07-23T17:00:00+00:00",
                    "--max-jobs",
                    "20",
                    "--confirm-lifecycle",
                ]
            )

        self.assertEqual(exit_code, 0)
        repository.enqueue_job.assert_called_once()
        enqueue = repository.enqueue_job.call_args.kwargs
        self.assertEqual(enqueue["resource"], "events")
        self.assertEqual(enqueue["request_params"]["_phase8e_stage"], "live")
        self.assertEqual(
            enqueue["request_params"]["_canonical_match_id"],
            "match-1",
        )
        self.assertNotIn("_fanout", enqueue["request_params"])
        self.assertEqual(repository.upsert_rows.call_count, 2)
        final_rows = repository.upsert_rows.call_args.args[1]
        self.assertEqual(final_rows[0]["status"], "succeeded")
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        self.assertEqual(worker_factory.call_args.kwargs["daily_quota_ceiling"], 1_600)

    @patch.object(phase8e, "_active_jobs")
    @patch.object(phase8e.HighlightlyRepository, "from_environment")
    def test_disabled_policies_leave_confirmed_timer_idle(
        self,
        repository_factory,
        active_jobs,
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.rpc.return_value = []
        active_jobs.return_value = []

        with patch("builtins.print") as output:
            exit_code = phase8e.main(
                ["--at", "2026-07-23T17:00:00+00:00", "--confirm-lifecycle"]
            )

        self.assertEqual(exit_code, 0)
        repository.daily_request_usage.assert_not_called()
        repository.enqueue_job.assert_not_called()
        repository.upsert_rows.assert_not_called()
        repository.set_provider_enabled.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "phase8e_lifecycle_idle")
        self.assertEqual(report["reason"], "no_enabled_policy_candidates")

    def test_existing_job_metadata_rebuilds_resource_tracking(self):
        existing = {
            "id": "job-1",
            "sport": "baseball",
            "resource": "box_scores",
            "endpoint_key": "baseball.BaseballBoxScoresController_getBoxScores",
            "dedupe_key": "phase8e:lifecycle:baseball:77:box_scores:post2h",
            "priority": 0,
            "request_params": {
                "id": "77",
                "_canonical_match_id": "match-77",
                "_phase8e_resource": "box_scores",
                "_phase8e_stage": "finished_pending_detail",
                "_kickoff_at": "2026-07-23T12:00:00+00:00",
            },
        }

        rebuilt = phase8e._candidate_from_existing_job(existing)

        self.assertIsNotNone(rebuilt)
        self.assertEqual(rebuilt["match_id"], "match-77")
        self.assertEqual(rebuilt["external_match_id"], "77")
        self.assertEqual(rebuilt["cadence_key"], "post2h")
        self.assertEqual(rebuilt["resource"], "box_scores")

    @patch.object(phase8e, "_active_jobs")
    @patch.object(phase8e.HighlightlyRepository, "from_environment")
    def test_foreign_queue_prevents_interleaving(self, repository_factory, active_jobs):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository.rpc.return_value = []
        active_jobs.return_value = [
            {"id": "job-1", "shadow_scope": "future-20260723T2210-night"}
        ]

        with patch("builtins.print") as output:
            exit_code = phase8e.main(
                ["--at", "2026-07-23T17:00:00+00:00", "--confirm-lifecycle"]
            )

        self.assertEqual(exit_code, 0)
        repository.enqueue_job.assert_not_called()
        repository.set_provider_enabled.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["reason"], "active_foreign_queue")

    def test_terminal_resource_classification_is_deterministic(self):
        self.assertEqual(
            phase8e._resource_status(WorkerResult(status="succeeded")),
            "succeeded",
        )
        self.assertEqual(
            phase8e._resource_status(WorkerResult(status="partial")),
            "quality_rejected",
        )
        self.assertEqual(
            phase8e._resource_status(
                WorkerResult(status="dead", message="HTTP 404 not found")
            ),
            "provider_unavailable",
        )
        self.assertEqual(
            phase8e._resource_status(WorkerResult(status="dead", message="HTTP 500")),
            "dead",
        )


if __name__ == "__main__":
    unittest.main()
