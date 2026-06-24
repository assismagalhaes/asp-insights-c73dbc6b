from __future__ import annotations

import unittest

from modelos import basketball_runner_real
from scrapers.normalizer import normalize


class GlobalHandicapNormalizerRealFixTests(unittest.TestCase):
    def test_outcome_1_2_same_line_generates_opposite_away_line(self) -> None:
        rows = normalize(raw_game("Basketball", "WNBA", "Asian handicap", ["1", "2"], "-16.5", [3.95, 1.20]))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-16.5", "+16.5"])

    def test_team_name_outcomes_same_negative_line_generates_opposite_away_line(self) -> None:
        rows = normalize(raw_game("Basketball", "WNBA", "Asian handicap", ["Atlanta Dream W", "Indiana Fever W"], "-16.5", [3.95, 1.20]))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual(handicap[0]["linha"], "-16.5")
        self.assertEqual(handicap[1]["linha"], "+16.5")

    def test_team_name_outcomes_same_positive_line_generates_negative_away_line(self) -> None:
        rows = normalize(raw_game("Basketball", "WNBA", "Asian handicap", ["Atlanta Dream W", "Indiana Fever W"], "+5.5", [1.91, 1.91]))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual(handicap[0]["linha"], "+5.5")
        self.assertEqual(handicap[1]["linha"], "-5.5")

    def test_symmetric_pair_is_preserved(self) -> None:
        rows = normalize(raw_game("Basketball", "WNBA", "Asian handicap", ["Atlanta Dream W", "Indiana Fever W"], "-3.5", [1.91, 1.91]))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-3.5", "+3.5"])
        self.assertTrue(all(row["raw_ref"]["handicap_normalization_status"] in {"VALID_SYMMETRIC_PAIR", "AWAY_LINE_NOT_INVERTED_FIXED"} for row in handicap))

    def test_incomplete_pair_is_not_invented(self) -> None:
        raw = raw_game("Basketball", "WNBA", "Asian handicap", ["Atlanta Dream W"], "-3.5", [1.91])
        rows = normalize(raw)["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual(len(handicap), 1)
        self.assertEqual(handicap[0]["raw_ref"]["handicap_normalization_status"], "PAIR_INCOMPLETE")

    def test_ambiguous_outcome_is_not_fixed(self) -> None:
        rows = normalize(raw_game("Basketball", "WNBA", "Asian handicap", ["Draw A", "Draw B"], "-3.5", [1.91, 1.91]))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-3.5", "-3.5"])
        self.assertTrue(all(row["raw_ref"]["handicap_normalization_status"] == "AMBIGUOUS_NOT_FIXED" for row in handicap))

    def test_missing_odd_keeps_pair_incomplete(self) -> None:
        rows = normalize(raw_game("Basketball", "WNBA", "Asian handicap", ["Atlanta Dream W", "Indiana Fever W"], "-3.5", [1.91, ""]))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual(len(handicap), 1)
        self.assertEqual(handicap[0]["raw_ref"]["handicap_normalization_status"], "PAIR_INCOMPLETE")

    def test_football_european_handicap_is_not_altered(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "European Handicap", ["1", "2"], "-1", [1.91, 1.91]))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-1", "-1"])
        self.assertNotIn("handicap_normalization_status", handicap[0]["raw_ref"])

    def test_football_asian_handicap_with_team_names_is_normalized(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "Asian Handicap", ["Home FC", "Away FC"], "-0.5", [1.91, 1.91], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-0.5", "+0.5"])

    def test_football_asian_handicap_with_1_2_same_line_is_normalized(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "Asian Handicap", ["1", "2"], "-1.5", [1.91, 1.91], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-1.5", "+1.5"])
        self.assertTrue(all(row["raw_ref"]["handicap_normalization_status"] in {"VALID_SYMMETRIC_PAIR", "AWAY_LINE_NOT_INVERTED_FIXED"} for row in handicap))

    def test_football_asian_handicap_with_team_names_same_quarter_line_is_normalized(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "Asian Handicap", ["Home FC", "Away FC"], "-0.75", [1.91, 1.91], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-0.75", "+0.75"])

    def test_football_asian_handicap_symmetric_pair_is_preserved(self) -> None:
        rows = normalize(raw_game_with_line_by_outcome("Futebol", "Teste", "Asian Handicap", [("Home FC", "+1.0", 1.91), ("Away FC", "-1.0", 1.91)], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["+1.0", "-1.0"])
        self.assertTrue(all(row["raw_ref"]["handicap_normalization_status"] == "VALID_SYMMETRIC_PAIR" for row in handicap))

    def test_football_asian_handicap_incomplete_pair_is_not_fixed(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "Asian Handicap", ["Home FC"], "-1.5", [1.91], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-1.5"])
        self.assertEqual(handicap[0]["raw_ref"]["handicap_normalization_status"], "PAIR_INCOMPLETE")

    def test_football_asian_handicap_ambiguous_pair_is_not_fixed(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "Asian Handicap", ["Equipe A", "Equipe B"], "-1.5", [1.91, 1.91], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-1.5", "-1.5"])
        self.assertTrue(all(row["raw_ref"]["handicap_normalization_status"] == "AMBIGUOUS_NOT_FIXED" for row in handicap))

    def test_football_european_handicap_three_way_is_not_normalized(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "European Handicap", ["1", "X", "2"], "-1", [1.91, 3.4, 1.91], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-1", "-1", "-1"])
        self.assertTrue(all("handicap_normalization_status" not in row["raw_ref"] for row in handicap))

    def test_football_asian_handicap_integer_line_is_only_normalized_in_odds(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "Asian Handicap", ["Home FC", "Away FC"], "-1", [1.91, 1.91], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["-1", "+1"])

    def test_football_asian_handicap_quarter_line_is_only_normalized_in_odds(self) -> None:
        rows = normalize(raw_game("Futebol", "Teste", "Asian Handicap", ["Home FC", "Away FC"], "+0.25", [1.91, 1.91], home="Home FC", away="Away FC"))["rows"]
        handicap = handicap_rows(rows)
        self.assertEqual([row["linha"] for row in handicap], ["+0.25", "-0.25"])

    def test_moneyline_is_not_altered(self) -> None:
        rows = normalize(raw_game("Basketball", "WNBA", "Home/Away", ["1", "2"], "", [1.8, 2.0]))["rows"]
        self.assertEqual([row["mercado"] for row in rows], ["Home/Away", "Home/Away"])
        self.assertEqual([row["linha"] for row in rows], [None, None])

    def test_over_under_is_not_altered(self) -> None:
        rows = normalize(raw_game("Basketball", "WNBA", "Over/Under", ["Over", "Under"], "165.5", [1.9, 1.9]))["rows"]
        self.assertEqual([row["linha"] for row in rows], ["165.5", "165.5"])

    def test_wnba_handicap_runner_remains_blocked(self) -> None:
        self.assertFalse(basketball_runner_real.WNBA_HANDICAP_ENABLED_V1_1)


def raw_game(
    sport: str,
    league: str,
    market: str,
    outcomes: list[str],
    line: str,
    odds: list[object],
    *,
    home: str = "Atlanta Dream W",
    away: str = "Indiana Fever W",
) -> dict:
    return {
        "games": [
            {
                "id": "game-1",
                "date": "2026-06-20",
                "hour": "14:00",
                "sport": sport,
                "league": league,
                "home": home,
                "away": away,
                "odds": {
                    market: {
                        "FT": [
                            ["Bookmaker", "Handicap" if "handicap" in market.lower() else "Line", *outcomes],
                            ["book", line, *odds],
                        ]
                    }
                },
            }
        ]
    }


def raw_game_with_line_by_outcome(
    sport: str,
    league: str,
    market: str,
    entries: list[tuple[str, str, object]],
    *,
    home: str = "Atlanta Dream W",
    away: str = "Indiana Fever W",
) -> dict:
    return {
        "games": [
            {
                "id": "game-1",
                "date": "2026-06-20",
                "hour": "14:00",
                "sport": sport,
                "league": league,
                "home": home,
                "away": away,
                "odds": {
                    market: {
                        "FT": [
                            ["Bookmaker", "Handicap", *[outcome for outcome, _line, _odd in entries]],
                            *[
                                [
                                    "book",
                                    line,
                                    *[odd if index == entry_index else "" for index, (_outcome, _line, _odd) in enumerate(entries)],
                                ]
                                for entry_index, (_outcome, line, odd) in enumerate(entries)
                            ],
                        ]
                    }
                },
            }
        ]
    }


def handicap_rows(rows: list[dict]) -> list[dict]:
    return [row for row in rows if "handicap" in row["mercado"].lower()]


if __name__ == "__main__":
    unittest.main()
