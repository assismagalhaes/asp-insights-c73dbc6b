from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260729154431_create_highlightly_phase8g1_settlement_preview.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/highlightly_phase8g1_settlement_preview_smoke.sql"
)


class HighlightlyPhase8G1SettlementPreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8").casefold()
        cls.smoke = SMOKE.read_text(encoding="utf-8").casefold()

    def test_preview_is_bounded_read_only_and_provider_free(self):
        self.assertIn(
            "get_highlightly_label_settlement_preview_v1",
            self.migration,
        )
        self.assertIn("p_limit integer default 100", self.migration)
        self.assertIn("p_limit > 200", self.migration)
        self.assertIn("'provider_calls', 0", self.migration)
        self.assertIn("'labels_written', 0", self.migration)
        self.assertIn("'automatic_training', false", self.migration)
        self.assertIn("'automatic_predictions', false", self.migration)
        self.assertNotIn("set_provider_enabled", self.migration)

    def test_preview_requires_finalized_unambiguous_matches(self):
        self.assertIn("match_row.status = 'finished'", self.migration)
        self.assertIn("ended_at_missing", self.migration)
        self.assertIn("participant_identity_collision", self.migration)
        self.assertIn("score_missing_or_invalid", self.migration)
        self.assertIn(
            "terminal_state_requires_manual_review",
            self.migration,
        )
        self.assertIn("goal_event_count_mismatch", self.migration)
        self.assertIn(
            "corners_missing_for_one_or_both_teams",
            self.migration,
        )

    def test_all_market_settlements_are_deterministic(self):
        for family in (
            "full_time_result",
            "total_goals",
            "both_teams_to_score",
            "first_team_to_score",
            "asian_handicap",
            "total_corners",
        ):
            self.assertIn(f"'{family}'", self.migration)
        for outcome in (
            "home_cover",
            "away_cover",
            "over",
            "under",
            "yes",
            "no",
            "none",
        ):
            self.assertIn(f"'{outcome}'", self.migration)

    def test_report_is_security_invoker_and_contains_no_writes(self):
        self.assertIn("security invoker", self.migration)
        self.assertIn("from public, anon", self.migration)
        self.assertIn("to authenticated, service_role", self.migration)
        function_sql = self.migration.split(
            "create or replace function "
            "public.get_highlightly_label_settlement_preview_v1",
            maxsplit=1,
        )[1]
        function_sql = function_sql.split(
            "revoke all on function "
            "public.get_highlightly_label_settlement_preview_v1",
            maxsplit=1,
        )[0]
        self.assertNotIn("insert into", function_sql)
        self.assertNotIn("update public.", function_sql)
        self.assertNotIn("delete from", function_sql)

    def test_smoke_covers_six_real_settlement_examples(self):
        for label_key in (
            "full_time_result",
            "total_goals_2_5",
            "both_teams_to_score",
            "first_team_to_score",
            "asian_handicap_home_minus_0_5",
            "total_corners_8_5",
        ):
            self.assertIn(f"'{label_key}'", self.smoke)
        self.assertIn("labels_after <> labels_before", self.smoke)
        self.assertIn("provider must remain disabled", self.smoke)
        self.assertIn("partial-resource split is invalid", self.smoke)
        self.assertIn("ready_definitions')::integer <> 18", self.smoke)


if __name__ == "__main__":
    unittest.main()
