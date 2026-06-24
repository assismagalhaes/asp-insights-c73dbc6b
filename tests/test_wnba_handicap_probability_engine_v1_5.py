from __future__ import annotations

import unittest

from modelos import basketball_runner_real
from modelos.wnba_handicap_probability_engine_v1_5 import (
    CONFIRMED_PLACEHOLDER_ODD,
    GREEN,
    INVALID_SIGMA,
    MARKET_BASELINE_OK,
    MARGIN_FALLBACK_USED,
    NO_MARKET_BASELINE,
    OVERCONFIDENCE_FLAG,
    POSSIBLE_PLACEHOLDER_ODD,
    RED,
    SHADOW_READY,
    VALID_ODD,
    calculate_handicap_no_vig_probability,
    calculate_margin_cover_probability,
    classify_odd,
    combine_shadow_probabilities,
    historical_cover_probability,
)


class WnbaHandicapProbabilityEngineV15Tests(unittest.TestCase):
    def test_real_odd_2_00_is_valid(self) -> None:
        result = classify_odd(2.0, {"bookmaker": "betano.br", "source": "coleta_real"})
        self.assertEqual(result.status, VALID_ODD)

    def test_artificial_odd_2_00_is_placeholder(self) -> None:
        result = classify_odd(2.0, {"fallback_odd": True})
        self.assertEqual(result.status, CONFIRMED_PLACEHOLDER_ODD)

    def test_odd_2_00_without_source_is_possible_placeholder(self) -> None:
        result = classify_odd(2.0, {})
        self.assertEqual(result.status, POSSIBLE_PLACEHOLDER_ODD)
        self.assertTrue(result.is_usable)

    def test_no_vig_with_equal_odds_is_fifty_fifty(self) -> None:
        result = calculate_handicap_no_vig_probability(1.90, 1.90)
        self.assertEqual(result.status, MARKET_BASELINE_OK)
        self.assertAlmostEqual(result.market_prob_home or 0, 0.5)
        self.assertAlmostEqual(result.market_prob_away or 0, 0.5)

    def test_no_vig_with_different_odds_is_coherent(self) -> None:
        result = calculate_handicap_no_vig_probability(1.50, 2.50)
        self.assertEqual(result.status, MARKET_BASELINE_OK)
        self.assertGreater(result.market_prob_home or 0, result.market_prob_away or 0)
        self.assertAlmostEqual((result.market_prob_home or 0) + (result.market_prob_away or 0), 1.0)

    def test_missing_opposite_odd_returns_no_market_baseline(self) -> None:
        result = calculate_handicap_no_vig_probability(1.90, "")
        self.assertEqual(result.status, NO_MARKET_BASELINE)

    def test_margin_cover_probability_respects_negative_line(self) -> None:
        strong = calculate_margin_cover_probability(6, 10, -3.5)
        weak = calculate_margin_cover_probability(1, 10, -5.5)
        self.assertGreater(strong.margin_cover_prob, 0.5)
        self.assertLess(weak.margin_cover_prob, 0.5)

    def test_margin_cover_probability_respects_positive_line(self) -> None:
        result = calculate_margin_cover_probability(-2, 10, +5.5)
        self.assertGreater(result.margin_cover_prob, 0.5)

    def test_invalid_sigma_uses_fallback(self) -> None:
        result = calculate_margin_cover_probability(1, 0, +5.5)
        self.assertEqual(result.status, MARGIN_FALLBACK_USED)
        self.assertIn(INVALID_SIGMA, result.reasons)

    def test_historical_cover_calculates_green(self) -> None:
        result = historical_cover_probability("A", "B", -3.5, [game("A", "B", 84, 80)], min_sample=1)
        self.assertEqual(result.cover_wins, 1)

    def test_historical_cover_calculates_red(self) -> None:
        result = historical_cover_probability("A", "B", -3.5, [game("A", "B", 83, 80)], min_sample=1)
        self.assertEqual(result.cover_losses, 1)

    def test_historical_cover_excludes_push(self) -> None:
        result = historical_cover_probability(
            "A",
            "B",
            -4.0,
            [
                game("A", "B", 84, 80),
                game("A", "B", 86, 80),
                game("A", "B", 82, 80),
            ],
            min_sample=1,
        )
        self.assertEqual(result.pushes, 1)
        self.assertEqual(result.games_considered, 2)
        self.assertAlmostEqual(result.raw_cover_rate or 0, 0.5)

    def test_low_sample_uses_neutral_fallback_or_shrinkage(self) -> None:
        result = historical_cover_probability("A", "B", -3.5, [game("A", "B", 84, 80)])
        self.assertTrue(result.fallback_used)
        self.assertAlmostEqual(result.shrinked_cover_rate, 0.50)

    def test_combination_uses_configured_weights_with_all_components(self) -> None:
        result = combine_shadow_probabilities(
            market_no_vig_prob=0.55,
            historical_cover_prob=0.60,
            margin_cover_prob=0.50,
            weights={"market": 0.40, "historical": 0.30, "margin": 0.30},
        )
        self.assertEqual(result.status, SHADOW_READY)
        self.assertAlmostEqual(result.final_shadow_prob, 0.55)

    def test_combination_redistributes_weights_when_component_missing(self) -> None:
        result = combine_shadow_probabilities(
            market_no_vig_prob=0.60,
            historical_cover_prob=0.50,
            margin_cover_prob=None,
            weights={"market": 0.40, "historical": 0.30, "margin": 0.30},
        )
        expected = (0.60 * (0.40 / 0.70)) + (0.50 * (0.30 / 0.70))
        self.assertAlmostEqual(result.final_shadow_prob, expected)
        self.assertIn("margin", result.missing_components)

    def test_overconfidence_generates_flag_without_publishing_pick(self) -> None:
        result = combine_shadow_probabilities(
            market_no_vig_prob=0.90,
            historical_cover_prob=0.90,
            margin_cover_prob=0.90,
        )
        self.assertTrue(result.overconfidence_flag)
        self.assertEqual(result.status, OVERCONFIDENCE_FLAG)
        self.assertLessEqual(result.final_shadow_prob, 0.70)

    def test_wnba_handicap_remains_blocked(self) -> None:
        self.assertFalse(basketball_runner_real.WNBA_HANDICAP_ENABLED_V1_1)

    def test_wnba_main_output_still_drops_handicap(self) -> None:
        item = {
            "mercado": "Handicap Asiático",
            "pick": "Toronto Tempo W -4.5",
            "linha": -4.5,
            "odd_ofertada": 1.91,
            "odd_valor": 1.75,
            "probabilidade_final": 57.0,
        }
        result = basketball_runner_real.apply_wnba_v1_1_to_pick(None, {}, {}, item, "TOR", "NYL")
        self.assertIsNone(result)


def game(home: str, away: str, home_points: int, away_points: int) -> dict[str, object]:
    return {
        "mandante": home,
        "visitante": away,
        "pontos_mandante": home_points,
        "pontos_visitante": away_points,
    }


if __name__ == "__main__":
    unittest.main()

