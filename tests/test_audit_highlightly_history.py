import unittest

from api.audit_highlightly_history import (
    AuditState,
    build_summary,
    league_identity,
    parse_dates,
    player_ids,
    standing_entries,
    standings_request,
    standings_quality_codes,
)


class AuditHighlightlyHistoryTests(unittest.TestCase):
    def test_parse_dates_validates_and_deduplicates(self):
        self.assertEqual(parse_dates("2026-08-01,2025-08-01,2026-08-01"), ("2026-08-01", "2025-08-01"))
        with self.assertRaises(ValueError):
            parse_dates("not-a-date")

    def test_extracts_football_and_baseball_player_ids(self):
        self.assertEqual(player_ids("football", {"data": [{"players": [{"id": 2}, {"id": 1}]}]}), [1, 2])
        self.assertEqual(
            player_ids("baseball", {"data": [{"boxScores": [{"player": {"id": 9}}]}]}),
            [9],
        )

    def test_builds_sport_specific_standings_requests(self):
        football = league_identity("football", {"league": {"id": 10, "name": "League", "season": 2026}})
        baseball = league_identity("baseball", {"league": "MLB", "season": 2026})
        self.assertEqual(standings_request("football", football), ("/football/standings", {"leagueId": 10, "season": 2026}))
        self.assertEqual(
            standings_request("baseball", baseball),
            ("/baseball/standings", {"leagueName": "MLB", "year": 2026, "limit": 100, "offset": 0}),
        )

    def test_budget_preserves_provider_reserve(self):
        state = AuditState(max_calls=5, reserve=750, calls=1, rate_remaining=750)
        self.assertFalse(state.can_call())

    def test_counts_standing_positions_and_marks_wnba_quarantine(self):
        payload = {
            "data": [
                {
                    "groups": [
                        {"standings": [{"team": {"id": 1}}, {"team": {"id": 2}}]},
                    ]
                }
            ]
        }
        self.assertEqual(len(standing_entries(payload)), 2)
        self.assertEqual(
            standings_quality_codes("basketball", "NBA Women:2026", payload),
            ["BASKETBALL_STANDINGS_PROVIDER_QUARANTINED"],
        )

    def test_counts_direct_standings_groups_returned_by_provider(self):
        payload = {"data": [{"name": "Overall", "standings": [{"team": {"id": 1}}, {"team": {"id": 2}}]}]}
        self.assertEqual(len(standing_entries(payload)), 2)
        self.assertEqual(standings_quality_codes("football", "League:2026", payload), [])

    def test_marks_empty_standings(self):
        self.assertEqual(standings_quality_codes("baseball", "MLB:2026", {"data": []}), ["STANDINGS_EMPTY"])

    def test_summary_segments_coverage_by_sport_and_league(self):
        state = AuditState(max_calls=10, reserve=750)
        state.records = [
            {"sport": "football", "endpoint": "match_coverage", "date": "2026-08-01", "league": "League:2026", "status": 200},
            {"sport": "football", "endpoint": "standings", "date": "2026-08-01", "league": "League:2026", "status": 200},
        ]
        summary = build_summary(state, ("2026-08-01",))
        self.assertEqual(summary["league_coverage"][0]["dates"], ["2026-08-01"])
        self.assertEqual(summary["league_coverage"][0]["endpoints"]["standings"], 200)


if __name__ == "__main__":
    unittest.main()
