from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

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
            row[f"{name}_10"] = 7.0
            row[f"{name}_20"] = 5.0
        result = runner.build_dynamic_weights(pd.DataFrame([row]))
        self.assertGreaterEqual(result.loc[0, "_w20"], 0.55)
        self.assertLessEqual(result.loc[0, "_w20"], 0.70)
        self.assertAlmostEqual(result.loc[0, "_w10"] + result.loc[0, "_w20"], 1.0)

    def test_consistency_scale_normalizes_fractional_columns(self) -> None:
        frame = pd.DataFrame({column: [0.6, 0.8, 1.0] for column in runner.CV_COLS_INPUT})
        normalized, scale = runner.normalize_consistency_scale(frame, "fixture")
        self.assertEqual(scale, "0-1_to_0-100")
        self.assertEqual(normalized[runner.CV_COLS_INPUT[0]].tolist(), [60.0, 80.0, 100.0])

    def test_window_profile_rejects_legacy_five_game_recent_file(self) -> None:
        frame = pd.DataFrame({"Jogos Coletados Casa": [5], "Jogos Coletados Visitante": [5]})
        with self.assertRaisesRegex(ValueError, "CORNERMATRIX_WINDOW_MISMATCH"):
            runner.validate_window_profile(frame, 10, "recent10")

    def test_probability_weights_sum_to_one(self) -> None:
        self.assertAlmostEqual(runner.w_hist + runner.w_sim + runner.w_imp, 1.0)
        self.assertAlmostEqual(runner.w_hist_dir + runner.w_sim_dir + runner.w_imp_dir, 1.0)
        self.assertEqual(runner.w_imp, 0.15)

    def test_ou_cv_filter_accepts_balanced_average_with_individual_floor(self) -> None:
        row = pd.Series({"home": 47.0, "away": 54.0})
        self.assertTrue(runner._passes_cv_filter(
            row,
            min_cv=50.0,
            min_cv_individual=45.0,
            cv_field_home="home",
            cv_field_away="away",
        ))

    def test_ou_cv_filter_rejects_low_individual_even_when_average_passes(self) -> None:
        row = pd.Series({"home": 44.0, "away": 60.0})
        self.assertFalse(runner._passes_cv_filter(
            row,
            min_cv=50.0,
            min_cv_individual=45.0,
            cv_field_home="home",
            cv_field_away="away",
        ))

    def test_directional_cv_filter_still_requires_both_market_minimums(self) -> None:
        row = pd.Series({"home": 54.0, "away": 60.0})
        self.assertFalse(runner._passes_cv_filter(
            row,
            min_cv=55.0,
            cv_field_home="home",
            cv_field_away="away",
        ))

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

    def test_kelly_converts_bankroll_fraction_to_units(self) -> None:
        self.assertEqual(runner.kelly_stake_units(59.13, 1.92), 0.75)

    def test_component_divergence_caps_kelly_at_half_unit(self) -> None:
        self.assertEqual(
            runner.kelly_stake_units(65.0, 1.90, component_spread_pp=12.0),
            0.5,
        )

    def test_insufficient_calibration_caps_kelly_at_half_unit(self) -> None:
        self.assertEqual(
            runner.kelly_stake_units(
                65.0,
                1.90,
                calibration_status="identity_insufficient_oos_sample",
            ),
            0.5,
        )

    def test_executable_price_has_explicit_operational_status(self) -> None:
        waiting, edge = runner.classify_executable_price(60.0, None, 5.0)
        approved, approved_edge = runner.classify_executable_price(60.0, 1.75, 5.0)
        rejected, rejected_edge = runner.classify_executable_price(60.0, 1.65, 5.0)
        self.assertEqual((waiting, edge), ("AGUARDANDO_ODD_EXECUTAVEL", None))
        self.assertEqual(approved, "ODD_APROVADA")
        self.assertAlmostEqual(approved_edge, 5.0)
        self.assertEqual(rejected, "SEM_VALOR")
        self.assertAlmostEqual(rejected_edge, -1.0)

    def test_component_conflict_status_is_separate_from_price(self) -> None:
        self.assertEqual(runner._component_conflict_status(8.0), "COMPONENTES_ALINHADOS")
        self.assertEqual(runner._component_conflict_status(12.0), "COMPONENTES_DIVERGENTES")
        self.assertEqual(runner._component_conflict_status(22.0), "CONFLITO_FORTE_ENTRE_COMPONENTES")

    def test_candidate_filter_does_not_treat_reference_odd_as_executable(self) -> None:
        self.assertTrue(runner._is_candidate_pick(60.0, 1.55, min_prob=56.0))
        self.assertFalse(runner._is_value_pick(60.0, 1.55, min_prob=56.0, min_edge=5.0))

    def test_correlated_limit_keeps_at_most_three_ou_lines(self) -> None:
        rows = [
            {"jogo": "A vs B", "market_type": "OU", "selection_side": "OVER", "linha": line, "edge": edge, "market_conflict_status": "ALINHADO"}
            for line, edge in ((7.5, 7.0), (8.5, 9.0), (9.5, 8.0), (10.5, 6.0))
        ]
        selected = runner.limit_correlated_picks(rows)
        self.assertEqual(len(selected), 3)
        self.assertEqual(selected[0]["selection_role"], "CANDIDATO_CORNER_PRINCIPAL")

    def test_reference_candidates_start_without_stake(self) -> None:
        rows = runner.apply_exposure_caps([{"jogo": "A vs B", "edge": -4.0, "stake": 1.0}])
        self.assertEqual(rows[0]["stake"], 0.0)

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

        ten = runner.coerce_numeric(runner.normalize_columns(pd.DataFrame([raw_row(10)])))
        twenty = runner.coerce_numeric(runner.normalize_columns(pd.DataFrame([raw_row(20)])))
        merged = runner.merge_10_20(
            runner.filter_by_status_and_games(ten, ("NS",), n_games=10),
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
        self.assertTrue(set(validation.MARKETS).issubset(payload["markets"]))
        self.assertIn("ou_over_8_5", payload["markets"])
        self.assertIn("ou_under_8_5", payload["markets"])
        self.assertTrue(all(not item["active"] for item in payload["markets"].values()))

    def test_ou_calibration_counts_side_and_line_separately(self) -> None:
        frame = pd.DataFrame([
            {
                "prediction_at": "2026-01-01T10:00:00Z",
                "kickoff": "2026-01-01T12:00:00Z",
                "league": "Test", "market_type": "ou", "pick": "Over Cantos",
                "line": 8.5, "probability": 0.60, "outcome": 1,
            },
            {
                "prediction_at": "2026-01-02T10:00:00Z",
                "kickoff": "2026-01-02T12:00:00Z",
                "league": "Test", "market_type": "ou", "pick": "Under Cantos",
                "line": 8.5, "probability": 0.58, "outcome": 0,
            },
        ])
        payload = validation.build_calibration_payload(frame)
        self.assertEqual(payload["markets"]["ou_over_8_5"]["sample_size"], 1)
        self.assertEqual(payload["markets"]["ou_under_8_5"]["sample_size"], 1)

    def test_granular_calibration_falls_back_to_active_aggregate(self) -> None:
        previous_path = runner.CALIBRATION_PATH
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "calibration.json"
                path.write_text(json.dumps({
                    "markets": {
                        "ou_over_8_5": {
                            "active": False, "out_of_sample": True, "sample_size": 20,
                            "intercept": 0.0, "slope": 1.0,
                        },
                        "ou": {
                            "active": True, "out_of_sample": True, "sample_size": 120,
                            "intercept": 0.0, "slope": 1.0,
                        },
                    }
                }), encoding="utf-8")
                runner.CALIBRATION_PATH = path
                calibrated, metadata = runner.apply_oos_calibration(
                    "ou_over_8_5", pd.Series([60.0]), fallback_market="ou"
                )
                self.assertAlmostEqual(calibrated.iloc[0], 60.0)
                self.assertEqual(metadata["calibration_key"], "ou")
                self.assertEqual(metadata["status"], "platt_logit_oos")
        finally:
            runner.CALIBRATION_PATH = previous_path


if __name__ == "__main__":
    unittest.main()
