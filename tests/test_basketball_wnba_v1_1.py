from __future__ import annotations

import math
import unittest
from datetime import datetime
from types import SimpleNamespace

import pandas as pd

from modelos import basketball_runner_real as runner


class FakeWnbaModule:
    PROB_OU_WEIGHTS = {"hist": 0.35, "sim": 0.40, "vig": 0.25}

    def __init__(self, rows: list[dict] | None = None) -> None:
        self.rows = rows or []

    def carregar_dados_time(self, team: str, season: str, local: str | None = None, filtrar_ot: bool = False):
        if team == "NEW":
            return pd.DataFrame()
        return pd.DataFrame(self.rows)


class BasketballWnbaV11Tests(unittest.TestCase):
    def test_wnba_2026_is_current_operational_season(self) -> None:
        self.assertEqual(runner.wnba_operational_seasons(datetime(2026, 6, 1)), ("2026", "2025"))

    def test_wnba_2027_does_not_become_current_operational_season(self) -> None:
        self.assertEqual(runner.wnba_operational_seasons(datetime(2027, 6, 1)), ("2026", "2025"))

    def test_total_points_uses_real_rate_against_line_not_binary_expectation(self) -> None:
        module = FakeWnbaModule([
            {"pontos_time": 80, "pontos_adversario": 80},
            {"pontos_time": 75, "pontos_adversario": 70},
            {"pontos_time": 90, "pontos_adversario": 82},
            {"pontos_time": 65, "pontos_adversario": 70},
        ])
        result = runner.wnba_historical_total_probability(module, "TOR", "NYL", 150.5, "over")
        self.assertEqual(result["jogos_considerados"], 16)
        self.assertAlmostEqual(result["taxa_bruta"], 0.5)

    def test_total_push_does_not_inflate_hit_rate(self) -> None:
        module = FakeWnbaModule([
            {"pontos_time": 75, "pontos_adversario": 75},
            {"pontos_time": 80, "pontos_adversario": 75},
            {"pontos_time": 70, "pontos_adversario": 75},
        ])
        result = runner.wnba_historical_total_probability(module, "TOR", "NYL", 150.0, "over")
        self.assertEqual(result["pushes"], 4)
        self.assertEqual(result["jogos_considerados"], 8)
        self.assertAlmostEqual(result["taxa_bruta"], 0.5)

    def test_low_sample_applies_shrinkage_toward_neutral_prior(self) -> None:
        module = FakeWnbaModule([{"pontos_time": 90, "pontos_adversario": 80}])
        result = runner.wnba_historical_total_probability(module, "TOR", "NYL", 150.5, "over")
        self.assertIn("LOW_SAMPLE", result["warnings"])
        self.assertLess(result["taxa_com_shrinkage"], 1.0)
        self.assertGreater(result["taxa_com_shrinkage"], 0.5)

    def test_new_team_without_history_uses_neutral_fallback_without_crashing(self) -> None:
        module = FakeWnbaModule([])
        result = runner.wnba_historical_total_probability(module, "NEW", "NYL", 150.5, "over")
        self.assertEqual(result["jogos_considerados"], 0)
        self.assertEqual(result["taxa_com_shrinkage"], 0.5)
        self.assertEqual(result["fallback"], "FALLBACK_NEUTRO_SEM_HISTORICO")

    def test_moneyline_without_real_odds_does_not_generate_artificial_edge(self) -> None:
        item = {
            "mercado": "Moneyline",
            "pick": "Toronto Tempo W",
            "mandante": "Toronto Tempo W",
            "visitante": "New York Liberty W",
            "odd_ofertada": 2.0,
            "odd_valor": 1.80,
            "probabilidade_final": 55.0,
        }
        row = pd.Series({"_ml_home_missing": True, "_ml_away_missing": False})
        self.assertIsNone(runner.apply_wnba_v1_1_to_pick(FakeWnbaModule(), row, {}, item, "TOR", "NYL"))

    def test_fragile_handicap_is_blocked(self) -> None:
        item = {
            "mercado": "Handicap Asiático",
            "pick": "Toronto Tempo W +1.5",
            "linha": 1.5,
            "odd_ofertada": 1.9,
            "odd_valor": 1.7,
            "probabilidade_final": 58.0,
        }
        self.assertIsNone(runner.apply_wnba_v1_1_to_pick(FakeWnbaModule(), pd.Series({}), {}, item, "TOR", "NYL"))

    def test_output_keeps_expected_columns(self) -> None:
        row = {
            "data": "22/06/2026",
            "hora": "20:00",
            "liga": "WNBA",
            "jogo": "Toronto Tempo W vs New York Liberty W",
            "mandante": "Toronto Tempo W",
            "visitante": "New York Liberty W",
            "mercado": "Moneyline",
            "pick": "Toronto Tempo W",
            "linha": "",
            "odd_ofertada": 1.8,
            "odd_valor": 1.7,
            "probabilidade_final": 58.0,
            "edge": 5.88,
        }
        normalized = runner.normalize_rows([row], "WNBA")[0]
        for key in ("data", "hora", "liga", "esporte", "jogo", "mandante", "visitante", "mercado", "pick", "linha", "probabilidade", "odd_valor", "odd_ofertada", "edge", "stake", "observacoes"):
            self.assertIn(key, normalized)
        self.assertIn(runner.BASKETBALL_WNBA_MODEL_VERSION, normalized["observacoes"])

    def test_wnba_changes_do_not_touch_nba_normalization(self) -> None:
        row = {
            "data": "22/06/2026",
            "liga": "NBA",
            "jogo": "A vs B",
            "mercado": "Moneyline",
            "pick": "A",
            "odd_ofertada": 1.8,
            "odd_valor": 1.7,
            "probabilidade_final": 58.0,
            "edge": 5.88,
            "observacoes": "NBA original",
        }
        normalized = runner.normalize_rows([row], "NBA")[0]
        self.assertEqual(normalized["observacoes"], "NBA original")
        self.assertNotIn(runner.BASKETBALL_WNBA_MODEL_VERSION, normalized["observacoes"])


if __name__ == "__main__":
    unittest.main()
