import json
import unittest
from unittest.mock import Mock, patch

from scripts import accept_highlightly_quarantined_wnba_standings as acceptance


class HighlightlyWnbaQuarantineAcceptanceTests(unittest.TestCase):
    @patch.object(acceptance.HighlightlyRepository, "from_environment")
    def test_dry_run_requires_exact_corruption_fingerprint(self, repository_factory):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        issue = {
            "id": "issue-1",
            "run_id": "run-1",
            "issue_code": acceptance.ISSUE_CODE,
            "severity": "critical",
            "resolution_status": "open",
            "endpoint_key": acceptance.ENDPOINT,
            "details": {
                "context": {
                    "leagueId": 11847,
                    "rows": 30,
                    "distinctTeams": 1,
                    "duplicateWithinGroup": True,
                }
            },
        }
        repository.select_rows.side_effect = [
            [issue],
            [{"id": "run-1", "job_id": "job-1"}],
            [{"id": "job-1", "shadow_scope": "phase7-history"}],
        ]

        with patch(
            "sys.argv", ["accept", "--scope", "phase7-history"]
        ), patch("builtins.print") as output:
            exit_code = acceptance.main()

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_not_called()
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["eligible"], 1)
        self.assertEqual(report["league_id"], "11847")

    @patch.object(acceptance.HighlightlyRepository, "from_environment")
    def test_confirmed_acceptance_is_exact_and_leaves_provider_disabled(
        self, repository_factory
    ):
        repository = Mock()
        repository_factory.return_value = repository
        repository.ingestion_context.return_value = {
            "provider": {"id": "provider-1", "enabled": False}
        }
        issue = {
            "id": "issue-1",
            "run_id": "run-1",
            "issue_code": acceptance.ISSUE_CODE,
            "severity": "critical",
            "resolution_status": "open",
            "endpoint_key": acceptance.ENDPOINT,
            "details": {
                "context": {
                    "leagueId": 11847,
                    "rows": 30,
                    "distinctTeams": 1,
                    "duplicateWithinGroup": True,
                }
            },
        }
        repository.select_rows.side_effect = [
            [issue],
            [{"id": "run-1", "job_id": "job-1"}],
            [{"id": "job-1", "shadow_scope": "phase7-history"}],
            [],
            [],
        ]
        repository.rpc.return_value = 1

        with patch(
            "sys.argv",
            [
                "accept",
                "--scope",
                "phase7-history",
                "--confirm-accept",
            ],
        ), patch("builtins.print") as output:
            exit_code = acceptance.main()

        self.assertEqual(exit_code, 0)
        repository.rpc.assert_called_once_with(
            "accept_highlightly_quarantined_wnba_standings_issues",
            {"p_scope": "phase7-history"},
        )
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["accepted"], 1)
        self.assertEqual(report["remaining"], 0)
        self.assertTrue(report["provider_disabled_after"])


if __name__ == "__main__":
    unittest.main()
