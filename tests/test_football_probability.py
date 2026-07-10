import math
import sys
import unittest
from pathlib import Path


MODELOS_DIR = Path(__file__).resolve().parents[1] / "modelos"
if str(MODELOS_DIR) not in sys.path:
    sys.path.insert(0, str(MODELOS_DIR))

from football_probability import (
    asian_equivalent_probability,
    asian_fair_odd,
    asian_handicap_legs,
    asian_handicap_outcome_weights,
    asian_handicap_settlement,
    blend_model_history,
    calibrate_binary,
    dixon_coles_multiplier,
    normalize_probabilities,
    shrink_mean,
)


class FootballProbabilityTest(unittest.TestCase):
    def test_normalization_places_multiclass_on_simplex(self):
        result = normalize_probabilities({"home": 60, "draw": 20, "away": 60})
        self.assertAlmostEqual(sum(result.values()), 100.0)
        self.assertAlmostEqual(result["home"], result["away"])

    def test_shrink_mean_uses_real_sample(self):
        self.assertAlmostEqual(shrink_mean(2.0, 0, 1.2, 10), 1.2)
        self.assertGreater(shrink_mean(2.0, 20, 1.2, 10), 1.2)
        self.assertLess(shrink_mean(2.0, 20, 1.2, 10), 2.0)

    def test_history_weight_increases_with_sample_but_remains_capped(self):
        model = {"yes": 70, "no": 30}
        history = {"yes": 30, "no": 70}
        low = blend_model_history(model, history, sample=1, max_history_weight=0.25)
        high = blend_model_history(model, history, sample=100, max_history_weight=0.25)
        self.assertGreater(low["yes"], high["yes"])
        self.assertGreater(high["yes"], history["yes"])
        self.assertAlmostEqual(sum(high.values()), 100.0)

    def test_identity_calibration_preserves_probability(self):
        self.assertAlmostEqual(calibrate_binary(0.63), 0.63)

    def test_dixon_coles_only_changes_low_scores(self):
        self.assertNotEqual(dixon_coles_multiplier(0, 0, 1.4, 1.1, -0.08), 1.0)
        self.assertEqual(dixon_coles_multiplier(2, 1, 1.4, 1.1, -0.08), 1.0)

    def test_quarter_line_splits_into_adjacent_half_lines(self):
        self.assertEqual(asian_handicap_legs(-0.25), (-0.5, 0.0))
        self.assertEqual(asian_handicap_legs(0.25), (0.0, 0.5))
        self.assertEqual(asian_handicap_legs(0.75), (0.5, 1.0))

    def test_quarter_line_models_half_win_and_half_loss(self):
        plus = asian_handicap_outcome_weights(goal_diff=0, line=0.25)
        minus = asian_handicap_outcome_weights(goal_diff=0, line=-0.25)
        self.assertEqual(plus, {"win": 0.5, "push": 0.5, "loss": 0.0})
        self.assertEqual(minus, {"win": 0.0, "push": 0.5, "loss": 0.5})

    def test_asian_fair_price_excludes_push_from_break_even_probability(self):
        self.assertAlmostEqual(asian_fair_odd(0.45, 0.45), 2.0)
        self.assertAlmostEqual(asian_equivalent_probability(0.45, 0.45), 0.5)

    def test_asian_settlement_preserves_total_stake(self):
        settlement = asian_handicap_settlement([(0, 0.5), (1, 0.5)], -0.25)
        self.assertAlmostEqual(sum(settlement.values()), 1.0)
        self.assertAlmostEqual(settlement["win"], 0.5)
        self.assertAlmostEqual(settlement["push"], 0.25)
        self.assertAlmostEqual(settlement["loss"], 0.25)

    def test_invalid_asian_increment_is_rejected(self):
        with self.assertRaises(ValueError):
            asian_handicap_legs(0.3)


if __name__ == "__main__":
    unittest.main()
