from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from scripts.refresh_highlightly_football_monitor import main


class FootballMonitorTests(unittest.TestCase):
    @patch("scripts.refresh_highlightly_football_monitor.HighlightlyRepository")
    def test_refreshes_rollups_without_provider_client(self, repository_type):
        repository = MagicMock()
        repository_type.from_environment.return_value = repository
        repository.rpc.side_effect = [3, 42, {"gate_status": "collecting"}]
        repository.ingestion_context.return_value = {
            "provider": {"enabled": False}
        }

        with patch("builtins.print") as output:
            self.assertEqual(main([]), 0)

        self.assertEqual(
            [call.args[0] for call in repository.rpc.call_args_list],
            [
                "refresh_highlightly_odds_league_coverage",
                "refresh_highlightly_football_market_coverage",
                "get_highlightly_football_canary_gate_v1",
            ],
        )
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["provider_calls"], 0)
        self.assertEqual(report["league_rows"], 3)
        self.assertEqual(report["market_rows"], 42)
        self.assertTrue(report["provider_disabled_at_rest"])


if __name__ == "__main__":
    unittest.main()
