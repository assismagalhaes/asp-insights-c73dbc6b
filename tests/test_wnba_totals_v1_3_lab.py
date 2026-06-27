from __future__ import annotations

import unittest

from modelos.wnba_totals_v1_3_lab import (
    blend_probability,
    calibrate_expected_points_to_market,
    calculate_expected_points_baseball_style,
    edge_decimal,
    fair_odd,
    normal_total_probability,
    poisson_total_probability,
    simulate_total_probability,
)


class WnbaTotalsV13LabTests(unittest.TestCase):
    def test_normal_probability_is_balanced_at_mean(self) -> None:
        self.assertAlmostEqual(normal_total_probability(170.5, 15.0, 170.5, "over"), 0.5)
        self.assertAlmostEqual(normal_total_probability(170.5, 15.0, 170.5, "under"), 0.5)

    def test_poisson_probability_is_available_as_diagnostic(self) -> None:
        over = poisson_total_probability(170.5, 170.5, "over")
        under = poisson_total_probability(170.5, 170.5, "under")
        self.assertGreater(over, 0.0)
        self.assertGreater(under, 0.0)
        self.assertAlmostEqual(over + under, 1.0)

    def test_monte_carlo_simulation_is_reproducible_and_uses_standard_deviation(self) -> None:
        first = simulate_total_probability(82.0, 78.0, 10.0, 9.0, 159.5, "over", simulations=2_000, seed="same")
        second = simulate_total_probability(82.0, 78.0, 10.0, 9.0, 159.5, "over", simulations=2_000, seed="same")
        self.assertEqual(first["wins"], second["wins"])
        self.assertEqual(first["simulations"], 2_000)
        self.assertGreater(float(first["probability"]), 0.45)
        self.assertLess(float(first["probability"]), 0.60)

    def test_expected_points_uses_attack_and_opponent_defense(self) -> None:
        result = calculate_expected_points_baseball_style(
            home_scored=88,
            home_allowed=82,
            away_scored=80,
            away_allowed=90,
            home_scored_sd=10,
            home_allowed_sd=9,
            away_scored_sd=11,
            away_allowed_sd=12,
        )
        self.assertAlmostEqual(result.home_expected, 88.9)
        self.assertAlmostEqual(result.away_expected, 80.9)
        self.assertAlmostEqual(result.total_expected, 169.8)
        self.assertGreater(result.home_sd, 0)
        self.assertGreater(result.away_sd, 0)
        self.assertGreaterEqual(result.total_sd, 12.0)

    def test_expected_points_can_be_calibrated_to_market_anchor(self) -> None:
        result = calculate_expected_points_baseball_style(
            home_scored=88,
            home_allowed=82,
            away_scored=80,
            away_allowed=90,
            home_scored_sd=10,
            home_allowed_sd=9,
            away_scored_sd=11,
            away_allowed_sd=12,
        )
        calibrated = calibrate_expected_points_to_market(result, 175.0, market_weight=0.40)
        self.assertAlmostEqual(calibrated.total_expected, result.total_expected * 0.60 + 175.0 * 0.40)
        self.assertGreater(calibrated.home_expected, result.home_expected)
        self.assertGreater(calibrated.away_expected, result.away_expected)

    def test_blend_probability_uses_weights(self) -> None:
        probability = blend_probability(0.40, 0.50, 0.60, {"hist": 0.25, "sim": 0.40, "vig": 0.35})
        self.assertAlmostEqual(probability, 0.51)

    def test_fair_odd_and_edge_are_decimal_consistent(self) -> None:
        self.assertAlmostEqual(fair_odd(0.625), 1.6)
        self.assertAlmostEqual(edge_decimal(0.625, 1.8), 0.125)


if __name__ == "__main__":
    unittest.main()
