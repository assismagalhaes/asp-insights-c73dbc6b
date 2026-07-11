from __future__ import annotations

import unittest

from modelos import baseball_runner_real as runner


def stats(sigla: str, totals: list[float], win_rate: float = 0.5) -> runner.TeamStats:
    rows = [
        {"R": str(int(total // 2)), "RA": str(int(total - int(total // 2))), "W/L": "W" if idx % 2 == 0 else "L"}
        for idx, total in enumerate(totals)
    ]
    return runner.TeamStats(
        sigla=sigla,
        games=len(rows),
        avg_for=4.5,
        avg_against=4.2,
        win_rate=win_rate,
        last5_for=4.5,
        last5_against=4.2,
        streak=1,
        current_rows=rows,
        previous_rows=[],
        all_rows=rows,
    )


def margin_stats(
    sigla: str,
    margins: list[int],
    avg_for: float = 5.5,
    avg_against: float = 3.5,
    win_rate: float = 0.60,
) -> runner.TeamStats:
    rows = []
    for margin in margins:
        if margin >= 0:
            rows.append({"R": str(5 + margin), "RA": "5", "W/L": "W"})
        else:
            rows.append({"R": "5", "RA": str(5 + abs(margin)), "W/L": "L"})
    return runner.TeamStats(
        sigla=sigla,
        games=len(rows),
        avg_for=avg_for,
        avg_against=avg_against,
        win_rate=win_rate,
        last5_for=avg_for,
        last5_against=avg_against,
        streak=1,
        current_rows=rows,
        previous_rows=[],
        all_rows=rows,
    )


class BaseballRunnerV11Tests(unittest.TestCase):
    def test_model_version_and_handicap_flag_are_set(self) -> None:
        self.assertEqual(runner.MODEL_VERSION, "MLB_V2_1_TEMPORAL_UNCERTAINTY")
        self.assertFalse(runner.HANDICAP_ENABLED_MLB_V1_1)
        self.assertFalse(runner.HANDICAP_CONTROLLED_ACTIVATION_MLB_V1_1)
        self.assertTrue(runner.HANDICAP_SHADOW_ENABLED)
        self.assertEqual(runner.BASEBALL_MLB_HANDICAP_MODEL_VERSION, "MLB_V2_2_HANDICAP_NB_SHADOW")

    def test_totals_historical_probability_is_smoothed_not_binary(self) -> None:
        home = stats("NYY", [6, 8, 10, 12, 4])
        away = stats("BOS", [9, 9, 11, 5, 13])

        prob, sample_size, warnings = runner.historical_total_probability(home, away, 8.5, "over")

        self.assertEqual(sample_size, 10)
        self.assertGreater(prob, 0.0)
        self.assertLess(prob, 1.0)
        self.assertAlmostEqual(prob, 0.55, places=3)
        self.assertNotIn(prob, (0.0, 1.0))
        self.assertIsInstance(warnings, list)

    def test_totals_without_history_uses_prior(self) -> None:
        home = stats("NYY", [])
        away = stats("BOS", [])

        prob, sample_size, warnings = runner.historical_total_probability(home, away, 8.5, "under")

        self.assertEqual(prob, 0.50)
        self.assertEqual(sample_size, 0)
        self.assertIn("hist_total_fallback_prior_050", warnings)

    def test_handicap_generation_stays_in_shadow_when_filters_pass(self) -> None:
        game = {
            "data": "2026-06-19",
            "hora": "20:00",
            "jogo": "NYY vs BOS",
            "home": "NYY",
            "away": "BOS",
            "liga": "MLB",
            "moneyline": {},
            "totals": {},
            "handicaps": {
                "-1_5": {"home": 1.95, "home_line": -1.5},
                "+1_5": {"away": 1.85, "away_line": 1.5},
            },
        }

        home = margin_stats("NYY", [2, 3, 4, 2, 1, 3], avg_for=6.0, avg_against=3.0, win_rate=0.65)
        away = margin_stats("BOS", [-2, -3, -2, -4, -1, -3], avg_for=3.0, avg_against=5.0, win_rate=0.35)
        audit_rows: list[dict[str, object]] = []
        picks = runner.generate_game_picks(game, home, away, "contexto", audit_rows)
        handicaps = [pick for pick in picks if "Handicap" in pick["mercado"]]

        self.assertEqual(handicaps, [])
        self.assertTrue(audit_rows)
        self.assertIn("HANDICAP_SHADOW_ONLY", {row["motivo_descarte"] for row in audit_rows})

    def test_handicap_minus_one_and_half_cover_probability(self) -> None:
        self.assertAlmostEqual(runner.handicap_cover_probability_overdispersed(10.0, 0.2, "home", -1.5), 0.99, delta=0.02)

    def test_handicap_plus_one_and_half_cover_probability(self) -> None:
        self.assertAlmostEqual(runner.handicap_cover_probability_overdispersed(0.2, 10.0, "away", 1.5), 0.99, delta=0.02)

    def test_handicap_overdispersion_changes_cover_probability(self) -> None:
        poisson = runner.handicap_cover_probability_overdispersed(5.2, 4.1, "away", 1.5, dispersion=0.0)
        overdispersed = runner.handicap_cover_probability_overdispersed(5.2, 4.1, "away", 1.5)

        self.assertNotAlmostEqual(poisson, overdispersed, places=4)
        self.assertGreater(poisson, 0.0)
        self.assertLess(overdispersed, 1.0)

    def test_legacy_handicap_probability_name_uses_overdispersed_engine(self) -> None:
        legacy = runner.handicap_cover_probability_poisson(5.2, 4.1, "away", 1.5)
        current = runner.handicap_cover_probability_overdispersed(5.2, 4.1, "away", 1.5)

        self.assertAlmostEqual(legacy, current, places=12)

    def test_integer_handicap_line_is_blocked(self) -> None:
        self.assertFalse(runner.is_allowed_handicap_line(-1.0))

    def test_quarter_handicap_line_is_blocked(self) -> None:
        self.assertFalse(runner.is_allowed_handicap_line(-1.25))

    def test_missing_handicap_no_vig_pair_is_blocked(self) -> None:
        picks: list[dict[str, object]] = []
        runner.add_handicap_pick(
            picks,
            self._game(),
            margin_stats("NYY", [2, 3, 4], avg_for=6.0, avg_against=3.0),
            margin_stats("BOS", [-2, -3, -4], avg_for=3.0, avg_against=5.0),
            "home",
            -1.5,
            1.95,
            None,
            5.8,
            3.0,
            "contexto",
        )

        self.assertEqual(picks, [])

    def test_handicap_no_vig_pair_must_be_exact_opposite_line(self) -> None:
        game = self._game()
        game["handicaps"] = {
            "-1_5": {"home": 1.91, "home_line": -1.5},
            "-2_5": {"away": 1.91, "away_line": -2.5},
        }

        home_candidate = next(item for item in runner.iter_handicap_candidates(game) if item["side"] == "home")

        self.assertEqual(home_candidate["line"], -1.5)
        self.assertIsNone(home_candidate["other_odd"])

    def test_handicap_no_vig_pair_detects_exact_opposite_line(self) -> None:
        game = self._game()
        game["handicaps"] = {
            "+1_5": {"home": 1.91, "home_line": 1.5},
            "-1_5": {"away": 1.91, "away_line": -1.5},
        }

        home_candidate = next(item for item in runner.iter_handicap_candidates(game) if item["side"] == "home")

        self.assertEqual(home_candidate["line"], 1.5)
        self.assertEqual(home_candidate["other_odd"], 1.91)

    def test_handicap_history_uses_real_margin_not_moneyline_result(self) -> None:
        team = margin_stats("NYY", [1, 2, -1, 3], avg_for=5.0, avg_against=4.0)

        result = runner.historical_handicap_cover_rate(team, -1.5, prior=0.50, prior_strength=0.0)

        self.assertEqual(result["sample_size_hist"], 4)
        self.assertEqual(result["covers"], 2)
        self.assertEqual(result["losses"], 2)
        self.assertAlmostEqual(result["cover_rate_raw"], 0.50)

    def test_handicap_history_applies_shrinkage_for_small_samples(self) -> None:
        team = margin_stats("NYY", [2], avg_for=5.0, avg_against=4.0)

        result = runner.historical_handicap_cover_rate(team, -1.5, prior=0.50, prior_strength=10.0)

        self.assertEqual(result["covers"], 1)
        self.assertAlmostEqual(result["cover_rate_raw"], 1.0)
        self.assertLess(result["cover_rate_shrunk"], 1.0)
        self.assertGreater(result["cover_rate_shrunk"], 0.50)

    def test_handicap_audit_records_discard_reason(self) -> None:
        audit_rows: list[dict[str, object]] = []

        runner.add_handicap_pick(
            [],
            self._game(),
            margin_stats("NYY", [2, 3, 4], avg_for=6.0, avg_against=3.0),
            margin_stats("BOS", [-2, -3, -4], avg_for=3.0, avg_against=5.0),
            "home",
            -1.0,
            1.95,
            1.95,
            5.8,
            3.0,
            "contexto",
            audit_rows,
        )

        self.assertEqual(audit_rows[0]["motivo_descarte"], "HANDICAP_LINE_NOT_SUPPORTED")
        self.assertFalse(audit_rows[0]["published"])
        self.assertEqual(audit_rows[0]["mode"], "shadow_blocked")

    def test_handicap_diagnostics_are_top_level_controlled_activation(self) -> None:
        rows = [
            {
                "passou_filtros": True,
                "motivo_descarte": "",
                "pick": "NYY -1.5",
            },
            {
                "passou_filtros": False,
                "motivo_descarte": "INVALID_ODD",
                "pick": "BOS +1.5",
            },
        ]

        diagnostics = runner.build_handicap_shadow_diagnostics(rows)

        self.assertEqual(diagnostics["mode"], "shadow_blocked")
        self.assertEqual(diagnostics["model_version"], "MLB_V2_2_HANDICAP_NB_SHADOW")
        self.assertFalse(diagnostics["published"])
        self.assertEqual(diagnostics["published_count"], 0)
        self.assertEqual(diagnostics["discarded_count"], 1)
        self.assertEqual(diagnostics["summary"]["discard_reasons"], {"INVALID_ODD": 1})

    def test_handicap_high_probability_is_blocked(self) -> None:
        picks: list[dict[str, object]] = []
        runner.append_if_ev(
            picks,
            self._game(),
            "Handicap Asiatico",
            "NYY -1.5",
            "-1.5",
            1.80,
            runner.HANDICAP_MAX_PROB,
            "contexto",
            "teste",
            min_prob=runner.HANDICAP_MIN_PROB,
            max_prob=runner.HANDICAP_MAX_PROB,
            min_edge=runner.HANDICAP_MIN_EDGE,
        )

        self.assertEqual(picks, [])

    def test_handicap_min_edge_is_required(self) -> None:
        picks: list[dict[str, object]] = []
        runner.append_if_ev(
            picks,
            self._game(),
            "Handicap Asiatico",
            "NYY +1.5",
            "+1.5",
            1.80,
            0.56,
            "contexto",
            "teste",
            min_prob=runner.HANDICAP_MIN_PROB,
            max_prob=runner.HANDICAP_MAX_PROB,
            min_edge=runner.HANDICAP_MIN_EDGE,
        )

        self.assertEqual(picks, [])

    def test_high_probability_is_skipped(self) -> None:
        picks: list[dict[str, object]] = []

        runner.append_if_ev(
            picks,
            self._game(),
            "Total de Corridas",
            "Over 7.5",
            "7.5",
            1.60,
            0.70,
            "contexto",
            "teste",
            {"prob_hist": 0.60, "prob_sim": 0.75, "prob_no_vig": 0.58, "sample_size_hist": 20},
        )

        self.assertEqual(picks, [])

    def test_total_requires_no_vig_pair(self) -> None:
        picks: list[dict[str, object]] = []

        runner.add_total_pick(
            picks,
            self._game(),
            "Over",
            7.5,
            1.80,
            0.62,
            0.56,
            None,
            "contexto",
            20,
            [],
        )

        self.assertEqual(picks, [])

    def test_moneyline_still_generates_with_valid_pair(self) -> None:
        picks: list[dict[str, object]] = []
        game = self._game()
        game["moneyline"] = {"home": 1.95, "away": 1.95}

        runner.add_moneyline_pick(
            picks,
            game,
            stats("NYY", [7, 8, 9], win_rate=0.62),
            stats("BOS", [4, 5, 6], win_rate=0.40),
            "home",
            0.60,
            "contexto",
        )

        self.assertEqual(len(picks), 1)
        self.assertEqual(picks[0]["mercado"], "Moneyline")
        self.assertEqual(picks[0]["modelo_versao"], "MLB_V2_1_TEMPORAL_UNCERTAINTY")
        self.assertIn("modelo_versao=MLB_V2_1_TEMPORAL_UNCERTAINTY", picks[0]["observacoes"])

    def test_moneyline_uses_median_odd_for_market_probability_and_best_odd_for_ev(self) -> None:
        picks: list[dict[str, object]] = []
        game = self._game()
        game["moneyline"] = {
            "home": {"offered": 2.00, "consensus": 1.70, "bookmaker": "BestBook"},
            "away": {"offered": 2.30, "consensus": 2.20, "bookmaker": "OtherBook"},
        }
        expected_no_vig = runner.no_vig_probability(1.70, 2.20)

        runner.add_moneyline_pick(
            picks,
            game,
            stats("NYY", [7, 8, 9], win_rate=0.65),
            stats("BOS", [4, 5, 6], win_rate=0.40),
            "home",
            0.65,
            "contexto",
        )

        self.assertEqual(len(picks), 1)
        self.assertEqual(picks[0]["odd_ofertada"], 2.00)
        self.assertEqual(picks[0]["odd_melhor"], 2.00)
        self.assertEqual(picks[0]["odd_mediana"], 1.70)
        self.assertEqual(picks[0]["odd_mercado_base"], 1.70)
        self.assertEqual(picks[0]["bookmaker_melhor"], "BestBook")
        self.assertIn(f"prob_no_vig={expected_no_vig:.4f}", str(picks[0]["observacoes"]))
        self.assertIn("odd_mercado_base=1.700", str(picks[0]["observacoes"]))

    def test_moneyline_probabilities_are_complementary_after_tie_resolution(self) -> None:
        home, away, tie = runner.win_probabilities_overdispersed(4.5, 4.5)

        self.assertAlmostEqual(home + away, 1.0, places=12)
        self.assertAlmostEqual(home, 0.5, places=6)
        self.assertAlmostEqual(away, 0.5, places=6)
        self.assertGreater(tie, 0.10)

    def test_negative_binomial_distribution_has_overdispersion(self) -> None:
        distribution = runner.score_distribution(4.5)
        expected = sum(index * probability for index, probability in enumerate(distribution))
        variance = sum(
            ((index - expected) ** 2) * probability
            for index, probability in enumerate(distribution)
        )

        self.assertAlmostEqual(sum(distribution), 1.0, places=12)
        self.assertAlmostEqual(expected, 4.5, places=5)
        self.assertGreater(variance, expected)

    def test_temporal_average_weights_current_recent_and_previous(self) -> None:
        current = [{"R": str(value)} for value in [3, 4, 5, 8, 10]]
        previous = [{"R": "4"} for _ in range(20)]

        result = runner.temporal_runs_average(current, previous, scored=True, fallback=4.5)

        self.assertGreater(result, 4.0)
        self.assertLess(result, 10.0)

    def test_component_disagreement_haircut_moves_probability_toward_market(self) -> None:
        adjusted, diagnostics = runner.apply_component_disagreement_haircut(
            0.55,
            {"hist": 0.47, "sim": 0.66, "vig": 0.50},
            0.50,
        )

        self.assertAlmostEqual(adjusted, 0.5325, places=4)
        self.assertEqual(diagnostics["status"], "haircut_applied")
        self.assertAlmostEqual(diagnostics["component_spread"], 0.19, places=4)

    def test_component_disagreement_within_tolerance_keeps_probability(self) -> None:
        adjusted, diagnostics = runner.apply_component_disagreement_haircut(
            0.54,
            {"hist": 0.51, "sim": 0.60, "vig": 0.50},
            0.50,
        )

        self.assertEqual(adjusted, 0.54)
        self.assertEqual(diagnostics["status"], "within_tolerance")

    def test_history_cutoff_excludes_game_day_and_future_rows(self) -> None:
        rows = [
            {"Date": "2026-07-09", "R": "4", "RA": "3"},
            {"Date": "2026-07-10", "R": "9", "RA": "1"},
            {"Date": "2026-07-11", "R": "8", "RA": "2"},
        ]

        filtered = runner.sort_and_filter_history_rows(rows, 2026, "2026-07-10")

        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["Date"], "2026-07-09")

    def test_history_filter_removes_exact_duplicates_and_keeps_doubleheaders(self) -> None:
        rows = [
            {"Gm#": "93", "Date": "Thursday Jul 9", "Tm": "MIL", "Opp": "STL", "R": "8", "RA": "4"},
            {"Gm#": "93", "Date": "Thursday Jul 9", "Tm": "MIL", "Opp": "STL", "R": "8", "RA": "4"},
            {"Gm#": "94", "Date": "Friday Jul 10 (1)", "Tm": "MIL", "Opp": "CHC", "R": "3", "RA": "2"},
            {"Gm#": "95", "Date": "Friday Jul 10 (2)", "Tm": "MIL", "Opp": "CHC", "R": "3", "RA": "2"},
        ]

        filtered = runner.sort_and_filter_history_rows(rows, 2026, "2026-07-11")

        self.assertEqual(len(filtered), 3)
        self.assertEqual([row["Gm#"] for row in filtered], ["93", "94", "95"])

    def test_market_selection_keeps_principal_and_two_correlated_alternatives(self) -> None:
        picks = [
            {"mercado": "Total de Corridas", "pick": "Over 7.5", "linha": "7.5", "edge": 8.0},
            {"mercado": "Total de Corridas", "pick": "Over 8.5", "linha": "8.5", "edge": 7.0},
            {"mercado": "Total de Corridas", "pick": "Over 9.5", "linha": "9.5", "edge": 6.0},
            {"mercado": "Total de Corridas", "pick": "Over 10.5", "linha": "10.5", "edge": 5.0},
            {"mercado": "Total de Corridas", "pick": "Under 10.5", "linha": "10.5", "edge": 7.5},
        ]

        selected = runner.limit_correlated_market_selections(picks)

        self.assertEqual(len(selected), 3)
        self.assertTrue(all("Over" in pick["pick"] for pick in selected))
        self.assertEqual(selected[0]["selection_role"], "PRINCIPAL")
        self.assertEqual(selected[2]["selection_role"], "ALTERNATIVA")

    @staticmethod
    def _game() -> dict[str, object]:
        return {
            "data": "2026-06-19",
            "hora": "20:00",
            "jogo": "NYY vs BOS",
            "home": "NYY",
            "away": "BOS",
            "liga": "MLB",
            "moneyline": {},
            "totals": {},
            "handicaps": {},
        }


if __name__ == "__main__":
    unittest.main()
