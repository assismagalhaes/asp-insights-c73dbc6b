from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/20260729144105_create_highlightly_phase8g0_label_contract.sql"
)
SMOKE = ROOT / "supabase/tests/highlightly_phase8g0_label_contract_smoke.sql"


class HighlightlyPhase8G0LabelContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8").casefold()
        cls.smoke = SMOKE.read_text(encoding="utf-8").casefold()

    def test_catalog_is_versioned_draft_and_provider_free(self):
        self.assertIn("create table if not exists public.hl_label_sets", self.migration)
        self.assertIn(
            "create table if not exists public.hl_label_definitions",
            self.migration,
        )
        self.assertIn("'highlightly_football_postmatch'", self.migration)
        self.assertIn("'1.0.0'", self.migration)
        self.assertIn("'automatic_generation', false", self.migration)
        self.assertIn("'automatic_training', false", self.migration)
        self.assertIn("'automatic_predictions', false", self.migration)
        self.assertNotIn("set_provider_enabled", self.migration)

    def test_all_approved_football_market_families_are_declared(self):
        for market_family in (
            "full_time_result",
            "total_goals",
            "both_teams_to_score",
            "first_team_to_score",
            "asian_handicap",
            "total_corners",
        ):
            self.assertIn(f"'{market_family}'", self.migration)
        self.assertIn("generate_series(1, 19, 2)", self.migration)
        self.assertIn("generate_series(13, 27, 2)", self.migration)
        self.assertIn("(-3.5::numeric)", self.migration)

    def test_report_is_read_only_security_invoker(self):
        self.assertIn(
            "get_highlightly_label_contract_report_v1",
            self.migration,
        )
        self.assertIn("security invoker", self.migration)
        self.assertIn("from public, anon", self.migration)
        self.assertIn("to authenticated, service_role", self.migration)
        function_sql = self.migration.split(
            "create or replace function "
            "public.get_highlightly_label_contract_report_v1",
            maxsplit=1,
        )[1]
        function_sql = function_sql.split(
            "revoke all on function "
            "public.get_highlightly_label_contract_report_v1",
            maxsplit=1,
        )[0]
        self.assertNotIn("insert into", function_sql)
        self.assertNotIn("update public.", function_sql)
        self.assertNotIn("delete from", function_sql)

    def test_smoke_guards_zero_label_side_effects(self):
        self.assertIn("labels_after <> labels_before", self.smoke)
        self.assertIn("provider must remain disabled", self.smoke)
        self.assertIn("definition_count", self.smoke)
        self.assertIn("provider_calls", self.smoke)


if __name__ == "__main__":
    unittest.main()
