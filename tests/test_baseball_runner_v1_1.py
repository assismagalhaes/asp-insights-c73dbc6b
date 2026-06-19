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


class BaseballRunnerV11Tests(unittest.TestCase):
    def test_model_version_and_handicap_flag_are_set(self) -> None:
        self.assertEqual(runner.MODEL_VERSION, "MLB_V1_1")
        self.assertFalse(runner.HANDICAP_ENABLED_MLB_V1_1)

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

    def test_handicap_generation_is_blocked(self) -> None:
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
                "+1_5": {"home": 1.80, "home_line": 1.5},
                "-1_5": {"away": 1.90, "away_line": -1.5},
            },
        }

        picks = runner.generate_game_picks(game, stats("NYY", [7, 8, 9]), stats("BOS", [4, 5, 6]), "contexto")

        self.assertFalse(any("Handicap" in pick["mercado"] for pick in picks))

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
