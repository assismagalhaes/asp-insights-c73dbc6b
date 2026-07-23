import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from api.highlightly.worker import WorkerResult
from scripts import ensure_highlightly_provider_disabled as phase8e_cleanup
from scripts import report_highlightly_phase8e_operational as phase8e_report
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
        self.assertIn("--request-budget 300", service)
        self.assertIn("--max-jobs 200", service)
        self.assertIn("ExecStopPost=/usr/bin/flock", service)
        self.assertIn("scripts.ensure_highlightly_provider_disabled", service)
        self.assertEqual(phase8e.DEFAULT_REQUEST_BUDGET, 300)
        self.assertEqual(phase8e.DEFAULT_MAX_JOBS, 200)

    def test_daily_report_timer_is_read_only_and_does_not_activate_collection(self):
        timer = (
            ROOT / "config/systemd/highlightly-match-lifecycle-report.timer"
        ).read_text(encoding="utf-8")
        service = (
            ROOT / "config/systemd/highlightly-match-lifecycle-report.service"
        ).read_text(encoding="utf-8")

        self.assertIn("23:55:00 America/Sao_Paulo", timer)
        self.assertIn("scripts.report_highlightly_phase8e_operational", service)
        self.assertIn("--require-provider-disabled", service)
        self.assertNotIn("--confirm-lifecycle", service)

    def test_bridge_allowlists_only_the_phase8e_tables_and_rpcs(self):
        bridge = (
            ROOT / "src/lib/highlightly-ingest-bridge.server.ts"
        ).read_text(encoding="utf-8")

        for token in (
            "hl_match_lifecycle_policies",
            "hl_match_lifecycle_states",
            "hl_match_lifecycle_resources",
            "get_highlightly_match_lifecycle_candidates",
            "get_highlightly_match_lifecycle_candidates_v2",
            "refresh_highlightly_match_lifecycle_states",
            "get_highlightly_match_lifecycle_report",
            "get_highlightly_match_lifecycle_report_v2",
            "set_highlightly_match_lifecycle_policy",
            "get_highlightly_match_lifecycle_operational_report",
        ):
            self.assertIn(f'"{token}"', bridge)

    def test_phase8e1_migration_is_invoker_only_and_disabled_by_default(self):
        migration = (
            ROOT
            / "supabase/migrations/"
            "20260723224500_create_highlightly_phase8e1_operational_hardening.sql"
        ).read_text(encoding="utf-8")
        normalized = migration.casefold()

        self.assertIn("set_highlightly_match_lifecycle_policy", migration)
        self.assertIn("get_highlightly_match_lifecycle_operational_report", migration)
        self.assertEqual(normalized.count("security invoker"), 2)
        self.assertNotIn("security definer", normalized)
        self.assertNotIn("set enabled = true", normalized)
        self.assertIn("'max_jobs', 200", normalized)
        self.assertIn("'request_budget', 300", normalized)
        self.assertIn("'daily_reserve', 750", normalized)

    @patch.object(phase8e_cleanup.HighlightlyRepository, "from_environment")
    def test_systemd_cleanup_forces_provider_disabled(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.set_provider_enabled.return_value = {"enabled": False}

        with patch("builtins.print") as output:
            exit_code = phase8e_cleanup.main(["--reason", "unit-test"])

        self.assertEqual(exit_code, 0)
        repository.set_provider_enabled.assert_called_once_with("highlightly", False)
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["reason"], "unit-test")
        self.assertTrue(report["provider_restored_disabled"])

    @patch.object(phase8e_report.HighlightlyRepository, "from_environment")
    def test_operational_report_does_not_call_the_provider(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.rpc.return_value = {
            "provider": {"enabled": False},
            "safe_at_rest": True,
        }

        with patch("builtins.print") as output:
            exit_code = phase8e_report.main(
                ["--hours", "24", "--require-provider-disabled"]
            )

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_called_once()
        rpc_name, payload = repository.rpc.call_args.args
        self.assertEqual(
            rpc_name,
            "get_highlightly_match_lifecycle_operational_report",
        )
        self.assertEqual(set(payload), {"p_from", "p_to"})
        repository.set_provider_enabled.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["report_status"], "ok")

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
            "get_highlightly_match_lifecycle_candidates_v2",
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
            WorkerResult(
                status="succeeded",
                job_id="job-1",
                records_received=3,
                records_normalized=3,
            ),
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
        self.assertEqual(final_rows[0]["metadata"]["recordsReceived"], 3)
        self.assertFalse(final_rows[0]["metadata"]["emptyResponse"])
        report_call = repository.rpc.call_args_list[2]
        self.assertEqual(
            report_call.args[0],
            "get_highlightly_match_lifecycle_report_v2",
        )
        self.assertEqual(
            report_call.args[1],
            {
                "p_from": "2026-07-22T05:00:00+00:00",
                "p_to": "2026-07-25T05:00:00+00:00",
            },
        )
        repository.set_provider_enabled.assert_any_call("highlightly", True)
        repository.set_provider_enabled.assert_any_call("highlightly", False)
        self.assertEqual(worker_factory.call_args.kwargs["daily_quota_ceiling"], 400)

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
            phase8e._resource_status(
                WorkerResult(status="succeeded", records_received=1),
                sport="football",
                resource="events",
                cadence_key="live-1",
            ),
            "succeeded",
        )
        self.assertEqual(
            phase8e._resource_status(
                WorkerResult(status="partial"),
                sport="football",
                resource="events",
                cadence_key="live-1",
            ),
            "quality_rejected",
        )
        self.assertEqual(
            phase8e._resource_status(
                WorkerResult(status="dead", message="HTTP 404 not found"),
                sport="football",
                resource="events",
                cadence_key="post24h",
            ),
            "provider_unavailable",
        )
        self.assertEqual(
            phase8e._resource_status(
                WorkerResult(status="dead", message="HTTP 500"),
                sport="football",
                resource="events",
                cadence_key="post24h",
            ),
            "dead",
        )

    def test_empty_required_resource_retries_until_post24h(self):
        empty = WorkerResult(status="succeeded", records_received=0)

        self.assertEqual(
            phase8e._resource_status(
                empty,
                sport="football",
                resource="events",
                cadence_key="post2h",
            ),
            "retry",
        )
        self.assertEqual(
            phase8e._resource_status(
                empty,
                sport="football",
                resource="events",
                cadence_key="post24h",
            ),
            "provider_unavailable",
        )

    def test_empty_optional_resources_are_terminal_only_when_deterministic(self):
        empty = WorkerResult(status="succeeded", records_received=0)

        self.assertEqual(
            phase8e._resource_status(
                empty,
                sport="football",
                resource="box_scores",
                cadence_key="post15m",
            ),
            "not_supported",
        )
        self.assertEqual(
            phase8e._resource_status(
                empty,
                sport="football",
                resource="highlights",
                cadence_key="post2h",
            ),
            "retry",
        )
        self.assertEqual(
            phase8e._resource_status(
                empty,
                sport="football",
                resource="highlights",
                cadence_key="post24h",
            ),
            "not_supported",
        )

    def test_empty_resource_row_preserves_auditable_counts(self):
        pending = phase8e._pending_resource_row(
            candidate(
                lifecycle_stage="finished_pending_detail",
                cadence_key="post2h",
            ),
            job={"id": "job-empty", "attempts": 0},
            scope="phase8e-lifecycle-smoke",
            attempted_at=phase8e.datetime.fromisoformat(
                "2026-07-23T17:00:00+00:00"
            ),
        )

        finished = phase8e._finished_resource_row(
            pending,
            WorkerResult(status="succeeded", records_received=0),
            finished_at=phase8e.datetime.fromisoformat(
                "2026-07-23T17:01:00+00:00"
            ),
        )

        self.assertEqual(finished["status"], "retry")
        self.assertIsNone(finished["completed_at"])
        self.assertEqual(
            finished["last_error"],
            "empty_required_or_pending_resource_retry",
        )
        self.assertTrue(finished["metadata"]["emptyResponse"])
        self.assertEqual(finished["metadata"]["emptyClassification"], "retry")

    def test_empty_response_hotfix_migration_is_locked_down(self):
        migration = (
            ROOT
            / "supabase/migrations/20260723203000_harden_highlightly_phase8e_empty_resources.sql"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "get_highlightly_match_lifecycle_candidates_v2",
            migration,
        )
        self.assertIn("get_highlightly_match_lifecycle_report_v2", migration)
        self.assertIn("SECURITY INVOKER", migration)
        self.assertNotIn("SECURITY DEFINER", migration)
        self.assertIn("records_received = 0", migration)
        self.assertIn("'provider_unavailable'", migration)
        self.assertIn("'not_supported'", migration)
        self.assertIn("now() - interval '36 hours'", migration)
        self.assertIn("FROM PUBLIC, anon, authenticated", migration)
        self.assertIn("TO service_role", migration)


if __name__ == "__main__":
    unittest.main()
