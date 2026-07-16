import json
import unittest
from unittest.mock import Mock, patch

from scripts import check_highlightly_phase7_gate as gate


class HighlightlyPhaseSevenGateTests(unittest.TestCase):
    @patch.object(gate, "HighlightlyRepository")
    def test_ready_gate_is_read_only_and_succeeds(self, repository_factory):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.select_rows.side_effect = [
            [
                {
                    "window_id": "window-1",
                    "scope": "phase7-test",
                    "sports": ["baseball"],
                    "gate_status": "ready",
                }
            ],
            [{"sport": "baseball", "observed_on": "2026-07-15"}],
            [{"sport": "baseball", "coverage_pct": 100}],
            [],
            [],
            [],
        ]
        repository.ingestion_context.return_value = {"provider": {"enabled": False}}
        argv = ["check_highlightly_phase7_gate", "--scope", "phase7-test", "--require-ready"]

        with patch("sys.argv", argv), patch("builtins.print") as output:
            exit_code = gate.main()

        self.assertEqual(exit_code, 0)
        self.assertEqual(json.loads(output.call_args.args[0])["gate_status"], "ready")
        repository.upsert_rows.assert_not_called()
        repository.patch_rows.assert_not_called()
        repository.rpc.assert_not_called()

    @patch.object(gate, "HighlightlyRepository")
    def test_collecting_gate_fails_when_ready_is_required(self, repository_factory):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.select_rows.side_effect = [
            [
                {
                    "window_id": "window-1",
                    "scope": "phase7-test",
                    "sports": ["football"],
                    "gate_status": "collecting",
                }
            ],
            [],
            [],
            [],
            [],
            [],
        ]
        repository.ingestion_context.return_value = {"provider": {"enabled": False}}
        argv = ["check_highlightly_phase7_gate", "--scope", "phase7-test", "--require-ready"]

        with patch("sys.argv", argv), patch("builtins.print"):
            exit_code = gate.main()

        self.assertEqual(exit_code, 1)


if __name__ == "__main__":
    unittest.main()
