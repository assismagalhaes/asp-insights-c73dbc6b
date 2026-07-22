import json
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from scripts import run_highlightly_future_schedule as future


class HighlightlyFutureScheduleTests(unittest.TestCase):
    def test_night_slot_maps_the_next_five_local_dates(self):
        plan = future.build_plan(
            datetime(2026, 7, 22, 1, 15, tzinfo=timezone.utc)
        )

        self.assertEqual(plan.slot.name, "night")
        self.assertEqual(plan.start_date.isoformat(), "2026-07-22")
        self.assertEqual(plan.end_date.isoformat(), "2026-07-26")
        self.assertEqual(plan.scope, "future-20260721T2210-night")

    def test_intraday_slots_reconcile_today_and_near_future(self):
        morning = future.build_plan(
            datetime(2026, 7, 22, 10, 0, tzinfo=timezone.utc)
        )
        midday = future.build_plan(
            datetime(2026, 7, 22, 16, 0, tzinfo=timezone.utc)
        )
        evening = future.build_plan(
            datetime(2026, 7, 22, 22, 0, tzinfo=timezone.utc)
        )

        self.assertEqual((morning.slot.name, morning.start_date.isoformat(), morning.end_date.isoformat()), ("morning", "2026-07-22", "2026-07-24"))
        self.assertEqual((midday.slot.name, midday.start_date.isoformat(), midday.end_date.isoformat()), ("midday", "2026-07-22", "2026-07-23"))
        self.assertEqual((evening.slot.name, evening.start_date.isoformat(), evening.end_date.isoformat()), ("evening", "2026-07-22", "2026-07-23"))

    def test_command_uses_pregame_fanout_and_all_current_sports(self):
        plan = future.build_plan(
            datetime(2026, 7, 22, 1, 15, tzinfo=timezone.utc)
        )
        command = future.build_phase7_command(plan)

        self.assertIn("--all-football-leagues", command)
        self.assertEqual(command[command.index("--fanout-mode") + 1], "pregame")
        self.assertEqual(command[command.index("--window-kind") + 1], "future")
        self.assertIn("--finalize-window", command)
        self.assertEqual(command[command.index("--backfill-days") + 1], "5")
        self.assertNotIn("--sport", command)

    def test_schedule_budget_preserves_contractual_reserve_and_margin(self):
        self.assertEqual(future.PLANNED_DAILY_BUDGET, 5_700)
        self.assertLessEqual(
            future.PLANNED_DAILY_BUDGET,
            future.DAILY_LIMIT - future.RESERVE_REQUESTS,
        )

    @patch.object(future.HighlightlyRepository, "from_environment")
    @patch.object(future, "_now_utc")
    def test_dry_run_does_not_touch_database(self, now_utc, repository_factory):
        now_utc.return_value = datetime(2026, 7, 22, 1, 15, tzinfo=timezone.utc)
        with patch("builtins.print") as output:
            exit_code = future.main([])

        self.assertEqual(exit_code, 0)
        repository_factory.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "future_window_plan")
        self.assertEqual(report["date_start"], "2026-07-22")
        self.assertEqual(report["date_end"], "2026-07-26")

    @patch.object(future.subprocess, "run")
    @patch.object(future, "_active_jobs")
    @patch.object(future.HighlightlyRepository, "from_environment")
    @patch.object(future, "_now_utc")
    def test_active_backfill_skips_without_starting_a_second_worker(
        self,
        now_utc,
        repository_factory,
        active_jobs,
        subprocess_run,
    ):
        now_utc.return_value = datetime(2026, 7, 22, 1, 15, tzinfo=timezone.utc)
        repository = Mock()
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        repository_factory.return_value = repository
        active_jobs.return_value = [{"id": "backfill-job", "status": "running"}]

        with patch("builtins.print") as output:
            exit_code = future.main(["--confirm-future-window"])

        self.assertEqual(exit_code, 0)
        subprocess_run.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["event"], "future_window_skipped")
        self.assertEqual(report["reason"], "active_ingestion_queue")


if __name__ == "__main__":
    unittest.main()
