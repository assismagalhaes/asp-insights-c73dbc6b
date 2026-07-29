from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729165943_harden_highlightly_phase8g11_terminal_observation.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/highlightly_phase8g11_terminal_observation_smoke.sql"
)


class HighlightlyPhase8G11TerminalObservationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8").casefold()
        cls.smoke = SMOKE.read_text(encoding="utf-8").casefold()

    def test_terminal_fallback_requires_matching_finished_evidence(self):
        self.assertIn("provider_finished_observation", self.migration)
        self.assertIn("provider_entity.entity_type = 'match'", self.migration)
        self.assertIn("provider.code = 'highlightly'", self.migration)
        self.assertIn(") = 'finished'", self.migration)
        self.assertIn("score_must_match_canonical", self.migration)
        self.assertIn(
            "provider_entity.last_seen_at >= source_match.kickoff_at",
            self.migration,
        )
        self.assertNotIn(
            "coalesce(\n        source_match.ended_at,\n"
            "        source_match.updated_at",
            self.migration,
        )

    def test_v2_is_bounded_read_only_and_provider_free(self):
        self.assertIn(
            "get_highlightly_label_settlement_preview_v2",
            self.migration,
        )
        self.assertIn("p_limit > 200", self.migration)
        self.assertIn("security invoker", self.migration)
        self.assertIn("from public, anon", self.migration)
        self.assertIn("to authenticated, service_role", self.migration)
        self.assertIn("'provider_calls', 0", self.migration)
        self.assertIn("'labels_written', 0", self.migration)
        self.assertNotIn("set_provider_enabled", self.migration)

        function_sql = self.migration.split(
            "create or replace function\n"
            "  public.get_highlightly_label_settlement_preview_v2",
            maxsplit=1,
        )[1]
        function_sql = function_sql.split(
            "revoke all on function",
            maxsplit=1,
        )[0]
        self.assertNotIn("insert into", function_sql)
        self.assertNotIn("update public.", function_sql)
        self.assertNotIn("delete from", function_sql)

    def test_ambiguous_terminal_states_remain_blocked_by_v1_gate(self):
        self.assertIn(
            "original_base_block_reason\n          = 'ended_at_missing'",
            self.migration.replace("\r", ""),
        )
        self.assertNotIn(
            "terminal_state_requires_manual_review'\n"
            "          then null",
            self.migration,
        )

    def test_smoke_proves_score_only_unlock_and_zero_side_effects(self):
        self.assertIn("provider_finished_observation", self.smoke)
        self.assertIn("ready_definitions')::integer <> 18", self.smoke)
        self.assertIn("first_team_to_score,status", self.smoke)
        self.assertIn("total_corners,status", self.smoke)
        self.assertIn("labels_after <> labels_before", self.smoke)
        self.assertIn("provider must remain disabled", self.smoke)


if __name__ == "__main__":
    unittest.main()
