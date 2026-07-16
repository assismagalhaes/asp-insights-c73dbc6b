import unittest
from unittest.mock import Mock, patch

from scripts import refresh_highlightly_phase7_observability as refresh


class HighlightlyPhase7ObservabilityRefreshTests(unittest.TestCase):
    @patch.object(refresh, "HighlightlyRepository")
    def test_refreshes_reconciliation_before_observation_without_enabling_provider(self, repository_factory):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.select_rows.return_value = [
            {"window_id": "window-1", "scope": "scope-1", "sports": ["football"]}
        ]
        repository.ingestion_context.return_value = {"provider": {"enabled": False}}
        repository.rpc.side_effect = [
            {"expected_matches": 8},
            {"jobs_retry": 0, "jobs_pending": 676},
        ]
        argv = [
            "refresh_highlightly_phase7_observability",
            "--scope", "scope-1",
            "--observed-on", "2026-07-16",
        ]

        with patch("sys.argv", argv), patch("builtins.print"):
            exit_code = refresh.main()

        self.assertEqual(exit_code, 0)
        self.assertEqual(repository.rpc.call_args_list[0].args[0], "refresh_highlightly_source_reconciliation")
        self.assertEqual(repository.rpc.call_args_list[1].args[0], "refresh_highlightly_shadow_observation")
        self.assertEqual(repository.rpc.call_args_list[1].args[1]["p_matches_expected"], 8)
        repository.set_provider_enabled.assert_not_called()


if __name__ == "__main__":
    unittest.main()
