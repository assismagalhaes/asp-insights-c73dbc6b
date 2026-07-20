import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts import run_highlightly_date_range as date_range


class HighlightlyDateRangeTests(unittest.TestCase):
    def test_splits_fifteen_days_into_supported_chunks(self):
        chunks = date_range.split_date_range(date(2026, 7, 1), date(2026, 7, 15))
        self.assertEqual([(chunk.start.isoformat(), chunk.days) for chunk in chunks], [
            ("2026-07-01", 7),
            ("2026-07-08", 7),
            ("2026-07-15", 1),
        ])

    def test_reset_wait_uses_utc_boundary_and_buffer(self):
        now = datetime(2026, 7, 20, 23, 59, 30, tzinfo=timezone.utc)
        self.assertEqual(date_range.seconds_until_next_utc_day(now), 150)

    def test_slice_command_collects_all_sports_and_all_football_leagues(self):
        command = date_range.build_slice_command(
            scope="phase7-history",
            chunk=date_range.DateChunk(date(2026, 7, 8), 7),
            daily_request_budget=5_000,
            max_jobs=5_000,
        )
        self.assertIn("--all-football-leagues", command)
        self.assertIn("--confirm-phase7-shadow", command)
        self.assertNotIn("--sport", command)
        self.assertEqual(command[command.index("--backfill-days") + 1], "7")

    @patch.object(date_range.HighlightlyRepository, "from_environment")
    def test_dry_run_does_not_touch_database(self, repository_factory):
        with tempfile.TemporaryDirectory() as directory, patch("builtins.print") as output:
            result = date_range.main([
                "--scope", "phase7-history",
                "--date-start", "2026-07-01",
                "--date-end", "2026-07-15",
                "--state-file", str(Path(directory) / "state.json"),
            ])
        self.assertEqual(result, 0)
        repository_factory.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["usable_daily_ceiling"], 6_750)
        self.assertEqual(len(report["chunks"]), 3)
        self.assertTrue(report["include_finished_matches"])


if __name__ == "__main__":
    unittest.main()
