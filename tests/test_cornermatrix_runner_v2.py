from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from modelos import cornermatrix_runner_real as runner
from modelos import cornermatrix_validation as validation


class CornerMatrixRunnerV2Tests(unittest.TestCase):
    def test_source_schema_accepts_exact_headers(self) -> None:
        runner.validate_source_schema(pd.DataFrame(columns=runner.SOURCE_HEADERS), "fixture")

    def test_source_schema_rejects_reordered_headers(self) -> None:
        headers = list(runner.SOURCE_HEADERS)
        headers[9], headers[10] = headers[10], headers[9]
        with self.assertRaisesRegex(ValueError, "CORNERMATRIX_SCHEMA_DRIFT"):
            runner.validate_source_schema(pd.DataFrame(columns=headers), "fixture")

    def test_filter_requires_exact_window_and_separates_statuses(self) -> None:
        frame = pd.DataFrame([
            {"Status": "NF", "Jogos Coletados Casa": 5, "Jogos Coletados Visitante": 5},
            {"Status": "NS", "Jogos Coletados Casa": 5, "Jogos Coletados Visitante": 4},
            {"Status": "FT", "Jogos Coletados Casa": 5, "Jogos Coletados Visitante": 5},
        ])
        forecast = runner.filter_by_status_and_games(frame, ("NS",), n_games=5)
        backtest = runner.filter_by_status_and_games(frame, ("FT",), n_games=5)
        self.assertEqual(forecast["Status"].tolist(), ["NS"])
        self.assertEqual(backtest["Status"].tolist(), ["FT"])

    def test_dynamic_weights_are_bounded_and_sum_to_one(self) -> None:
        row = {
            "CV Média Cantos Casa_20": 65.0, "CV Média Cantos Marcados Casa_20": 65.0,
            "CV Média Cantos Visitante_20": 65.0, "CV Média Cantos Marcados Visitante_20": 65.0,
        }
        for name in (
            "Média Cantos Marcados Casa", "Média Cantos Sofridos Casa",
            "Média Cantos Marcados Visitante", "Média Cantos Sofridos Visitante",
        ):
            row[f"{name}_5"] = 7.0
            row[f"{name}_20"] = 5.0
        result = runner.build_dynamic_weights(pd.DataFrame([row]))
        self.assertGreaterEqual(result.loc[0, "_w20"], 0.45)
        self.assertLessEqual(result.loc[0, "_w20"], 0.68)
        self.assertAlmostEqual(result.loc[0, "_w5"] + result.loc[0, "_w20"], 1.0)

    def test_poisson_gamma_vector_alpha_preserves_means_and_covariance(self) -> None:
        home, away = runner.simulate_poisson_gamma_bivariate(
            np.array([5.2]), np.array([4.4]), np.array([0.12]), 100_000, seed=9,
        )
        self.assertAlmostEqual(float(home.mean()), 5.2, delta=0.05)
        self.assertAlmostEqual(float(away.mean()), 4.4, delta=0.05)
        self.assertGreater(float(np.cov(home[0], away[0])[0, 1]), 0.0)

    def test_baseline_share_does_not_depend_on_current_slate(self) -> None:
        frame = pd.DataFrame([
            {"Pais": "X", "Sigla": "X", "Liga": "L", "Média Cantos Liga_20": 10.0},
            {"Pais": "X", "Sigla": "X", "Liga": "L", "Média Cantos Liga_20": 10.0},
        ])
        result = runner.build_league_season_baselines(frame)
        self.assertTrue((result["_share_home"] == runner.DEFAULT_SHARE_HOME).all())
        self.assertEqual(result["_L_total"].nunique(), 1)

    def test_two_way_probability_requires_paired_no_vig_market(self) -> None:
        index = pd.RangeIndex(1)
        result = runner.finalize_two_way_probabilities(
            pd.Series([60.0], index=index), pd.Series([40.0], index=index),
            pd.Series([61.0], index=index), pd.Series([39.0], index=index),
            pd.Series([np.nan], index=index), pd.Series([45.0], index=index),
            [0.4, 0.5, 0.1], 0.88, "ou",
        )
        self.assertTrue(pd.isna(result["a"].iloc[0]))
        self.assertFalse(bool(result["paired"].iloc[0]))

    def test_disagreement_haircut_moves_probability_toward_market(self) -> None:
        adjusted, haircut, spread, conflict = runner.apply_component_disagreement_haircut(
            pd.Series([70.0]), [pd.Series([72.0]), pd.Series([70.0]), pd.Series([45.0])], pd.Series([45.0]),
        )
        self.assertLess(adjusted.iloc[0], 70.0)
        self.assertGreater(haircut.iloc[0], 0.0)
        self.assertEqual(spread.iloc[0], 27.0)
        self.assertTrue(bool(conflict.iloc[0]))

    def test_race_probability_is_symmetric_for_equal_rates(self) -> None:
        probability = runner.race_prob_home_closed_form(np.array([5.0]), np.array([5.0]), 3)
        self.assertAlmostEqual(float(probability[0]), 0.5, delta=0.03)

    def test_conflict_caps_kelly(self) -> None:
        self.assertLessEqual(runner.kelly_stake_units(75.0, 2.0, conflict=True), 0.25)

    def test_correlated_limit_keeps_at_most_three_ou_lines(self) -> None:
        rows = [
            {"jogo": "A vs B", "market_type": "OU", "selection_side": "OVER", "linha": line, "edge": edge, "market_conflict_status": "ALINHADO"}
            for line, edge in ((7.5, 7.0), (8.5, 9.0), (9.5, 8.0), (10.5, 6.0))
        ]
        selected = runner.limit_correlated_picks(rows)
        self.assertEqual(len(selected), 3)
        self.assertEqual(selected[0]["selection_role"], "PRINCIPAL")

    def test_snapshot_rows_are_walk_forward_ready(self) -> None:
        previous = dict(runner.RUN_PROVENANCE)
        try:
            runner.RUN_PROVENANCE.clear()
            runner.RUN_PROVENANCE["generated_at"] = "2026-06-28T10:00:00+00:00"
            rows = runner.build_walk_forward_snapshot_rows([{
                "data": "28/06/2026", "hora": "12:00", "liga": "Test", "jogo": "A vs B",
                "market_type": "OU", "pick": "Over Cantos", "linha": 8.5,
                "probabilidade_final": 60.0, "odd_ofertada": 1.9,
            }])
        finally:
            runner.RUN_PROVENANCE.clear()
            runner.RUN_PROVENANCE.update(previous)
        self.assertEqual(rows[0]["probability"], 0.60)
        self.assertIsNone(rows[0]["outcome"])
        self.assertLess(pd.Timestamp(rows[0]["prediction_at"]), pd.Timestamp(rows[0]["kickoff"]))

    def test_realistic_external_schema_integrates_through_merge(self) -> None:
        def raw_row(window: int) -> dict:
            normalized = {column: 60.0 for column in runner.cols_normalizados}
            normalized.update({
                "Pais": "Brazil", "Sigla": "BR", "Liga": "Serie Test",
                "Data/Hora": "28/06/2026 15:00", "Status": "NS", "Time Casa": "Home",
                "Time Visitante": "Away", "Resultado Casa": "", "Resultado Visitor": "",
                "Jogos Coletados Casa": window, "Jogos Coletados Visitante": window,
                "Média Cantos Liga": 9.8, "Expectativa de Cantos": 9.8,
            })
            return dict(zip(runner.SOURCE_HEADERS, [normalized[column] for column in runner.cols_normalizados]))

        five = runner.coerce_numeric(runner.normalize_columns(pd.DataFrame([raw_row(5)])))
        twenty = runner.coerce_numeric(runner.normalize_columns(pd.DataFrame([raw_row(20)])))
        merged = runner.merge_5_20(
            runner.filter_by_status_and_games(five, ("NS",), n_games=5),
            runner.filter_by_status_and_games(twenty, ("NS",), n_games=20),
        )
        self.assertEqual(len(merged), 1)

    def test_calibration_is_separate_by_corner_market(self) -> None:
        frame = pd.DataFrame([
            {
                "prediction_at": f"2026-01-{day:02d}T10:00:00Z",
                "kickoff": f"2026-01-{day:02d}T12:00:00Z",
                "league": "Test", "market_type": market,
                "probability": 0.60, "outcome": day % 2,
            }
            for market in validation.MARKETS for day in range(1, 21)
        ])
        payload = validation.build_calibration_payload(frame)
        self.assertEqual(set(payload["markets"]), set(validation.MARKETS))
        self.assertTrue(all(not item["active"] for item in payload["markets"].values()))


if __name__ == "__main__":
    unittest.main()
