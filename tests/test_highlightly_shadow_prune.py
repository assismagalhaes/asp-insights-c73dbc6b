import unittest
from unittest.mock import Mock, patch

from scripts import prune_highlightly_shadow_queue as prune


class HighlightlyShadowPruneTests(unittest.TestCase):
    @patch.object(prune, "HighlightlyRepository")
    def test_dry_run_does_not_patch(self, repository_factory):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.ingestion_context.return_value = {"provider": {"enabled": False}}
        repository.select_rows.side_effect = [
            [],
            [
                {
                    "id": "job-1",
                    "endpoint_key": "football.HighlightsController_getHighlights",
                    "status": "pending",
                },
                {
                    "id": "job-2",
                    "endpoint_key": "football.FootballStatisticsController_getStatistics",
                    "status": "pending",
                },
            ],
            [],
        ]
        argv = ["prune_highlightly_shadow_queue", "--scope", "phase7-test"]
        with patch("sys.argv", argv), patch("builtins.print"):
            self.assertEqual(prune.main(), 0)
        repository.rpc.assert_not_called()

    @patch.object(prune, "HighlightlyRepository")
    def test_confirmed_prune_cancels_only_allowlisted_endpoint(self, repository_factory):
        repository = Mock()
        repository_factory.from_environment.return_value = repository
        repository.ingestion_context.side_effect = [
            {"provider": {"enabled": False}},
            {"provider": {"enabled": False}},
        ]
        repository.select_rows.side_effect = [
            [],
            [
                {
                    "id": "job-1",
                    "endpoint_key": "football.HighlightsController_getHighlights",
                    "status": "pending",
                }
            ],
            [],
        ]
        repository.rpc.return_value = 1
        argv = [
            "prune_highlightly_shadow_queue",
            "--scope",
            "phase7-test",
            "--confirm-prune",
        ]
        with patch("sys.argv", argv), patch("builtins.print"):
            self.assertEqual(prune.main(), 0)
        repository.rpc.assert_called_once()
        self.assertEqual(
            repository.rpc.call_args.args[0],
            "cancel_highlightly_redundant_shadow_jobs",
        )
        self.assertEqual(
            repository.rpc.call_args.args[1]["p_endpoint_keys"],
            ["football.HighlightsController_getHighlights"],
        )


if __name__ == "__main__":
    unittest.main()
