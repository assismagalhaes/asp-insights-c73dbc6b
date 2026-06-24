from __future__ import annotations

import unittest

from modelos import basketball_runner_real
from modelos.wnba_handicap_shadow_v1_4 import (
    GREEN,
    MARKET_BASELINE_OK,
    NO_MARKET_BASELINE,
    PUSH,
    RED,
    SAME_SIGN_PAIR,
    VALID_HANDICAP_PAIR,
    calculate_market_no_vig,
    evaluate_handicap_cover,
    historical_handicap_cover_probability,
    read_wnba_handicap_pairs,
    validate_handicap_pair,
)


class WnbaHandicapShadowV14Tests(unittest.TestCase):
    def test_symmetric_pair_is_valid(self) -> None:
        pair = validate_handicap_pair(rows("-12.5", "+12.5", 1.91, 1.91))
        self.assertEqual(pair.status, VALID_HANDICAP_PAIR)
        self.assertTrue(pair.is_valid)

    def test_same_sign_pair_is_invalid(self) -> None:
        pair = validate_handicap_pair(rows("-12.5", "-12.5", 1.91, 1.91))
        self.assertEqual(pair.status, SAME_SIGN_PAIR)
        self.assertFalse(pair.is_valid)

    def test_incomplete_pair_is_invalid(self) -> None:
        pairs = read_wnba_handicap_pairs(rows("-12.5", "+12.5", 1.91, 1.91)[:1])
        self.assertEqual(pairs[0].status, "PAIR_INCOMPLETE")
        self.assertFalse(pairs[0].is_valid)

    def test_missing_odd_is_invalid(self) -> None:
        pair = validate_handicap_pair(rows("-12.5", "+12.5", "", 1.91))
        self.assertIn(pair.status, {"PAIR_INCOMPLETE", "INVALID_ODDS"})
        self.assertFalse(pair.is_valid)

    def test_placeholder_odd_is_invalid(self) -> None:
        pair = validate_handicap_pair(rows("-12.5", "+12.5", 2.0, 1.91))
        self.assertIn("PLACEHOLDER_ODDS", pair.reasons)
        self.assertFalse(pair.is_valid)

    def test_favorite_minus_3_5_wins_by_4_is_green(self) -> None:
        self.assertEqual(evaluate_handicap_cover(84, 80, -3.5).status, GREEN)

    def test_favorite_minus_3_5_wins_by_3_is_red(self) -> None:
        self.assertEqual(evaluate_handicap_cover(83, 80, -3.5).status, RED)

    def test_underdog_plus_5_5_loses_by_5_is_green(self) -> None:
        self.assertEqual(evaluate_handicap_cover(75, 80, +5.5).status, GREEN)

    def test_underdog_plus_5_5_loses_by_6_is_red(self) -> None:
        self.assertEqual(evaluate_handicap_cover(74, 80, +5.5).status, RED)

    def test_integer_line_exact_cover_is_push(self) -> None:
        self.assertEqual(evaluate_handicap_cover(84, 80, -4.0).status, PUSH)
        self.assertEqual(evaluate_handicap_cover(76, 80, +4.0).status, PUSH)

    def test_push_is_not_counted_as_historical_win(self) -> None:
        result = historical_handicap_cover_probability(
            "A",
            "B",
            -4.0,
            "home",
            [
                game("A", "B", 84, 80),  # push
                game("A", "B", 85, 80),  # green
                game("A", "B", 82, 80),  # red
            ],
            min_sample=1,
        )
        self.assertEqual(result.pushes, 1)
        self.assertEqual(result.games_considered, 2)
        self.assertAlmostEqual(result.raw_cover_rate or 0, 0.5)

    def test_low_sample_uses_shrinkage_or_neutral_fallback(self) -> None:
        result = historical_handicap_cover_probability("A", "B", -4.0, "home", [game("A", "B", 85, 80)])
        self.assertTrue(result.fallback_used)
        self.assertEqual(result.fallback_reason, "LOW_SAMPLE_NEUTRAL_FALLBACK")
        self.assertAlmostEqual(result.shrinked_cover_rate, 0.50)

    def test_no_vig_is_calculated_with_two_sides(self) -> None:
        result = calculate_market_no_vig(1.91, 1.91)
        self.assertEqual(result.market_baseline_status, MARKET_BASELINE_OK)
        self.assertAlmostEqual(result.market_prob_home or 0, 0.5)
        self.assertAlmostEqual(result.market_prob_away or 0, 0.5)

    def test_missing_market_side_returns_no_market_baseline(self) -> None:
        result = calculate_market_no_vig(1.91, "")
        self.assertEqual(result.market_baseline_status, NO_MARKET_BASELINE)
        self.assertIsNone(result.market_prob_away)

    def test_wnba_handicap_remains_blocked(self) -> None:
        self.assertFalse(basketball_runner_real.WNBA_HANDICAP_ENABLED_V1_1)

    def test_wnba_main_output_still_drops_handicap(self) -> None:
        item = {
            "mercado": "Handicap Asiatico",
            "pick": "Toronto Tempo W -4.5",
            "linha": -4.5,
            "odd_ofertada": 1.91,
            "odd_valor": 1.75,
            "probabilidade_final": 57.0,
        }
        result = basketball_runner_real.apply_wnba_v1_1_to_pick(None, {}, {}, item, "TOR", "NYL")
        self.assertIsNone(result)


def rows(home_line: str, away_line: str, home_odd: object, away_odd: object) -> list[dict[str, object]]:
    return [
        {
            "data": "2026-06-23",
            "hora": "20:00",
            "esporte": "Basketball",
            "liga": "WNBA",
            "jogo": "A vs B",
            "mandante": "A",
            "visitante": "B",
            "mercado": "Asian handicap",
            "pick": "A",
            "linha": home_line,
            "odd": home_odd,
            "bookmaker": "book",
        },
        {
            "data": "2026-06-23",
            "hora": "20:00",
            "esporte": "Basketball",
            "liga": "WNBA",
            "jogo": "A vs B",
            "mandante": "A",
            "visitante": "B",
            "mercado": "Asian handicap",
            "pick": "B",
            "linha": away_line,
            "odd": away_odd,
            "bookmaker": "book",
        },
    ]


def game(home: str, away: str, home_points: int, away_points: int) -> dict[str, object]:
    return {
        "mandante": home,
        "visitante": away,
        "pontos_mandante": home_points,
        "pontos_visitante": away_points,
    }


if __name__ == "__main__":
    unittest.main()
