import unittest

from api.highlightly_adapter import normalize_odds


class HighlightlyAdapterTests(unittest.TestCase):
    def test_joins_match_and_normalizes_total_market(self):
        matches = [{
            "id": 42,
            "date": "2026-07-14T15:00:00.000Z",
            "country": {"name": "USA"},
            "league": {"name": "NBA Women"},
            "homeTeam": {"name": "Connecticut Sun Women"},
            "awayTeam": {"name": "Portland Women"},
        }]
        odds = {"data": [{"matchId": 42, "odds": [{
            "bookmakerId": 4,
            "bookmakerName": "Pinnacle",
            "type": "prematch",
            "market": "Total Points 161.5",
            "values": [{"odd": 1.91, "value": "Over"}, {"odd": 1.95, "value": "Under"}],
        }]}]}

        rows = normalize_odds(odds, matches, sport="Basketball")

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["linha"], "161.5")
        self.assertEqual(rows[0]["pick"], "Over 161.5")
        self.assertEqual(rows[0]["mandante"], "Connecticut Sun Women")
        self.assertEqual(rows[0]["bookmaker"], "Pinnacle")
        self.assertEqual(rows[0]["raw_ref"]["match_id"], "42")

    def test_maps_home_away_and_draw(self):
        matches = [{"id": 9, "homeTeam": {"name": "A"}, "awayTeam": {"name": "B"}}]
        odds = {"data": [{"matchId": 9, "odds": [{
            "bookmakerId": 1,
            "market": "Full Time Result",
            "values": [
                {"odd": 2, "value": "Home"},
                {"odd": 3, "value": "Draw"},
                {"odd": 4, "value": "Away"},
            ],
        }]}]}

        self.assertEqual([r["pick"] for r in normalize_odds(odds, matches, sport="Football")], ["A", "Empate", "B"])

    def test_maps_paired_handicap_line_to_each_team(self):
        matches = [{"id": 7, "homeTeam": {"name": "A"}, "awayTeam": {"name": "B"}}]
        odds = {"data": [{"matchId": 7, "odds": [{
            "bookmakerName": "1Bet",
            "market": "Asian Handicap -0.5/+0.5",
            "values": [{"odd": 1.76, "value": "Home"}, {"odd": 2.0, "value": "Away"}],
        }]}]}

        rows = normalize_odds(odds, matches, sport="Football")

        self.assertEqual([(row["pick"], row["linha"]) for row in rows], [("A", "-0.5"), ("B", "+0.5")])

    def test_does_not_treat_three_way_moneyline_as_line(self):
        matches = [{"id": 8, "homeTeam": {"name": "A"}, "awayTeam": {"name": "B"}}]
        odds = {"data": [{"matchId": 8, "odds": [{
            "bookmakerName": "Pinnacle",
            "market": "3-Way Moneyline",
            "values": [{"odd": 2.2, "value": "Home"}],
        }]}]}

        self.assertEqual(normalize_odds(odds, matches, sport="Basketball")[0]["linha"], "")


if __name__ == "__main__":
    unittest.main()
