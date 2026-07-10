import sys
import unittest
from pathlib import Path

import pandas as pd


MODELOS_DIR = Path(__file__).resolve().parents[1] / "modelos"
if str(MODELOS_DIR) not in sys.path:
    sys.path.insert(0, str(MODELOS_DIR))

from football_validation import (
    brier_score,
    calibration_table,
    canonical_market,
    fit_platt_scaling,
    ranked_probability_score_1x2,
    walk_forward_calibration,
)


class FootballValidationTest(unittest.TestCase):
    def test_brier_score_known_example(self):
        self.assertAlmostEqual(brier_score([0.8, 0.2], [1, 0]), 0.04)

    def test_calibration_table_accounts_for_all_rows(self):
        table = calibration_table([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1], bins=5)
        self.assertEqual(int(table["count"].sum()), 4)

    def test_walk_forward_never_calibrates_before_minimum_history(self):
        frame = pd.DataFrame({
            "data": [f"{day:02d}/01/2026" for day in range(1, 7)],
            "probabilidade_final": [60, 60, 60, 60, 60, 60],
            "resultado_binario": [1, 0, 1, 0, 1, 0],
        })
        calibrated = walk_forward_calibration(frame, min_train=4)
        self.assertTrue(calibrated.loc[:3].isna().all())
        self.assertTrue(calibrated.loc[4:].notna().all())

    def test_platt_returns_identity_when_sample_is_insufficient(self):
        self.assertEqual(fit_platt_scaling([0.6] * 5, [1, 0, 1, 0, 1]), {"slope": 1.0, "intercept": 0.0})

    def test_market_names_are_canonicalized_for_runtime_config(self):
        self.assertEqual(canonical_market("Resultado Final"), "1x2")
        self.assertEqual(canonical_market("Total de Gols"), "total_goals")
        self.assertEqual(canonical_market("Ambas Marcam"), "btts")
        self.assertEqual(canonical_market("Handicap Asiático"), "asian_handicap")

    def test_ranked_probability_score_is_zero_for_perfect_1x2_forecast(self):
        frame = pd.DataFrame({
            "jogo_id": ["m1", "m1", "m1"],
            "opcao_1x2": ["H", "D", "A"],
            "resultado_1x2": ["H", "H", "H"],
            "probabilidade_final": [100.0, 0.0, 0.0],
        })
        self.assertAlmostEqual(ranked_probability_score_1x2(frame), 0.0)


if __name__ == "__main__":
    unittest.main()
