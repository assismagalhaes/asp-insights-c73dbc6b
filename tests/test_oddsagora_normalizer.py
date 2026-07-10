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
        home_moneyline = [row for row in rows if row["market"] == "Home/Away" and row["side"] == "home"]
        self.assertEqual(len(home_moneyline), 2)
        self.assertTrue(all(row["casas_count"] == 2 for row in home_moneyline))
        self.assertTrue(all(row["odds_disponiveis"] == 2 for row in home_moneyline))
        self.assertTrue(all(row["odd_media"] == row["odd_avg"] for row in home_moneyline))
        self.assertAlmostEqual(home_moneyline[0]["odd_media"], 1.77)
        self.assertEqual(home_moneyline[0]["odd_melhor"], 1.8)
        self.assertEqual(home_moneyline[0]["bookmaker_melhor"], "Bet365")
        self.assertIn("probabilidade_implicita_media", home_moneyline[0])

    def test_normalize_baseball_oakland_athletics_to_athletics(self) -> None:
        raw = {
            "job_id": "job-ath",
            "source": "OddsAgora",
            "sport": "Baseball",
            "league": "MLB",
            "games": [
                {
                    "game_id": "abc12345",
                    "date": "2026-07-03",
                    "time": "22:40",
                    "home_team": "Oakland Athletics ",
                    "away_team": "Miami Marlins",
                    "jogo": "Oakland Athletics vs Miami Marlins",
                    "markets": {
                        "home-away": [
                            {"bookmaker": "Bet365", "home_odd": 1.80, "away_odd": 2.11},
                        ],
                        "ah": [
                            {"bookmaker": "Bet365", "line": 1.5, "home_odd": 1.60, "away_odd": 2.40},
                        ],
                    },
                }
            ],
        }

        rows = normalize_oddsagora_raw(raw)["linhas"]
        home_rows = [row for row in rows if row["side"] == "home"]

        self.assertTrue(home_rows)
        self.assertTrue(all(row["mandante"] == "Athletics" for row in rows))
        self.assertTrue(all(row["home_team"] == "Athletics" for row in rows))
        self.assertTrue(all("Oakland Athletics" not in row["jogo"] for row in rows))
        self.assertIn("Athletics", {row["pick"].split(" +")[0].split(" -")[0] for row in home_rows})

    def test_normalize_wnba_team_suffix_f_to_w(self) -> None:
        raw = {
            "job_id": "job-wnba",
            "source": "OddsAgora",
            "sport": "Basketball",
            "league": "WNBA",
            "games": [
                {
                    "game_id": "nTkWK5dd",
                    "date": "2026-07-03",
                    "time": "20:00",
                    "home_team": "Chicago Sky F",
                    "away_team": "New York Liberty F",
                    "jogo": "Chicago Sky F vs New York Liberty F",
                    "markets": {
                        "home-away": [
                            {"bookmaker": "Bet365", "home_odd": 1.80, "away_odd": 2.10},
                        ],
                        "ah": [
                            {"bookmaker": "Bet365", "line": -4.5, "home_odd": 1.91, "away_odd": 1.91},
                        ],
                    },
                }
            ],
        }

        rows = normalize_oddsagora_raw(raw)["linhas"]

        self.assertTrue(rows)
        self.assertTrue(all(row["mandante"] == "Chicago Sky W" for row in rows))
        self.assertTrue(all(row["visitante"] == "New York Liberty W" for row in rows))
        self.assertTrue(all(row["jogo"] == "Chicago Sky W vs New York Liberty W" for row in rows))
        self.assertIn("Chicago Sky W", {row["pick"].split(" -")[0].split(" +")[0] for row in rows})
        self.assertNotIn("Chicago Sky F", {row["pick"].split(" -")[0].split(" +")[0] for row in rows})

    def test_normalize_wnba_handicap_inverts_away_line_from_oddsagora_pair(self) -> None:
        raw = {
            "job_id": "job-wnba-ah",
            "source": "OddsAgora",
            "sport": "Basketball",
            "league": "WNBA",
            "games": [
                {
                    "game_id": "nTkWK5dd",
                    "date": "2026-07-03",
                    "time": "20:00",
                    "home_team": "Chicago Sky F",
                    "away_team": "New York Liberty F",
                    "markets": {
                        "ah": [
                            {"bookmaker": "Book A", "line": -4.5, "home_odd": 1.91, "away_odd": 1.91},
                            {"bookmaker": "Book B", "line": 4.5, "home_odd": 2.30, "away_odd": 1.62},
                        ],
                    },
                }
            ],
        }

        rows = normalize_oddsagora_raw(raw)["linhas"]
        handicaps = [row for row in rows if row["market"] == "Asian Handicap"]
        by_book_side = {(row["bookmaker"], row["side"]): row for row in handicaps}

        self.assertEqual(by_book_side[("Book A", "home")]["pick"], "Chicago Sky W -4.5")
        self.assertEqual(by_book_side[("Book A", "home")]["linha"], "-4.5")
        self.assertEqual(by_book_side[("Book A", "away")]["pick"], "New York Liberty W 4.5")
        self.assertEqual(by_book_side[("Book A", "away")]["linha"], "4.5")
        self.assertEqual(by_book_side[("Book B", "home")]["pick"], "Chicago Sky W 4.5")
        self.assertEqual(by_book_side[("Book B", "away")]["pick"], "New York Liberty W -4.5")
        self.assertEqual({abs(row["line"]) for row in handicaps}, {4.5})

    def test_normalize_football_1x2_includes_draw(self) -> None:
        raw = {
            "job_id": "job-2",
            "source": "OddsAgora",
            "sport": "Football",
            "league": "Brazil - Brasileirao Betano",
            "games": [
                {
                    "game_id": "AbCd1234",
                    "date": "2026-07-03",
                    "time": "16:00",
                    "home_team": "Flamengo",
                    "away_team": "Palmeiras",
                    "sport": "Football",
                    "league": "Brazil - Brasileirao Betano",
                    "markets": {
                        "1x2": [
                            {"bookmaker": "Bet365", "home_odd": 2.1, "draw_odd": 3.2, "away_odd": 3.6},
                            {"bookmaker": "Superbet.br", "home_odd": 2.05, "draw_odd": 3.3, "away_odd": 3.7},
                        ],
                    },
                }
            ],
        }

        rows = normalize_oddsagora_raw(raw)["linhas"]
        draw_rows = [row for row in rows if row["market"] == "1X2" and row["side"] == "draw"]

        self.assertEqual(len(rows), 6)
        self.assertEqual(len(draw_rows), 2)
        self.assertEqual(draw_rows[0]["pick"], "Empate")
        self.assertEqual(draw_rows[0]["esporte"], "Football")
        self.assertEqual(draw_rows[0]["liga"], "Brazil - Brasileirao Betano")
        self.assertEqual(draw_rows[0]["casas_count"], 2)
        self.assertIn("probabilidade_implicita_media", draw_rows[0])

    def test_normalize_bts_and_double_chance(self) -> None:
        raw = {
            "job_id": "job-3",
            "source": "OddsAgora",
            "sport": "Football",
            "league": "Ireland - Divisao Premier",
            "games": [
                {
                    "game_id": "p6RseziI",
                    "date": "2026-07-03",
                    "time": "15:45",
                    "home_team": "Galway United",
                    "away_team": "St Patricks",
                    "markets": {
                        "1x2": [
                            {"bookmaker": "Bet365", "home_odd": 2.0, "draw_odd": 3.5, "away_odd": 3.8},
                        ],
                        "bts": [
                            {"bookmaker": "Bet365", "yes_odd": 1.8, "no_odd": 1.95},
                            {"bookmaker": "Superbet.br", "yes_odd": 1.82, "no_odd": 1.9},
                        ],
                        "double": [
                            {"bookmaker": "Bet365", "home_draw_odd": 1.25, "away_draw_odd": 1.45, "home_away_odd": 1.32},
                        ],
                    },
                }
            ],
        }

        rows = normalize_oddsagora_raw(raw)["linhas"]
        bts_rows = [row for row in rows if row["market"] == "Ambos Marcam"]
        double_rows = [row for row in rows if row["market"] == "Dupla Chance"]

        self.assertEqual({row["pick"] for row in bts_rows}, {"Sim", "Não"})
        self.assertEqual({row["pick"] for row in double_rows}, {"1X", "X2", "12"})
        self.assertTrue(all("odd_media" in row for row in bts_rows + double_rows))
        self.assertTrue(all(row["odds_consistency_status"] == "valid" for row in double_rows))
        self.assertTrue(all(row["market_overround_median"] is None for row in double_rows))

    def test_normalizer_blocks_swapped_double_chance_order(self) -> None:
        raw = {
            "job_id": "job-swapped-double",
            "source": "OddsAgora",
            "sport": "Football",
            "games": [{
                "game_id": "vps-sjk",
                "date": "2026-07-10",
                "time": "13:00",
                "home_team": "VPS",
                "away_team": "SJK",
                "markets": {
                    "1x2": [{
                        "bookmaker": "Bet365", "home_odd": 2.0, "draw_odd": 3.6, "away_odd": 3.25,
                    }],
                    "double": [{
                        "bookmaker": "Bet365",
                        "home_draw_odd": 1.35,
                        "home_away_odd": 1.78,
                        "away_draw_odd": 1.29,
                    }],
                },
            }],
        }

        rows = normalize_oddsagora_raw(raw)["linhas"]
        no_draw = next(row for row in rows if row["market"] == "Dupla Chance" and row["pick"] == "12")

        self.assertEqual(no_draw["odds_consistency_status"], "invalid")
        self.assertFalse(no_draw["odds_consistency_valid"])
        self.assertEqual(no_draw["odds_consistency_reason"], "INCONSISTENT_DOUBLE_CHANCE_ODDS")
        self.assertLess(no_draw["complement_implied_sum"], 0.95)


if __name__ == "__main__":
    unittest.main()
