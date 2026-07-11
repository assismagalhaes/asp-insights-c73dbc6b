from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from modelos import backmatrix_runner_real as runner
from modelos import backmatrix_validation as validation


class BackMatrixRunnerV1Tests(unittest.TestCase):
    def test_source_schema_accepts_exact_headers(self) -> None:
        runner.validate_source_schema(pd.DataFrame(columns=runner.SOURCE_HEADERS), "fixture")

    def test_source_schema_rejects_reordered_headers(self) -> None:
        headers = list(runner.SOURCE_HEADERS)
        headers[9], headers[10] = headers[10], headers[9]
        with self.assertRaisesRegex(ValueError, "BACKMATRIX_SCHEMA_DRIFT"):
            runner.validate_source_schema(pd.DataFrame(columns=headers), "fixture")

    def test_filter_requires_exact_windows_and_status(self) -> None:
        frame = pd.DataFrame([
            {"Status": "NS", "Jogos Casa": 10, "Jogos Visitante": 10},
            {"Status": "NS", "Jogos Casa": 10, "Jogos Visitante": 9},
            {"Status": "FT", "Jogos Casa": 10, "Jogos Visitante": 10},
        ])
        self.assertEqual(len(runner.filter_by_status_and_games(frame, ("NS",), 10)), 1)
        self.assertEqual(len(runner.filter_by_status_and_games(frame, ("FT",), 10)), 1)

    def test_packball_favorite_codes_are_explicit(self) -> None:
        self.assertEqual(runner.favorite_side_from_code(1), "Casa")
        self.assertEqual(runner.favorite_side_from_code(2), "Visitante")
        self.assertEqual(runner.favorite_class_from_code(3), "SUPERFAVORITO_CASA")
        self.assertEqual(runner.favorite_class_from_code(4), "SUPERFAVORITO_VISITANTE")
        self.assertEqual(runner.favorite_class_from_code(5), "SEM_FAVORITO_CLARO")
        self.assertIsNone(runner.favorite_side_from_code(5))

    def test_no_vig_three_way_probabilities_sum_to_one_hundred(self) -> None:
        frame = pd.DataFrame([{"Odd Casa": 1.80, "Odd Empate": 3.60, "Odd Visitante": 4.50}])
        result = runner.calculate_no_vig_probabilities(frame)
        total = result.loc[0, ["NoVig Casa", "NoVig Empate", "NoVig Visitante"]].sum()
        self.assertAlmostEqual(total, 100.0)
        self.assertTrue(bool(result.loc[0, "Odds Pareadas"]))

    def test_no_vig_rejects_missing_or_excessive_margin(self) -> None:
        frame = pd.DataFrame([
            {"Odd Casa": 1.50, "Odd Empate": np.nan, "Odd Visitante": 5.00},
            {"Odd Casa": 1.20, "Odd Empate": 2.00, "Odd Visitante": 2.00},
        ])
        result = runner.calculate_no_vig_probabilities(frame)
        self.assertFalse(result["Odds Pareadas"].any())

    def test_dynamic_weights_are_bounded_and_sum_to_one(self) -> None:
        row = {
            "CV Marcados Casa_20": 55.0,
            "CV Marcados Visitante_20": 60.0,
            "Vitoria Casa_10": 60.0, "Vitoria Casa_20": 50.0,
            "Vitoria Visitante_10": 40.0, "Vitoria Visitante_20": 35.0,
            "PPG Casa_10": 2.0, "PPG Casa_20": 1.8,
            "PPG Visitante_10": 1.2, "PPG Visitante_20": 1.1,
        }
        result = runner.build_dynamic_weights(pd.DataFrame([row]))
        self.assertGreaterEqual(result.loc[0, "_w10"], runner.RECENT_WEIGHT_MIN)
        self.assertLessEqual(result.loc[0, "_w10"], runner.RECENT_WEIGHT_MAX)
        self.assertAlmostEqual(result.loc[0, "_w10"] + result.loc[0, "_w20"], 1.0)

    def test_final_probability_components_are_coherent(self) -> None:
        frame = pd.DataFrame([{
            "NoVig Casa": 55.0, "NoVig Empate": 25.0, "NoVig Visitante": 20.0,
            "Poisson Casa": 58.0, "Poisson Empate": 24.0, "Poisson Visitante": 18.0,
            "Empirica Casa": 60.0, "Empirica Empate": 22.0, "Empirica Visitante": 18.0,
        }])
        result = runner.finalize_probabilities(frame)
        total = result.loc[0, ["Prob Final Casa", "Prob Final Empate", "Prob Final Visitante"]].sum()
        self.assertAlmostEqual(total, 100.0)
        self.assertGreater(result.loc[0, "Prob Final Casa"], result.loc[0, "NoVig Casa"])

    def test_fractional_kelly_is_capped(self) -> None:
        self.assertEqual(runner.kelly_stake_units(65.0, 1.80), runner.MAX_PICK_UNITS)
        self.assertEqual(runner.kelly_stake_units(65.0, 1.80, conflict=True), runner.CONFLICT_MAX_UNITS)

    def test_walk_forward_snapshot_starts_unlabeled(self) -> None:
        previous = dict(runner.RUN_PROVENANCE)
        try:
            runner.RUN_PROVENANCE.clear()
            runner.RUN_PROVENANCE["generated_at"] = "2026-07-11T10:00:00+00:00"
            rows = runner.build_walk_forward_rows([{
                "data": "11/07/2026", "hora": "12:00", "liga": "Test",
                "jogo": "A vs B", "pick": "A", "probabilidade_final": 60.0,
                "odd_ofertada": 1.80,
            }])
        finally:
            runner.RUN_PROVENANCE.clear()
            runner.RUN_PROVENANCE.update(previous)
        self.assertEqual(rows[0]["market_type"], "moneyline")
        self.assertEqual(rows[0]["probability"], 0.60)
        self.assertIsNone(rows[0]["outcome"])


class BackMatrixValidationTests(unittest.TestCase):
    def test_calibration_stays_inactive_below_sample(self) -> None:
        frame = pd.DataFrame([{
            "prediction_at": "2026-07-11T10:00:00Z",
            "kickoff": "2026-07-11T12:00:00Z",
            "league": "Test",
            "market_type": "moneyline",
            "probability": 0.60,
            "outcome": 1,
        }])
        payload = validation.build_calibration_payload(frame)
        self.assertFalse(payload["markets"]["moneyline"]["active"])

    def test_walk_forward_rejects_prediction_after_kickoff(self) -> None:
        frame = pd.DataFrame([{
            "prediction_at": "2026-07-11T13:00:00Z",
            "kickoff": "2026-07-11T12:00:00Z",
            "league": "Test",
            "market_type": "moneyline",
            "probability": 0.60,
            "outcome": 1,
        }])
        with self.assertRaisesRegex(ValueError, "BACKMATRIX_WALK_FORWARD_LEAKAGE"):
            validation.validate_snapshot_table(frame)


if __name__ == "__main__":
    unittest.main()
