from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260730162000_fix_highlightly_phase8g43_null_terminal_rejections.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g43_null_terminal_rejections_smoke.sql"
)


class HighlightlyPhase8G43NullTerminalRejectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")

    def test_permanent_rejection_does_not_require_terminal_observation(
        self,
    ) -> None:
        match = re.search(
            r"WHERE source\.block_reason IN \((.*?)\)"
            r"\s+ON CONFLICT \(match_id, label_version\)",
            self.migration,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(match)
        rejection_filter = match.group(1)
        self.assertIn(
            "terminal_state_requires_manual_review",
            rejection_filter,
        )
        self.assertIn(
            "participant_identity_collision",
            rejection_filter,
        )
        self.assertNotIn(
            "terminal_observed_at IS NOT NULL",
            rejection_filter,
        )

    def test_rejected_label_has_non_null_outcome_timestamp_fallback(
        self,
    ) -> None:
        self.assertRegex(
            self.migration,
            re.compile(
                r"COALESCE\(\s*source\.terminal_observed_at,"
                r"\s*source\.kickoff_at,\s*statement_timestamp\(\)"
                r"\s*\)",
                flags=re.DOTALL,
            ),
        )
        self.assertIn("'null_terminal_rejection_fix', true", self.migration)
        self.assertIn("source.kickoff_at", self.smoke)

    def test_security_and_provider_rest_contract_remain_locked(
        self,
    ) -> None:
        self.assertEqual(self.migration.count("SECURITY INVOKER"), 1)
        self.assertIn(
            "FROM PUBLIC, anon, authenticated",
            self.migration,
        )
        self.assertIn("TO service_role", self.migration)
        self.assertIn(
            "Highlightly provider must remain disabled",
            self.smoke,
        )


if __name__ == "__main__":
    unittest.main()
