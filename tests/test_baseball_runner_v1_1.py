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
        self.assertEqual(runner.MODEL_VERSION, "MLB_V1_1")
        self.assertTrue(runner.HANDICAP_ENABLED_MLB_V1_1)
        self.assertTrue(runner.HANDICAP_CONTROLLED_ACTIVATION_MLB_V1_1)
        self.assertEqual(runner.BASEBALL_MLB_HANDICAP_MODEL_VERSION, "MLB_V1_1_HANDICAP_CONTROLLED")

    def test_totals_historical_probability_is_smoothed_not_binary(self) -> None:
        home = stats("NYY", [6, 8, 10, 12, 4])
        away = stats("BOS", [9, 9, 11, 5, 13])

        prob, sample_size, warnings = runner.historical_total_probability(home, away, 8.5, "over")

        self.assertEqual(sample_size, 10)
        self.assertGreater(prob, 0.0)
        self.assertLess(prob, 1.0)
        self.assertAlmostEqual(prob, 0.55)
        self.assertNotIn(prob, (0.0, 1.0))
        self.assertIsInstance(warnings, list)

    def test_totals_without_history_uses_prior(self) -> None:
        home = stats("NYY", [])
        away = stats("BOS", [])

        prob, sample_size, warnings = runner.historical_total_probability(home, away, 8.5, "under")

        self.assertEqual(prob, 0.50)
        self.assertEqual(sample_size, 0)
        self.assertIn("hist_total_fallback_prior_050", warnings)

    def test_handicap_generation_uses_controlled_activation_when_filters_pass(self) -> None:
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
        picks = runner.generate_game_picks(game, home, away, "contexto")
        handicaps = [pick for pick in picks if "Handicap" in pick["mercado"]]

        self.assertTrue(handicaps)
        self.assertTrue(all("shadow_mode" not in pick for pick in handicaps))
        self.assertTrue(all("market_status" not in pick for pick in handicaps))
        self.assertTrue(all(pick["modelo_versao"] == "MLB_V1_1_HANDICAP_CONTROLLED" for pick in handicaps))
        self.assertTrue(all(pick["activation_status"] == "HANDICAP_SELECTED_CONTROLLED" for pick in handicaps))

    def test_handicap_minus_one_and_half_cover_probability(self) -> None:
        self.assertAlmostEqual(runner.handicap_cover_probability_poisson(10.0, 0.2, "home", -1.5), 0.99, delta=0.02)

    def test_handicap_plus_one_and_half_cover_probability(self) -> None:
        self.assertAlmostEqual(runner.handicap_cover_probability_poisson(0.2, 10.0, "away", 1.5), 0.99, delta=0.02)

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
        self.assertEqual(audit_rows[0]["mode"], "controlled_activation")

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

        self.assertEqual(diagnostics["mode"], "controlled_activation")
        self.assertEqual(diagnostics["model_version"], "MLB_V1_1_HANDICAP_CONTROLLED")
        self.assertTrue(diagnostics["published"])
        self.assertEqual(diagnostics["published_count"], 1)
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
        self.assertEqual(picks[0]["modelo_versao"], "MLB_V1_1")
        self.assertIn("modelo_versao=MLB_V1_1", picks[0]["observacoes"])

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
