from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONSENSUS = ROOT / "supabase" / "migrations" / "20260715190000_lower_highlightly_consensus_minimum.sql"
READ_MODELS = ROOT / "supabase" / "migrations" / "20260715101000_create_highlightly_baseball_read_models.sql"


class HighlightlyPhaseThreeContractTests(unittest.TestCase):
    def setUp(self):
        self.consensus = CONSENSUS.read_text(encoding="utf-8")
        self.read_models = READ_MODELS.read_text(encoding="utf-8")

    def test_consensus_uses_two_to_seven_preferred_bookmakers(self):
        self.assertIn("bookmaker.is_preferred", self.consensus)
        self.assertIn("p_min_bookmakers integer DEFAULT 2", self.consensus)
        self.assertIn("p_max_bookmakers < 2 OR p_max_bookmakers > 7", self.consensus)
        self.assertIn("p_min_bookmakers < 2 OR p_min_bookmakers > p_max_bookmakers", self.consensus)
        self.assertIn("percentile_cont(0.5)", self.consensus)
        self.assertIn("percentile_cont(0.75)", self.consensus)
        self.assertIn("percentile_cont(0.25)", self.consensus)
        self.assertIn("preference_rank <= p_max_bookmakers", self.consensus)

    def test_consensus_writer_is_service_role_only(self):
        self.assertRegex(self.consensus, r"REVOKE ALL ON FUNCTION public\.refresh_sports_odds_consensus\(")
        self.assertRegex(
            self.consensus,
            r"GRANT EXECUTE ON FUNCTION public\.refresh_sports_odds_consensus\([\s\S]*?\) TO service_role;",
        )
        self.assertNotRegex(
            self.consensus,
            r"GRANT EXECUTE ON FUNCTION public\.refresh_sports_odds_consensus\([\s\S]*?\) TO (?:anon|authenticated);",
        )

    def test_baseball_read_models_are_admin_only_and_keyset_paginated(self):
        self.assertIn("WITH (security_invoker = true)", self.read_models)
        self.assertIn("public.has_role(auth.uid(), 'admin'::public.app_role)", self.read_models)
        self.assertIn(
            "(summary.kickoff_at, summary.match_id) > (p_cursor_kickoff, p_cursor_match_id)",
            self.read_models,
        )
        self.assertIn("p_limit must be between 1 and 200", self.read_models)
        self.assertIn("REVOKE ALL ON FUNCTION public.get_baseball_match_detail(uuid) FROM PUBLIC, anon", self.read_models)

    def test_baseball_detail_exposes_phase_three_domains(self):
        for key in (
            "teamStatistics",
            "teamFormStatistics",
            "odds",
            "oddsConsensus",
            "oddsMovement",
            "lineups",
            "startingPitcherStatistics",
            "events",
            "playerBoxScores",
            "standings",
            "highlights",
            "analyticsPresets",
        ):
            with self.subTest(key=key):
                self.assertIn(f"'{key}'", self.read_models)

    def test_quarantined_standings_never_reach_read_model(self):
        self.assertIn("standing.quality_status = 'valid'", self.read_models)
        self.assertIn("latest.quality_status = 'valid'", self.read_models)

    def test_starting_pitcher_requires_starter_pitcher_semantics(self):
        self.assertIn("member.role = 'starter'", self.read_models)
        self.assertIn("positionAbbreviation", self.read_models)
        self.assertIn("isStartingPitcher", self.read_models)


if __name__ == "__main__":
    unittest.main()
