import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from scripts import materialize_highlightly_phase8f_features as phase8f


ROOT = Path(__file__).resolve().parents[1]


class HighlightlyPhaseEightFFeatureStoreTests(unittest.TestCase):
    def test_migration_separates_features_labels_and_enforces_cutoffs(self):
        migration = (
            ROOT
            / "supabase/migrations/20260728191608_create_highlightly_phase8f_feature_store_foundation.sql"
        ).read_text(encoding="utf-8")

        self.assertIn("hl_match_feature_snapshots", migration)
        self.assertIn("hl_match_labels", migration)
        self.assertIn("targets_separated", migration)
        self.assertIn("target_match_facts_forbidden", migration)
        self.assertIn("previous_match.kickoff_at < p_cutoff_at", migration)
        self.assertIn("team_stat.collected_at <= p_cutoff_at", migration)
        self.assertIn("standing.snapshot_at <= p_cutoff_at", migration)
        self.assertIn("consensus.snapshot_at <= candidate.cutoff_at", migration)
        self.assertIn("lineup.updated_at <= candidate.cutoff_at", migration)
        self.assertIn("target_match_facts_used', false", migration)
        self.assertIn("provider_calls', 0", migration)
        self.assertIn("automatic_predictions', false", migration)
        self.assertIn("SECURITY INVOKER", migration)

    @patch.object(phase8f.HighlightlyRepository, "from_environment")
    def test_dry_run_only_reads_report(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"enabled": False}
        }
        repository.rpc.return_value = {
            "feature_sets": [],
            "automatic_predictions": False,
        }

        with patch("builtins.print") as output:
            result = phase8f.main(
                [
                    "--from",
                    "2026-07-20T00:00:00+00:00",
                    "--to",
                    "2026-07-21T00:00:00+00:00",
                ]
            )

        self.assertEqual(result, 0)
        repository.rpc.assert_called_once_with(
            "get_highlightly_feature_store_report",
            {"p_sport": "football", "p_days": 30},
        )
        payload = json.loads(output.call_args.args[0])
        self.assertEqual(payload["mode"], "dry-run")
        self.assertEqual(payload["provider_calls"], 0)
        self.assertEqual(payload["labels_generated"], 0)
        self.assertFalse(payload["automatic_predictions"])

    @patch.object(phase8f.HighlightlyRepository, "from_environment")
    def test_confirmed_run_materializes_then_reads_report(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"enabled": False}
        }
        repository.rpc.side_effect = [
            {"snapshots_inserted": 3, "provider_calls": 0},
            {"feature_sets": [{"snapshots": 3}]},
        ]

        with patch("builtins.print"):
            result = phase8f.main(
                [
                    "--from",
                    "2026-07-20T00:00:00+00:00",
                    "--to",
                    "2026-07-21T00:00:00+00:00",
                    "--horizon",
                    "t6h",
                    "--limit",
                    "10",
                    "--confirm-materialize",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(
            repository.rpc.call_args_list[0].args,
            (
                "materialize_highlightly_football_features",
                {
                    "p_from": "2026-07-20T00:00:00+00:00",
                    "p_to": "2026-07-21T00:00:00+00:00",
                    "p_horizon_key": "t6h",
                    "p_limit": 10,
                },
            ),
        )
        self.assertEqual(
            repository.rpc.call_args_list[1].args[0],
            "get_highlightly_feature_store_report",
        )

    @patch.object(phase8f.HighlightlyRepository, "from_environment")
    def test_refuses_to_run_when_provider_is_enabled(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"enabled": True}
        }

        with self.assertRaisesRegex(RuntimeError, "must be disabled"):
            phase8f.main(
                [
                    "--from",
                    "2026-07-20T00:00:00+00:00",
                    "--to",
                    "2026-07-21T00:00:00+00:00",
                ]
            )
        repository.rpc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
