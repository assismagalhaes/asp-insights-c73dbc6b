from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
FACTS = ROOT / "supabase" / "migrations" / "20260715050000_create_highlightly_sports_facts.sql"
ODDS = ROOT / "supabase" / "migrations" / "20260715051000_create_highlightly_odds_foundation.sql"
READ_MODELS = ROOT / "supabase" / "migrations" / "20260715052000_create_highlightly_football_read_models.sql"


class HighlightlyPhaseTwoContractTests(unittest.TestCase):
    def setUp(self):
        self.facts = FACTS.read_text(encoding="utf-8")
        self.odds = ODDS.read_text(encoding="utf-8")
        self.read_models = READ_MODELS.read_text(encoding="utf-8")
        self.all_sql = "\n".join((self.facts, self.odds, self.read_models))

    def test_all_phase_two_fact_tables_are_created(self):
        expected = {
            "sports_match_team_stats",
            "sports_team_season_stats",
            "sports_player_stats",
            "sports_player_box_scores",
            "sports_lineups",
            "sports_lineup_players",
            "sports_match_events",
            "sports_standings_snapshots",
            "sports_highlights",
            "sports_market_definitions",
            "sports_odds_current",
            "sports_odds_history",
            "sports_odds_consensus",
        }
        created = set(re.findall(r"CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+)", self.all_sql))
        self.assertTrue(expected.issubset(created), expected - created)

    def test_dynamic_metrics_keep_exactly_one_typed_value(self):
        for table in (
            "sports_match_team_stats",
            "sports_team_season_stats",
            "sports_player_stats",
            "sports_player_box_scores",
        ):
            with self.subTest(table=table):
                self.assertRegex(
                    self.facts,
                    rf"CONSTRAINT {table}_one_value CHECK \(\s*num_nonnulls\(numeric_value, text_value, boolean_value, json_value\) = 1",
                )

    def test_odds_history_is_change_only_and_serialized(self):
        self.assertIn("pg_advisory_xact_lock", self.odds)
        self.assertIn("FOR UPDATE", self.odds)
        self.assertIn("RETURN current_row;", self.odds)
        self.assertIn("ON CONFLICT (quote_fingerprint) DO NOTHING", self.odds)
        self.assertIn("change_kind := 'opening'", self.odds)
        self.assertNotIn("pg_catalog.digest", self.odds)

    def test_odds_writer_is_service_role_only(self):
        self.assertRegex(self.odds, r"REVOKE ALL ON FUNCTION public\.upsert_sports_odds_quote\(")
        self.assertRegex(
            self.odds,
            r"GRANT EXECUTE ON FUNCTION public\.upsert_sports_odds_quote\([\s\S]*?\) TO service_role;",
        )
        self.assertNotRegex(
            self.odds,
            r"GRANT EXECUTE ON FUNCTION public\.upsert_sports_odds_quote\([\s\S]*?\) TO (?:anon|authenticated);",
        )
        self.assertIn("jsonb_array_length(p_quotes) > 1000", self.odds)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.upsert_sports_odds_quotes(jsonb) TO service_role", self.odds)

    def test_phase_two_tables_are_admin_read_and_never_anon(self):
        for sql in (self.facts, self.odds):
            self.assertIn("ENABLE ROW LEVEL SECURITY", sql)
            self.assertIn("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated", sql)
            self.assertIn("GRANT SELECT ON TABLE public.%I TO authenticated", sql)
            self.assertIn("public.has_role", sql)
        self.assertNotRegex(self.all_sql, r"GRANT\s+(?:SELECT|ALL).*\sTO\s+anon")

    def test_read_models_use_admin_guard_and_keyset_pagination(self):
        self.assertIn("WITH (security_invoker = true)", self.read_models)
        self.assertIn("public.has_role(auth.uid(), 'admin'::public.app_role)", self.read_models)
        self.assertIn(
            "(summary.kickoff_at, summary.match_id) > (p_cursor_kickoff, p_cursor_match_id)",
            self.read_models,
        )
        self.assertIn("p_limit must be between 1 and 200", self.read_models)
        self.assertIn("REVOKE ALL ON FUNCTION public.get_football_match_detail(uuid) FROM PUBLIC, anon", self.read_models)

    def test_match_detail_exposes_every_phase_two_domain(self):
        for key in (
            "periodScores",
            "teamStatistics",
            "teamFormStatistics",
            "odds",
            "oddsConsensus",
            "lineups",
            "events",
            "playerBoxScores",
            "standings",
            "highlights",
        ):
            with self.subTest(key=key):
                self.assertIn(f"'{key}'", self.read_models)


if __name__ == "__main__":
    unittest.main()
