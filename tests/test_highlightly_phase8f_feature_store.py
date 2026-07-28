import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from scripts import materialize_highlightly_phase8f_features as phase8f


ROOT = Path(__file__).resolve().parents[1]


class HighlightlyPhaseEightFFeatureStoreTests(unittest.TestCase):
    def test_phase8f2_uses_horizon_adjusted_coverage_and_draft_v110(self):
        migration = (
            ROOT
            / "supabase/migrations/20260728212259_create_highlightly_phase8f2_horizon_policy.sql"
        ).read_text(encoding="utf-8")

        self.assertIn("'1.1.0'", migration)
        self.assertIn("'component_policy'", migration)
        self.assertIn("'t24h'", migration)
        self.assertIn("'t6h'", migration)
        self.assertIn("'t60m'", migration)
        self.assertIn("'required'", migration)
        self.assertIn("'optional'", migration)
        self.assertIn("materialize_highlightly_football_features_v2", migration)
        self.assertIn("get_highlightly_feature_store_report_v4", migration)
        self.assertIn("stored_average_coverage_pct", migration)
        self.assertIn("policy_adjusted_average_coverage_pct", migration)
        self.assertIn("ready_for_100_match_canary", migration)
        self.assertIn("'automatic_training', false", migration)
        self.assertIn("'automatic_predictions', false", migration)
        self.assertIn("SECURITY INVOKER", migration)
        self.assertIn("FROM PUBLIC, anon, authenticated", migration)

    def test_phase8f11_report_returns_structured_component_records(self):
        migration = (
            ROOT
            / "supabase/migrations/20260728210351_fix_highlightly_phase8f1_component_payload.sql"
        ).read_text(encoding="utf-8")

        self.assertIn("get_highlightly_feature_store_report_v3", migration)
        self.assertIn("to_jsonb(component_summary)", migration)
        self.assertIn("available_snapshots", migration)
        self.assertIn("missing_snapshots", migration)
        self.assertIn("availability_pct", migration)
        self.assertIn("phase8f.1.1", migration)
        self.assertIn("SECURITY INVOKER", migration)
        self.assertIn("FROM PUBLIC, anon", migration)

    def test_phase8f1_report_segments_components_leagues_and_integrity(self):
        migration = (
            ROOT
            / "supabase/migrations/20260728200516_create_highlightly_phase8f1_feature_coverage_report.sql"
        ).read_text(encoding="utf-8")

        self.assertIn("get_highlightly_feature_store_report_v2", migration)
        self.assertIn("'components'", migration)
        self.assertIn("'leagues'", migration)
        self.assertIn("'integrity'", migration)
        self.assertIn("'labels'", migration)
        self.assertIn("'blocked_by_leakage'", migration)
        self.assertIn("'improve_component_coverage'", migration)
        self.assertIn("'ready_for_100_match_canary'", migration)
        self.assertIn("'automatic_training', false", migration)
        self.assertIn("'automatic_predictions', false", migration)
        self.assertIn("SECURITY INVOKER", migration)
        self.assertIn("FROM PUBLIC, anon", migration)

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
            "get_highlightly_feature_store_report_v4",
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
                "materialize_highlightly_football_features_v2",
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
            "get_highlightly_feature_store_report_v4",
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
