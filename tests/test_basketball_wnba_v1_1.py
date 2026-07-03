from __future__ import annotations

import math
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

from modelos import basketball_runner_real as runner


class FakeWnbaModule:
    PROB_OU_WEIGHTS = {"hist": 0.35, "sim": 0.40, "vig": 0.25}
    TEAMS = {"TOR": "Toronto Tempo W", "PHO": "Phoenix Mercury W", "NYL": "New York Liberty W"}

    def __init__(self, rows: list[dict] | None = None) -> None:
        self.rows = rows or []

    def carregar_dados_time(self, team: str, season: str, local: str | None = None, filtrar_ot: bool = False):
        if team == "NEW":
            return pd.DataFrame()
        return pd.DataFrame(self.rows)

    def calcular_metricas_time(self, team: str, local: str, linhas: list[float]):
        df = pd.DataFrame(self.rows)
        return {
            "media_tm": float(df["pontos_time"].mean()) if not df.empty else 80.0,
            "media_opp": float(df["pontos_adversario"].mean()) if not df.empty else 80.0,
            "std_tm": float(df["pontos_time"].std(ddof=0)) if len(df) > 1 else 10.0,
            "std_opp": float(df["pontos_adversario"].std(ddof=0)) if len(df) > 1 else 10.0,
        }


class TargetedWnbaModule:
    def __init__(self, rows_by_key: dict[tuple[str, str | None, str], list[dict]]) -> None:
        self.rows_by_key = rows_by_key

    def get_pesos_temporada_wnba(self, current_games: int) -> dict[str, float]:
        return {"passada": 0.0, "atual": 1.0, "recente": 0.0}

    def carregar_dados_time(self, team: str, season: str, local: str | None = None, filtrar_ot: bool = False):
        rows = self.rows_by_key.get((team, local, season), [])
        if local is not None and not rows:
            rows = self.rows_by_key.get((team, None, season), [])
        return pd.DataFrame(rows)

    def calcular_metricas_time(self, team: str, local: str, linhas: list[float]):
        df = self.carregar_dados_time(team, "2026", local=local)
        return {
            "media_tm": float(df["pontos_time"].mean()) if not df.empty else 80.0,
            "media_opp": float(df["pontos_adversario"].mean()) if not df.empty else 80.0,
            "std_tm": float(df["pontos_time"].std(ddof=0)) if len(df) > 1 else 10.0,
            "std_opp": float(df["pontos_adversario"].std(ddof=0)) if len(df) > 1 else 10.0,
        }


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
        self.assertGreater(result["jogos_considerados"], 0)
        self.assertAlmostEqual(result["taxa_bruta"], 0.5)

    def test_total_push_does_not_inflate_hit_rate(self) -> None:
        module = FakeWnbaModule([
            {"pontos_time": 75, "pontos_adversario": 75},
            {"pontos_time": 80, "pontos_adversario": 75},
            {"pontos_time": 70, "pontos_adversario": 75},
        ])
        result = runner.wnba_historical_total_probability(module, "TOR", "NYL", 150.0, "over")
        self.assertGreater(result["pushes"], 0)
        self.assertGreater(result["jogos_considerados"], 0)
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

    def test_total_points_balances_team_components_instead_of_pooling_by_sample_size(self) -> None:
        home_rows = (
            [{"pontos_time": 90, "pontos_adversario": 90}] * 2 +
            [{"pontos_time": 80, "pontos_adversario": 80}] * 4
        )
        away_rows = (
            [{"pontos_time": 91, "pontos_adversario": 90}] * 4 +
            [{"pontos_time": 80, "pontos_adversario": 80}] * 32
        )
        module = TargetedWnbaModule({
            ("TOR", "casa", "2026"): home_rows,
            ("TOR", None, "2026"): home_rows,
            ("PHO", "fora", "2026"): away_rows,
            ("PHO", None, "2026"): away_rows,
        })
        result = runner.wnba_historical_total_probability(module, "TOR", "PHO", 176.5, "over")
        pooled_rate = (2 + 4) / (6 + 36)
        balanced_rate = ((2 / 6) + (4 / 36)) / 2
        self.assertAlmostEqual(result["taxa_bruta"], balanced_rate)
        self.assertGreater(result["taxa_bruta"], pooled_rate)

    def test_wnba_expected_points_use_team_points_as_scored_and_opponent_points_as_allowed(self) -> None:
        module = TargetedWnbaModule({
            ("TOR", "casa", "2026"): [{"pontos_time": 90, "pontos_adversario": 70}],
            ("TOR", None, "2026"): [{"pontos_time": 90, "pontos_adversario": 70}],
            ("PHO", "fora", "2026"): [{"pontos_time": 80, "pontos_adversario": 100}],
            ("PHO", None, "2026"): [{"pontos_time": 80, "pontos_adversario": 100}],
        })
        expectation = runner.wnba_calculate_expected_points(module, "TOR", "PHO", lines=[170.5])
        self.assertAlmostEqual(expectation["home_expected"], 94.5)
        self.assertAlmostEqual(expectation["away_expected"], 75.5)

    def test_total_points_debug_uses_v1_3_weights_simulation_and_compact_components(self) -> None:
        rows = [
            {"pontos_time": 90, "pontos_adversario": 90},
            {"pontos_time": 80, "pontos_adversario": 80},
        ]
        module = FakeWnbaModule(rows)
        row = pd.Series({})
        res = {"ou": {176.5: {"odd_off_over": 1.85, "odd_off_under": 1.93, "sim_over": 50.0}}}
        item = {
            "mercado": "Over/Under Pontos",
            "pick": "Over 176.5",
            "linha": 176.5,
            "odd_ofertada": 1.85,
            "odd_valor": 1.80,
            "probabilidade_final": 55.0,
        }
        adjusted, debug = runner.recalculate_wnba_total_pick(module, row, res, item, "TOR", "PHO", lines=[176.5])
        self.assertEqual(debug["pesos_probabilidade"], runner.WNBA_TOTAL_V1_3_WEIGHTS)
        self.assertEqual(debug["simulacoes"], runner.WNBA_TOTAL_SIMULATIONS)
        self.assertIn("total_calibrado", debug)
        self.assertIn("home", debug["componentes_historicos"])
        self.assertIn("shrunk", debug["componentes_historicos"]["home"])
        self.assertIsInstance(adjusted["probabilidade_final"], float)

    def test_total_points_uses_median_odd_for_no_vig_and_best_odd_for_ev(self) -> None:
        rows = [
            {"pontos_time": 90, "pontos_adversario": 90},
            {"pontos_time": 80, "pontos_adversario": 80},
        ]
        module = FakeWnbaModule(rows)
        row = pd.Series({
            "date": "2026-06-27",
            "time": "20:00",
            "odds_OverUnder_FT_including_OT_176_5_Over": 2.00,
            "odds_OverUnder_FT_including_OT_176_5_Under": 2.10,
            "odds_OverUnder_FT_including_OT_176_5_Over_MEDIANA": 1.70,
            "odds_OverUnder_FT_including_OT_176_5_Under_MEDIANA": 2.20,
            "odds_OverUnder_FT_including_OT_176_5_Over_BOOKMAKER_MELHOR": "BestBook",
        })
        res = {"ou": {176.5: {"odd_off_over": 2.00, "odd_off_under": 2.10}}}
        item = {
            "mercado": "Over/Under Pontos",
            "pick": "Over 176.5",
            "linha": 176.5,
            "odd_ofertada": 2.00,
        }

        adjusted, debug = runner.recalculate_wnba_total_pick(module, row, res, item, "TOR", "PHO", lines=[176.5])
        expected_no_vig, _ = runner.no_vig_pair(1.70, 2.20)

        self.assertEqual(adjusted["odd_ofertada"], 2.00)
        self.assertEqual(adjusted["odd_melhor"], 2.00)
        self.assertEqual(adjusted["odd_mediana"], 1.70)
        self.assertEqual(adjusted["odd_mercado_base"], 1.70)
        self.assertEqual(adjusted["bookmaker_melhor"], "BestBook")
        self.assertAlmostEqual(debug["prob_no_vig"], round(expected_no_vig * 100.0, 2))

    def test_wnba_total_candidates_include_over_and_under_before_v1_2_filter(self) -> None:
        row = pd.Series({"home_sigla": "TOR", "away_sigla": "PHO", "date": "2026-06-27", "time": "20:00"})
        res = {
            "ou": {
                176.5: {
                    "prob_over": 40.0,
                    "odd_val_over": 2.50,
                    "odd_off_over": 1.85,
                    "prob_under": 60.0,
                    "odd_val_under": 1.67,
                    "odd_off_under": 1.93,
                }
            }
        }
        rows = runner.build_wnba_total_candidate_rows(FakeWnbaModule(), row, res)
        self.assertEqual([item["pick"] for item in rows], ["Over 176.5", "Under 176.5"])

    def test_wnba_moneyline_candidates_include_both_sides_before_filter(self) -> None:
        row = pd.Series({"home_sigla": "TOR", "away_sigla": "PHO", "date": "2026-06-27", "time": "20:00"})
        res = {"odd_ml_c": 1.80, "odd_ml_f": 2.05}
        rows = runner.build_wnba_moneyline_candidate_rows(FakeWnbaModule(), row, res)
        self.assertEqual([item["mercado"] for item in rows], ["Moneyline", "Moneyline"])
        self.assertEqual([item["pick"] for item in rows], ["Toronto Tempo W", "Phoenix Mercury W"])

    def test_wnba_handicap_candidates_include_paired_lines_before_filter(self) -> None:
        row = pd.Series({"home_sigla": "TOR", "away_sigla": "PHO", "date": "2026-06-27", "time": "20:00"})
        res = {
            "hc": {
                ("home", -4.5): {"odd_off": 1.91},
                ("away", +4.5): {"odd_off": 1.91},
            }
        }
        rows = runner.build_wnba_handicap_candidate_rows(FakeWnbaModule(), row, res)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all("handicap" in runner.normalize_text(item["mercado"]) for item in rows))
        self.assertEqual([item["linha"] for item in rows], [-4.5, 4.5])

    def test_long_csv_to_wide_preserves_handicap_sign_per_team(self) -> None:
        rows = [
            {
                "data": "27.06.2026",
                "hora": "21:00",
                "esporte": "Basketball",
                "liga": "WNBA",
                "jogo": "Toronto Tempo W vs Phoenix Mercury W",
                "mandante": "Toronto Tempo W",
                "visitante": "Phoenix Mercury W",
                "mercado": "Asian handicap",
                "pick": "Toronto Tempo W",
                "linha": -7.5,
                "odd": 1.98,
            },
            {
                "data": "27.06.2026",
                "hora": "21:00",
                "esporte": "Basketball",
                "liga": "WNBA",
                "jogo": "Toronto Tempo W vs Phoenix Mercury W",
                "mandante": "Toronto Tempo W",
                "visitante": "Phoenix Mercury W",
                "mercado": "Asian handicap",
                "pick": "Phoenix Mercury W",
                "linha": 7.5,
                "odd": 1.80,
            },
            {
                "data": "27.06.2026",
                "hora": "21:00",
                "esporte": "Basketball",
                "liga": "WNBA",
                "jogo": "Toronto Tempo W vs Phoenix Mercury W",
                "mandante": "Toronto Tempo W",
                "visitante": "Phoenix Mercury W",
                "mercado": "Asian handicap",
                "pick": "Toronto Tempo W",
                "linha": 7.5,
                "odd": 1.29,
            },
            {
                "data": "27.06.2026",
                "hora": "21:00",
                "esporte": "Basketball",
                "liga": "WNBA",
                "jogo": "Toronto Tempo W vs Phoenix Mercury W",
                "mandante": "Toronto Tempo W",
                "visitante": "Phoenix Mercury W",
                "mercado": "Asian handicap",
                "pick": "Phoenix Mercury W",
                "linha": -7.5,
                "odd": 3.25,
            },
        ]
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="", encoding="utf-8") as fh:
            pd.DataFrame(rows).to_csv(fh.name, index=False)
            wide = runner.long_csv_to_wide(Path(fh.name), "WNBA", FakeWnbaModule())
        pairs = {
            float(wide.iloc[0][col]): (
                float(wide.iloc[0][col.replace("_HANDICAP", "_1")]),
                float(wide.iloc[0][col.replace("_HANDICAP", "_Opp_HANDICAP")]),
                float(wide.iloc[0][col.replace("_HANDICAP", "_Opp_Odd")]),
            )
            for col in wide.columns
            if col.endswith("_HANDICAP") and "_Opp_" not in col and not pd.isna(wide.iloc[0][col])
        }
        self.assertEqual(pairs[-7.5], (1.98, 7.5, 1.80))
        self.assertEqual(pairs[7.5], (1.29, -7.5, 3.25))

    def test_long_csv_to_wide_preserves_median_best_and_bookmaker_columns(self) -> None:
        rows = [
            {
                "data": "27.06.2026",
                "hora": "21:00",
                "esporte": "Basketball",
                "liga": "WNBA",
                "jogo": "Toronto Tempo W vs Phoenix Mercury W",
                "mandante": "Toronto Tempo W",
                "visitante": "Phoenix Mercury W",
                "mercado": "Moneyline",
                "pick": "Toronto Tempo W",
                "linha": "",
                "odd": 1.90,
                "odd_melhor": 2.00,
                "odd_mediana": 1.82,
                "bookmaker": "book-a",
                "bookmaker_melhor": "book-best",
            },
            {
                "data": "27.06.2026",
                "hora": "21:00",
                "esporte": "Basketball",
                "liga": "WNBA",
                "jogo": "Toronto Tempo W vs Phoenix Mercury W",
                "mandante": "Toronto Tempo W",
                "visitante": "Phoenix Mercury W",
                "mercado": "Moneyline",
                "pick": "Phoenix Mercury W",
                "linha": "",
                "odd": 1.95,
                "odd_melhor": 2.05,
                "odd_mediana": 1.88,
                "bookmaker": "book-a",
                "bookmaker_melhor": "book-away",
            },
        ]
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="", encoding="utf-8") as fh:
            pd.DataFrame(rows).to_csv(fh.name, index=False)
            wide = runner.long_csv_to_wide(Path(fh.name), "WNBA", FakeWnbaModule())

        self.assertEqual(float(wide.iloc[0]["odds_HomeAway_FT_including_OT_1"]), 2.00)
        self.assertEqual(float(wide.iloc[0]["odds_HomeAway_FT_including_OT_1_MEDIANA"]), 1.82)
        self.assertEqual(wide.iloc[0]["odds_HomeAway_FT_including_OT_1_BOOKMAKER_MELHOR"], "book-best")
        self.assertEqual(float(wide.iloc[0]["odds_HomeAway_FT_including_OT_2"]), 2.05)
        self.assertEqual(float(wide.iloc[0]["odds_HomeAway_FT_including_OT_2_MEDIANA"]), 1.88)

    def test_moneyline_uses_real_wins_simulation_and_no_vig(self) -> None:
        rows = [
            {"pontos_time": 90, "pontos_adversario": 80, "resultado": "W"},
            {"pontos_time": 88, "pontos_adversario": 82, "resultado": "W"},
            {"pontos_time": 76, "pontos_adversario": 84, "resultado": "L"},
            {"pontos_time": 92, "pontos_adversario": 89, "resultado": "W"},
        ]
        module = FakeWnbaModule(rows)
        row = pd.Series({"date": "2026-06-27", "time": "20:00"})
        res = {"odd_ml_c": 1.80, "odd_ml_f": 2.05, "ou": {170.5: {"odd_off_over": 1.91, "odd_off_under": 1.91}}}
        item = {
            "mercado": "Moneyline",
            "pick": "Toronto Tempo W",
            "mandante": "Toronto Tempo W",
            "visitante": "Phoenix Mercury W",
            "odd_ofertada": 1.80,
        }
        adjusted, debug = runner.recalculate_wnba_moneyline_pick(module, row, res, item, "TOR", "PHO", lines=[170.5])
        self.assertEqual(debug["pesos_probabilidade"], runner.WNBA_MONEYLINE_V1_4_WEIGHTS)
        self.assertIn("vitorias_reais", debug)
        self.assertIn("vitorias_sim_home", debug)
        self.assertIn("prob_no_vig", debug)
        self.assertIsInstance(adjusted["probabilidade_final"], float)

    def test_moneyline_uses_median_odd_for_no_vig_and_best_odd_for_ev(self) -> None:
        rows = [
            {"pontos_time": 90, "pontos_adversario": 80, "resultado": "W"},
            {"pontos_time": 88, "pontos_adversario": 82, "resultado": "W"},
        ]
        module = FakeWnbaModule(rows)
        row = pd.Series({
            "date": "2026-06-27",
            "time": "20:00",
            "odds_HomeAway_FT_including_OT_1": 2.00,
            "odds_HomeAway_FT_including_OT_2": 2.10,
            "odds_HomeAway_FT_including_OT_1_MEDIANA": 1.80,
            "odds_HomeAway_FT_including_OT_2_MEDIANA": 2.05,
            "odds_HomeAway_FT_including_OT_1_BOOKMAKER_MELHOR": "BestBook",
        })
        res = {"odd_ml_c": 2.00, "odd_ml_f": 2.10, "ou": {170.5: {"odd_off_over": 1.91, "odd_off_under": 1.91}}}
        item = {
            "mercado": "Moneyline",
            "pick": "Toronto Tempo W",
            "mandante": "Toronto Tempo W",
            "visitante": "Phoenix Mercury W",
            "odd_ofertada": 2.00,
        }

        adjusted, debug = runner.recalculate_wnba_moneyline_pick(module, row, res, item, "TOR", "PHO", lines=[170.5])
        expected_no_vig, _ = runner.no_vig_pair(1.80, 2.05)

        self.assertEqual(adjusted["odd_ofertada"], 2.00)
        self.assertEqual(adjusted["odd_melhor"], 2.00)
        self.assertEqual(adjusted["odd_mediana"], 1.80)
        self.assertEqual(adjusted["odd_mercado_base"], 1.80)
        self.assertEqual(adjusted["bookmaker_melhor"], "BestBook")
        self.assertAlmostEqual(debug["prob_no_vig"], round(expected_no_vig * 100.0, 2))

    def test_handicap_uses_real_cover_simulated_cover_and_no_vig(self) -> None:
        rows = [
            {"pontos_time": 90, "pontos_adversario": 80, "resultado": "W"},
            {"pontos_time": 88, "pontos_adversario": 82, "resultado": "W"},
            {"pontos_time": 76, "pontos_adversario": 84, "resultado": "L"},
            {"pontos_time": 92, "pontos_adversario": 89, "resultado": "W"},
        ]
        module = FakeWnbaModule(rows)
        row = pd.Series({"date": "2026-06-27", "time": "20:00"})
        res = {
            "ou": {170.5: {"odd_off_over": 1.91, "odd_off_under": 1.91}},
            "hc": {
                ("home", -4.5): {"odd_off": 1.91},
                ("away", +4.5): {"odd_off": 1.91},
            },
        }
        item = {
            "mercado": "Handicap Asiático",
            "pick": "Toronto Tempo W -4.5",
            "mandante": "Toronto Tempo W",
            "visitante": "Phoenix Mercury W",
            "linha": -4.5,
            "odd_ofertada": 1.91,
        }
        adjusted, debug = runner.recalculate_wnba_handicap_pick(module, row, res, item, "TOR", "PHO", lines=[170.5])
        self.assertEqual(debug["pesos_probabilidade"], runner.WNBA_HANDICAP_V1_8_WEIGHTS)
        self.assertIn("coberturas_reais", debug)
        self.assertIn("coberturas_simuladas", debug)
        self.assertIn("prob_no_vig", debug)
        self.assertIsInstance(adjusted["probabilidade_final"], float)

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
            "odd_mediana": 1.75,
            "odd_mercado_base": 1.75,
            "odd_melhor": 1.8,
            "bookmaker_melhor": "BestBook",
            "odd_valor": 1.7,
            "probabilidade_final": 58.0,
            "edge": 5.88,
        }
        normalized = runner.normalize_rows([row], "WNBA")[0]
        for key in ("data", "hora", "liga", "esporte", "jogo", "mandante", "visitante", "mercado", "pick", "linha", "probabilidade", "odd_valor", "odd_ofertada", "odd_mediana", "odd_mercado_base", "odd_melhor", "bookmaker_melhor", "edge", "stake", "observacoes"):
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
