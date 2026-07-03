from __future__ import annotations

import unittest

from scrapers.oddsagora_normalizer import is_half_point_line, normalize_oddsagora_raw


class OddsAgoraNormalizerTests(unittest.TestCase):
    def test_half_point_line_filter(self) -> None:
        self.assertTrue(is_half_point_line("8.5"))
        self.assertTrue(is_half_point_line("-1.5"))
        self.assertFalse(is_half_point_line("8"))
        self.assertFalse(is_half_point_line("1.25"))

    def test_normalize_filters_totals_and_handicap_to_half_lines(self) -> None:
        raw = {
            "job_id": "job-1",
            "source": "OddsAgora",
            "sport": "Baseball",
            "league": "MLB",
            "games": [
                {
                    "game_id": "SlHmU8og",
                    "date": "2026-07-03",
                    "time": "20:05",
                    "home_team": "Chicago Cubs",
                    "away_team": "St. Louis Cardinals",
                    "match_url": "https://www.oddsagora.com.br/baseball/h2h/a/b/#SlHmU8og:home-away;1",
                    "markets": {
                        "home-away": [
                            {"bookmaker": "Superbet.br", "home_odd": 1.74, "away_odd": 2.1},
                            {"bookmaker": "Bet365", "home_odd": 1.8, "away_odd": 2.05},
                        ],
                        "over-under": [
                            {"bookmaker": "Superbet.br", "line": 8.5, "odd_over": 1.46, "odd_under": 2.67},
                            {"bookmaker": "Superbet.br", "line": 8, "odd_over": 1.9, "odd_under": 1.9},
                        ],
                        "ah": [
                            {"bookmaker": "Superbet.br", "line": 1.5, "home_odd": 1.49, "away_odd": 2.65},
                            {"bookmaker": "Superbet.br", "line": 1, "home_odd": 1.7, "away_odd": 2.1},
                        ],
                    },
                }
            ],
        }

        normalized = normalize_oddsagora_raw(raw)
        rows = normalized["linhas"]
        totals = [row for row in rows if row["market"] == "Over/Under"]
        handicaps = [row for row in rows if row["market"] == "Asian Handicap"]

        self.assertEqual(normalized["status"], "CONCLUIDA")
        self.assertEqual({row["line"] for row in totals}, {8.5})
        self.assertEqual({abs(row["line"]) for row in handicaps}, {1.5})
        self.assertTrue(all(row["odd_best"] >= row["odd"] for row in rows))
        self.assertTrue(all("market_prob_consensus_median" in row for row in rows))


if __name__ == "__main__":
    unittest.main()
