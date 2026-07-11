from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from modelos import goalmatrix_runner_real as runner
from modelos import goalmatrix_validation as validation


class GoalMatrixRunnerV2Tests(unittest.TestCase):
    def test_source_schema_accepts_exact_external_headers(self) -> None:
        frame = pd.DataFrame(columns=runner.SOURCE_HEADERS)
        runner.validate_source_schema(frame, "fixture")

    def test_source_schema_rejects_reordered_columns(self) -> None:
        headers = list(runner.SOURCE_HEADERS)
        headers[9], headers[10] = headers[10], headers[9]
        with self.assertRaisesRegex(ValueError, "GOALMATRIX_SCHEMA_DRIFT"):
            runner.validate_source_schema(pd.DataFrame(columns=headers), "fixture")

    def test_previous_fifteen_is_removed_from_overlapping_twenty(self) -> None:
        recent = pd.Series([3.0])
        aggregate = pd.Series([2.0])
        previous = runner._previous15_from_windows(recent, aggregate)
        self.assertAlmostEqual(previous.iloc[0], 5.0 / 3.0)

    def test_dynamic_recent_weight_is_bounded_and_previous_is_anchor(self) -> None:
        row = {
            "CV Média Gols Casa_20": 60.0,
            "CV Média Gols Marcados Casa_20": 60.0,
            "CV Média Gols Visitante_20": 60.0,
            "CV Média Gols Marcados Visitante_20": 60.0,
        }
        for name in (
            "Média Gols Marcados Casa", "Média Gols Sofridos Casa",
            "Média Gols Marcados Visitante", "Média Gols Sofridos Visitante",
        ):
            row[f"{name}_5"] = 3.0
            row[f"{name}_20"] = 2.0
        result = runner.build_dynamic_weights(pd.DataFrame([row]))
        self.assertLessEqual(result.loc[0, "_w_recent5"], runner.RECENT_WEIGHT_MAX)
        self.assertGreater(result.loc[0, "_w_previous15"], result.loc[0, "_w_recent5"])
        self.assertAlmostEqual(result.loc[0, "_w_recent5"] + result.loc[0, "_w_previous15"], 1.0)

    def test_blend_uses_recent_five_and_non_overlapping_previous_fifteen(self) -> None:
        frame = pd.DataFrame([{
            "Metric_5": 3.0,
            "Metric_20": 2.0,
            "_w_recent5": 0.4,
            "_w_previous15": 0.6,
        }])
        result = runner.blend(frame, "Metric")
        expected = 0.4 * 3.0 + 0.6 * (5.0 / 3.0)
        self.assertAlmostEqual(result.iloc[0], expected)

    def test_poisson_gamma_preserves_means_and_adds_positive_covariance(self) -> None:
        home, away = runner.simulate_poisson_gamma_bivariate(
            np.array([1.8]), np.array([1.2]), np.array([0.10]), 100_000, seed=7,
        )
        self.assertAlmostEqual(float(home.mean()), 1.8, delta=0.03)
        self.assertAlmostEqual(float(away.mean()), 1.2, delta=0.03)
        self.assertGreater(float(np.cov(home[0], away[0])[0, 1]), 0.0)

    def test_league_baseline_does_not_depend_on_current_slate_team_mix(self) -> None:
        frame = pd.DataFrame([
            {"Pais": "X", "Sigla": "X1", "Liga": "League", "Data/Hora": "2026-07-11", "Média Gols Liga_20": 3.0, "Média Gols Marcados Casa_20": 5.0, "Média Gols Marcados Visitante_20": 0.5},
            {"Pais": "X", "Sigla": "X1", "Liga": "League", "Data/Hora": "2026-07-11", "Média Gols Liga_20": 3.0, "Média Gols Marcados Casa_20": 0.5, "Média Gols Marcados Visitante_20": 5.0},
        ])
        result = runner.build_league_season_baselines(frame)
        self.assertTrue((result["_share_home"] == runner.DEFAULT_SHARE_HOME).all())
        self.assertEqual(result["_L_total"].nunique(), 1)

    def test_two_way_probability_requires_paired_market_odds(self) -> None:
        index = pd.RangeIndex(1)
        result = runner.finalize_two_way_probabilities(
            pd.Series([60.0], index=index), pd.Series([40.0], index=index),
            pd.Series([62.0], index=index), pd.Series([38.0], index=index),
            pd.Series([np.nan], index=index), pd.Series([52.0], index=index),
            [0.4, 0.5, 0.1], 0.88, "ou",
        )
        self.assertTrue(pd.isna(result["a"].iloc[0]))
        self.assertFalse(bool(result["paired"].iloc[0]))

    def test_disagreement_haircut_is_symmetric_toward_market(self) -> None:
        adjusted, haircut, spread, conflict = runner.apply_component_disagreement_haircut(
            pd.Series([40.0]),
            [pd.Series([35.0]), pd.Series([38.0]), pd.Series([55.0])],
            pd.Series([55.0]),
        )
        self.assertGreater(adjusted.iloc[0], 40.0)
        self.assertGreater(haircut.iloc[0], 0.0)
        self.assertEqual(spread.iloc[0], 20.0)
        self.assertTrue(bool(conflict.iloc[0]))

    def test_conflict_caps_kelly_at_quarter_unit(self) -> None:
        self.assertEqual(runner.kelly_stake_units(70.0, 2.0, conflict=True), 0.25)

    def test_correlated_limit_keeps_principal_and_two_same_side_lines(self) -> None:
        rows = [
            {"jogo": "A vs B", "market_type": "OU", "selection_side": "UNDER", "linha": line, "edge": edge, "market_conflict_status": "ALINHADO"}
            for line, edge in ((2.5, 8.0), (3.5, 10.0), (4.5, 7.0), (5.5, 6.0))
        ]
        selected = runner.limit_correlated_picks(rows)
        self.assertEqual(len(selected), 3)
        self.assertEqual(selected[0]["selection_role"], "PRINCIPAL")
        self.assertTrue(all(row["selection_side"] == "UNDER" for row in selected))

    def test_first_goal_is_operationally_disabled(self) -> None:
        self.assertFalse(runner.FIRST_GOAL_ENABLED)

    def test_snapshot_rows_are_ready_for_walk_forward_labels(self) -> None:
        previous = dict(runner.RUN_PROVENANCE)
        try:
            runner.RUN_PROVENANCE.clear()
            runner.RUN_PROVENANCE.update({"generated_at": "2026-07-11T10:00:00+00:00"})
            rows = runner.build_walk_forward_snapshot_rows([{
                "data": "11/07/2026", "hora": "12:00", "liga": "Test",
                "jogo": "A vs B", "market_type": "OU", "pick": "Under",
                "linha": 2.5, "probabilidade_final": 60.0, "odd_ofertada": 1.9,
            }])
        finally:
            runner.RUN_PROVENANCE.clear()
            runner.RUN_PROVENANCE.update(previous)
        self.assertEqual(rows[0]["prediction_at"], "2026-07-11T10:00:00+00:00")
        self.assertEqual(rows[0]["market_type"], "ou")
        self.assertEqual(rows[0]["probability"], 0.60)
        self.assertIsNone(rows[0]["outcome"])
        self.assertLess(pd.Timestamp(rows[0]["prediction_at"]), pd.Timestamp(rows[0]["kickoff"]))

    def test_realistic_external_csv_schema_integrates_through_merge(self) -> None:
        def raw_row(window: int) -> dict:
            normalized = {}
            for column in runner.cols_normalizados:
                normalized[column] = 60.0
            normalized.update({
                "Pais": "Brazil", "Sigla": "BR", "Liga": "Serie Test",
                "Data/Hora": "11/07/2026 15:00", "Status": "NS",
                "Time Casa": "Home", "Time Visitante": "Away",
                "Resultado Casa": "", "Resultado Visitante": "",
                "Número Jogos Coletados Casa": window,
                "Número Jogos Coletados Visitante": window,
                "Expectativa de Gols": 2.6, "Média Gols Liga": 2.6,
                "Média Gols Marcados Casa": 1.5, "Média Gols Marcados Visitante": 1.2,
                "Média Gols Sofridos Casa": 1.1, "Média Gols Sofridos Visitante": 1.4,
            })
            values = [normalized[column] for column in runner.cols_normalizados]
            return dict(zip(runner.SOURCE_HEADERS, values))

        five = pd.DataFrame([raw_row(5)])
        twenty = pd.DataFrame([raw_row(20)])
        runner.validate_source_schema(five, "5j")
        runner.validate_source_schema(twenty, "20j")
        five_n = runner.coerce_numeric(runner.normalize_columns(five))
        twenty_n = runner.coerce_numeric(runner.normalize_columns(twenty))
        merged = runner.merge_5_20(
            runner.filter_by_status_and_games(five_n, ("NS",), 5),
            runner.filter_by_status_and_games(twenty_n, ("NS",), 20),
        )
        self.assertEqual(len(merged), 1)


class GoalMatrixValidationTests(unittest.TestCase):
    def test_walk_forward_rejects_prediction_after_kickoff(self) -> None:
        frame = pd.DataFrame([{
            "prediction_at": "2026-07-11T15:00:00Z",
            "kickoff": "2026-07-11T14:00:00Z",
            "league": "Test", "market_type": "ou", "probability": 0.60, "outcome": 1,
        }])
        with self.assertRaisesRegex(ValueError, "LEAKAGE"):
            validation.validate_snapshot_table(frame)

    def test_calibration_is_separate_by_market_and_inactive_below_sample(self) -> None:
        frame = pd.DataFrame([
            {
                "prediction_at": f"2026-01-{day:02d}T10:00:00Z",
                "kickoff": f"2026-01-{day:02d}T12:00:00Z",
                "league": "Test", "market_type": market,
                "probability": 0.60, "outcome": day % 2,
            }
            for market in ("ou", "btts") for day in range(1, 21)
        ])
        payload = validation.build_calibration_payload(frame)
        self.assertEqual(payload["markets"]["ou"]["sample_size"], 20)
        self.assertEqual(payload["markets"]["btts"]["sample_size"], 20)
        self.assertFalse(payload["markets"]["ou"]["active"])

    def test_platt_candidate_activates_only_with_oos_brier_improvement(self) -> None:
        kickoff = pd.date_range("2026-01-01", periods=140, freq="D", tz="UTC")
        frame = pd.DataFrame({
            "prediction_at": kickoff - pd.Timedelta(hours=2),
            "kickoff": kickoff,
            "league": "Test",
            "market_type": "ou",
            "probability": 0.80,
            "outcome": [index % 2 for index in range(140)],
        })
        clean = validation.validate_snapshot_table(frame)
        result = validation.build_market_calibration(clean, "ou")
        self.assertEqual(result["sample_size"], 140)
        self.assertTrue(result["active"])
        self.assertLess(result["calibrated_brier"], result["raw_brier"])


if __name__ == "__main__":
    unittest.main()
