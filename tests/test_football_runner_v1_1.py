import sys
import os
import tempfile
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
MODELOS_DIR = ROOT / "modelos"
if str(MODELOS_DIR) not in sys.path:
    sys.path.insert(0, str(MODELOS_DIR))

import football_runner_real as runner
import football_adapter


def wide_row(**overrides):
    row = {
        "home": "Home FC",
        "away": "Away FC",
        "odds_1X2_Full_Time_1": 2.05,
        "odds_1X2_Full_Time_X": 3.30,
        "odds_1X2_Full_Time_2": 3.60,
        "odds_Double_chance_Full_Time_1X": 1.35,
        "odds_Double_chance_Full_Time_12": 1.28,
        "odds_Double_chance_Full_Time_X2": 1.62,
        "odds_Both_teams_to_score_Full_Time_YES": 1.95,
        "odds_Both_teams_to_score_Full_Time_NO": 1.95,
        "odds_OverUnder_Full_Time_2_5_Over": 1.95,
        "odds_OverUnder_Full_Time_2_5_Under": 1.95,
        "odds_Asian_handicap_Full_Time_Linha1_HANDICAP": 0.5,
        "odds_Asian_handicap_Full_Time_Linha1_1": 1.45,
        "odds_Asian_handicap_Full_Time_Linha1_Opp_HANDICAP": -0.5,
        "odds_Asian_handicap_Full_Time_Linha1_Opp_Odd": 2.65,
        "odds_Asian_handicap_Full_Time_Linha2_HANDICAP": -0.5,
        "odds_Asian_handicap_Full_Time_Linha2_1": 1.45,
        "odds_Asian_handicap_Full_Time_Linha2_Opp_HANDICAP": 0.5,
        "odds_Asian_handicap_Full_Time_Linha2_Opp_Odd": 2.65,
        "odds_Asian_handicap_Full_Time_Linha3_HANDICAP": 0.0,
        "odds_Asian_handicap_Full_Time_Linha3_1": 2.05,
        "odds_Asian_handicap_Full_Time_Linha3_Opp_HANDICAP": 0.0,
        "odds_Asian_handicap_Full_Time_Linha3_Opp_Odd": 1.85,
        "odds_Asian_handicap_Full_Time_Linha4_HANDICAP": 0.25,
        "odds_Asian_handicap_Full_Time_Linha4_1": 2.00,
        "odds_Asian_handicap_Full_Time_Linha4_Opp_HANDICAP": -0.25,
        "odds_Asian_handicap_Full_Time_Linha4_Opp_Odd": 1.90,
        "odds_Asian_handicap_Full_Time_Linha5_HANDICAP": 1.0,
        "odds_Asian_handicap_Full_Time_Linha5_1": 2.10,
        "odds_Asian_handicap_Full_Time_Linha5_Opp_HANDICAP": -1.0,
        "odds_Asian_handicap_Full_Time_Linha5_Opp_Odd": 1.80,
    }
    row.update(overrides)
    return pd.Series(row)


def output_row(**overrides):
    row = {
        "data": "18/06/2026",
        "hora": "15:00",
        "esporte": "Futebol",
        "liga": "Brazil - Serie A",
        "jogo": "Home FC vs Away FC",
        "mandante": "Home FC",
        "visitante": "Away FC",
        "mercado": "Resultado Final",
        "pick": "Home FC para vencer",
        "linha": "",
        "odd_ofertada": 2.00,
        "odd_valor": 1.82,
        "probabilidade_final": 55.0,
        "edge": 10.0,
        "observacoes": "base",
        "dados_tecnicos": "tecnico",
        "contexto_modelo": "contexto",
        "arquivo_contexto": "ctx.txt",
    }
    row.update(overrides)
    return pd.Series(row)


def output_row_with_core_debug(**overrides):
    row = output_row(**overrides).to_dict()
    row["observacoes"] = (
        "base; core_lambda_home=1.4321; core_lambda_away=1.1234; "
        "league_avg_home_goals=1.5000; league_avg_away_goals=1.1000; "
        "sample_home=24; sample_away=23; sample_league=180; "
        "shrinkage_k=dynamic_by_league_weights; score_matrix_max_goals=10; "
        "score_matrix_tail_mass=0.00012000; score_matrix_probability_sum=0.99988000; "
        "nbd_enabled=False; overdispersion_ratio=1.2200"
    )
    return pd.Series(row)


class FootballRunnerV11Test(unittest.TestCase):
    def test_model_version_is_set(self):
        self.assertEqual(runner.MODEL_VERSION, "FOOTBALL_V1_3")

    def test_no_vig_three_way_sums_to_one(self):
        probs = runner.no_vig_probability_three(2.0, 3.0, 4.0)
        self.assertAlmostEqual(sum(probs), 1.0, places=9)

    def test_shrinkage_zero_sample_returns_prior(self):
        self.assertAlmostEqual(runner.apply_shrinkage(0.80, 0), runner.PRIOR_PROBABILITY)

    def test_resultado_final_requires_three_way_baseline_and_can_select(self):
        selected, discarded = runner._evaluate_row_v1_1(output_row(), wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["modelo_versao"], "FOOTBALL_V1_3")
        self.assertIn("modelo_versao=FOOTBALL_V1_3", selected["observacoes"])

    def test_core_lambda_debug_is_exposed_when_available(self):
        selected, discarded = runner._evaluate_row_v1_1(output_row_with_core_debug(), wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertIn("lambda_home_final=1.4321", selected["observacoes"])
        self.assertIn("lambda_away_final=1.1234", selected["observacoes"])
        self.assertIn("sample_home=24", selected["observacoes"])
        self.assertIn("score_matrix_tail_mass=0.00012000", selected["observacoes"])
        self.assertNotIn("not_exposed_by_v1_runner", selected["observacoes"])

    def test_missing_core_debug_uses_explicit_unavailable_reason(self):
        selected, discarded = runner._evaluate_row_v1_1(output_row(), wide_row())
        self.assertIsNone(discarded)
        self.assertIn("lambda_home_final=unavailable_not_calculated_by_core", selected["observacoes"])
        self.assertNotIn("not_exposed_by_v1_runner", selected["observacoes"])

    def test_selects_only_matching_match_context(self):
        contexto = """Confronto:
Home FC (2º) vs Away FC (5º) | (Brazil - Serie A)
--- DADOS TÉCNICOS ---
RPI Home FC

Confronto:
Other FC (1º) vs Rival FC (4º) | (Brazil - Serie A)
--- DADOS TÉCNICOS ---
RPI Other FC
"""

        selected = runner.selecionar_contexto_do_prognostico(output_row(), contexto)

        self.assertIn("Home FC", selected)
        self.assertIn("Away FC", selected)
        self.assertNotIn("Other FC", selected)
        self.assertNotIn("Rival FC", selected)

    def test_does_not_fallback_to_all_context_when_multiple_blocks_do_not_match(self):
        contexto = """Confronto:
Other FC vs Rival FC | (Brazil - Serie A)
--- DADOS TÉCNICOS ---
RPI Other FC

Confronto:
Third FC vs Fourth FC | (Brazil - Serie A)
--- DADOS TÉCNICOS ---
RPI Third FC
"""

        selected = runner.selecionar_contexto_do_prognostico(output_row(), contexto)

        self.assertEqual(selected, "")

    def test_context_match_ignores_team_names_inside_other_match_history(self):
        contexto = """Confronto:
Shanghai Shenhua (2o) vs Beijing Guoan (5o) | (CHN - Super League)
--- ULTIMOS 5 JOGOS NO LOCAL ---
Shanghai Shenhua vs Shenzhen Xinpengcheng
Beijing Guoan vs Qingdao West Coast

Confronto:
Shenzhen Xinpengcheng (15o) vs Qingdao West Coast (7o) | (CHN - Super League)
--- DADOS TECNICOS ---
RPI Shenzhen Xinpengcheng
"""
        row = output_row(
            jogo="Shenzhen Xinpengcheng vs Qingdao West Coast",
            mandante="Shenzhen Xinpengcheng",
            visitante="Qingdao West Coast",
        )

        selected = runner.selecionar_contexto_do_prognostico(row, contexto)

        self.assertIn("Shenzhen Xinpengcheng (15o) vs Qingdao West Coast (7o)", selected)
        self.assertNotIn("Shanghai Shenhua", selected)

    def test_single_mismatched_context_fails_closed(self):
        contexto = """Confronto:
Other FC vs Rival FC | (Brazil - Serie A)
--- DADOS TECNICOS ---
RPI Other FC
"""

        selected = runner.selecionar_contexto_do_prognostico(output_row(), contexto)

        self.assertEqual(selected, "")

    def test_readable_context_reports_stale_source_data_without_raw_log(self):
        technical = """Confronto:
Home FC vs Away FC
Data/Horario: 14/07/2026
--- ULTIMOS 5 JOGOS NO LOCAL ---
30/05/2026 vs Rival FC - W (2-0)
"""
        row = output_row_with_core_debug(
            data="14/07/2026",
            odd_ofertada=1.95,
            probabilidade_final=55.0,
            dados_tecnicos=technical,
            contexto_modelo=technical,
        )

        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())

        self.assertIsNone(discarded)
        self.assertEqual(selected["dados_tecnicos"], technical.strip())
        self.assertNotIn("modelo_versao=", selected["dados_tecnicos"])
        self.assertIn("[RESUMO MATEMATICO DO MODELO]", selected["contexto_modelo"])
        self.assertIn("idade: 45 dias", selected["contexto_modelo"])
        self.assertIn("STALE_TECHNICAL_DATA_30D", selected["contexto_modelo"])

    def test_total_uses_exact_line_pair_without_market_blending(self):
        row = output_row(
            mercado="Total de Gols",
            pick="Over 2.5 gols",
            linha=2.5,
            odd_ofertada=1.95,
            probabilidade_final=60.0,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertNotIn("NEUTRAL_FALLBACK_NO_HISTORY", selected["observacoes"])
        self.assertEqual(float(selected["probabilidade_final"]), 60.0)

    def test_total_uses_median_odd_for_market_probability_and_best_odd_for_ev(self):
        row = output_row(
            mercado="Total de Gols",
            pick="Over 2.5 gols",
            linha=2.5,
            odd_ofertada=2.00,
            probabilidade_final=65.0,
        )
        wide = wide_row(
            odds_OverUnder_Full_Time_2_5_Over=2.00,
            odds_OverUnder_Full_Time_2_5_Under=2.10,
            odds_OverUnder_Full_Time_2_5_Over_MEDIANA=1.70,
            odds_OverUnder_Full_Time_2_5_Under_MEDIANA=2.20,
            odds_OverUnder_Full_Time_2_5_Over_BOOKMAKER_MELHOR="BestBook",
        )

        selected, discarded = runner._evaluate_row_v1_1(row, wide)
        expected_prob, _ = runner.no_vig_probability_pair(1.70, 2.20)

        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["odd_ofertada"], 2.00)
        self.assertEqual(selected["odd_melhor"], 2.00)
        self.assertEqual(selected["odd_mediana"], 1.70)
        self.assertEqual(selected["odd_mercado_base"], 1.70)
        self.assertEqual(selected["bookmaker_melhor"], "BestBook")
        self.assertIn(f"prob_no_vig={expected_prob:.4f}", selected["observacoes"])
        self.assertIn("odd_mercado_base=1.7", selected["observacoes"])

    def test_btts_probability_is_not_blended_with_market(self):
        row = output_row(
            mercado="Ambas Marcam",
            pick="Ambas Marcam - Sim",
            odd_ofertada=1.95,
            probabilidade_final=65.0,
        )
        selected, discarded = runner._evaluate_row_v1_1(
            row,
            wide_row(
                odds_Both_teams_to_score_Full_Time_YES=1.60,
                odds_Both_teams_to_score_Full_Time_NO=2.40,
            ),
        )
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["probabilidade_final"], 65.0)
        self.assertIn("prob_no_vig=0.6", selected["observacoes"])

    def test_total_quarter_line_is_rejected(self):
        row = output_row(mercado="Total de Gols", pick="Over 2.25 gols", linha=2.25)
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "UNSUPPORTED_TOTAL_LINE")

    def test_double_chance_high_probability_gets_warning_not_blind_cap(self):
        row = output_row(
            mercado="Dupla Chance",
            pick="1X",
            odd_ofertada=1.90,
            probabilidade_final=85.0,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertIn("HIGH_PROBABILITY_REVIEW_FOOTBALL_V1_1", selected["observacoes"])

    def test_low_sample_high_probability_is_blocked_for_review(self):
        row = output_row_with_core_debug(
            mercado="Total de Gols",
            pick="Under 2.5 gols",
            linha=2.5,
            odd_ofertada=1.60,
            probabilidade_final=72.0,
        )
        row["observacoes"] = row["observacoes"].replace("sample_home=24", "sample_home=8")

        selected, discarded = runner._evaluate_row_v1_1(
            row,
            wide_row(
                odds_OverUnder_Full_Time_2_5_Over=3.60,
                odds_OverUnder_Full_Time_2_5_Under=1.40,
            ),
        )

        self.assertIsNone(selected)
        self.assertEqual(
            discarded["motivo_descarte_v1_1"],
            "LOW_SAMPLE_HIGH_PROBABILITY_REVIEW_REQUIRED",
        )

    def test_inconsistent_double_chance_is_blocked(self):
        row = output_row(
            mercado="Dupla Chance",
            pick="12",
            odd_ofertada=1.78,
            probabilidade_final=77.83,
        )
        wide = wide_row(
            odds_Double_chance_Full_Time_12=1.78,
            odds_1X2_Full_Time_X=3.30,
        )

        selected, discarded = runner._evaluate_row_v1_1(row, wide)

        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "INCONSISTENT_DOUBLE_CHANCE_ODDS")
        self.assertIn("complement_implied_sum=", discarded["debug_v1_1"])

    def test_handicap_plus_half_with_pair_is_supported(self):
        row = output_row(
            mercado="Handicap Asiatico",
            pick="Home FC +0.5",
            linha=0.5,
            odd_ofertada=1.95,
            probabilidade_final=68.0,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertIn("HANDICAP_ASIAN_FULL_SETTLEMENT", selected["observacoes"])
        self.assertIn("edge_formula=prob_win*(odd-1)-prob_loss", selected["observacoes"])

    def test_handicap_minus_half_with_pair_is_supported(self):
        row = output_row(
            mercado="Handicap Asiatico",
            pick="Home FC -0.5",
            linha=-0.5,
            odd_ofertada=1.95,
            probabilidade_final=68.0,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)

    def test_handicap_zero_uses_push_probability(self):
        row = output_row(
            mercado="Handicap Asiatico", pick="Home FC 0", linha=0.0,
            odd_ofertada=2.00, probabilidade_final=55.56,
            prob_win=0.50, prob_push=0.10, prob_loss=0.40,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertAlmostEqual(selected["edge"], 10.0, places=2)

    def test_handicap_plus_one_is_supported(self):
        row = output_row(
            mercado="Handicap Asiatico", pick="Home FC +1.0", linha=1.0,
            odd_ofertada=2.00, probabilidade_final=55.56,
            prob_win=0.50, prob_push=0.10, prob_loss=0.40,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)

    def test_handicap_minus_one_requires_matching_market_pair(self):
        row = output_row(mercado="Handicap Asiatico", pick="Home FC -1.0", linha=-1.0)
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "HANDICAP_NO_PAIRED_ODDS")

    def test_handicap_quarter_line_is_supported_with_half_settlement(self):
        row = output_row(
            mercado="Handicap Asiatico", pick="Home FC +0.25", linha=0.25,
            odd_ofertada=2.00, probabilidade_final=56.25,
            prob_win=0.45, prob_push=0.20, prob_loss=0.35,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertAlmostEqual(selected["edge"], 10.0, places=2)

    def test_european_handicap_is_not_treated_as_asian(self):
        row = output_row(mercado="Handicap Europeu 3 vias", pick="Home FC +1", linha=1.0)
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "HANDICAP_EUROPEAN_BLOCKED_FOOTBALL_V1_1")

    def test_handicap_without_paired_odds_is_discarded(self):
        row = output_row(mercado="Handicap Asiatico", pick="Home FC +1.5", linha=1.5)
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row(
            odds_Asian_handicap_Full_Time_Linha1_Opp_Odd=None
        ))
        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "HANDICAP_NO_PAIRED_ODDS")

    def test_handicap_pair_is_found_beyond_legacy_slot_nineteen(self):
        row = output_row(
            mercado="Handicap Asiatico", pick="Away FC +2.5", linha=2.5,
            odd_ofertada=1.40, probabilidade_final=74.0,
        )
        wide = wide_row(
            odds_Asian_handicap_Full_Time_Linha26_HANDICAP=-2.5,
            odds_Asian_handicap_Full_Time_Linha26_1=3.50,
            odds_Asian_handicap_Full_Time_Linha26_1_MEDIANA=3.50,
            odds_Asian_handicap_Full_Time_Linha26_Opp_HANDICAP=2.5,
            odds_Asian_handicap_Full_Time_Linha26_Opp_Odd=1.40,
            odds_Asian_handicap_Full_Time_Linha26_Opp_Odd_MEDIANA=1.40,
        )

        selected, discarded = runner._evaluate_row_v1_1(row, wide)

        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["odd_mediana"], 1.40)

    def test_market_divergence_between_twelve_and_fifteen_points_gets_haircut(self):
        row = output_row(
            mercado="Total de Gols", pick="Over 2.5 gols", linha=2.5,
            odd_ofertada=1.80, probabilidade_final=63.0,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())

        self.assertIsNone(discarded)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["market_conflict_status"], "DIVERGENTE_COM_HAIRCUT")
        self.assertAlmostEqual(selected["probabilidade_final"], 59.75, places=2)
        self.assertIn("haircut_pp=3.25", selected["observacoes"])

    def test_market_divergence_above_fifteen_points_requires_review(self):
        row = output_row(
            mercado="Total de Gols", pick="Over 2.5 gols", linha=2.5,
            odd_ofertada=1.80, probabilidade_final=68.0,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())

        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "MARKET_CONFLICT_REVIEW_REQUIRED")

    def test_market_divergence_above_twenty_points_is_strong_conflict(self):
        row = output_row(
            mercado="Total de Gols", pick="Over 2.5 gols", linha=2.5,
            odd_ofertada=1.80, probabilidade_final=71.0,
        )
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())

        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "CONFLITO_FORTE_COM_MERCADO")

    def test_handicap_ev_with_push_uses_net_return_formula(self):
        ev = runner.calculate_handicap_ev(prob_win=0.45, prob_push=0.10, offered_odd=2.10)
        expected = 0.45 * (2.10 - 1.0) - 0.45
        self.assertAlmostEqual(ev, expected)

    def test_handicap_outcome_handles_push(self):
        self.assertEqual(runner.handicap_outcome(goal_diff=-1, handicap=1.0), "push")
        self.assertEqual(runner.handicap_outcome(goal_diff=0, handicap=0.5), "win")
        self.assertEqual(runner.handicap_outcome(goal_diff=0, handicap=-0.5), "loss")

    def test_invalid_odds_do_not_create_artificial_edge(self):
        row = output_row(odd_ofertada="")
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "INVALID_ODDS")

    def test_edge_below_minimum_is_discarded(self):
        row = output_row(odd_ofertada=1.30, probabilidade_final=55.0)
        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())
        self.assertIsNone(selected)
        self.assertIn(discarded["motivo_descarte_v1_1"], {
            "EDGE_BELOW_MINIMUM_FOOTBALL_V1_1",
            "NEGATIVE_EDGE_AFTER_V1_1",
        })

    def test_score_matrix_sums_and_tail_is_controlled(self):
        matrix = runner.build_score_matrix(1.4, 1.1)
        self.assertAlmostEqual(matrix["probability_sum"], 1.0, places=9)
        self.assertLessEqual(matrix["tail_mass"], runner.SCORE_MATRIX_TAIL_LIMIT)

    def test_score_matrix_over_under_lines_are_distinct_and_complementary(self):
        matrix = runner.build_score_matrix(1.6, 1.2)
        probs_05 = runner.score_matrix_probabilities(matrix, line=0.5)
        probs_25 = runner.score_matrix_probabilities(matrix, line=2.5)
        self.assertNotAlmostEqual(probs_05["over"], probs_25["over"])
        self.assertAlmostEqual(probs_25["over"] + probs_25["under"], 1.0, places=9)

    def test_score_matrix_1x2_and_double_chance_consistency(self):
        matrix = runner.build_score_matrix(1.3, 1.3)
        probs = runner.score_matrix_probabilities(matrix, line=2.5)
        self.assertAlmostEqual(probs["home"] + probs["draw"] + probs["away"], 1.0, places=9)
        self.assertAlmostEqual(probs["double_chance_1x"], probs["home"] + probs["draw"], places=9)
        self.assertAlmostEqual(probs["double_chance_x2"], probs["draw"] + probs["away"], places=9)
        self.assertAlmostEqual(probs["double_chance_12"], probs["home"] + probs["away"], places=9)

    def test_score_matrix_btts_is_complementary(self):
        matrix = runner.build_score_matrix(1.5, 1.2)
        probs = runner.score_matrix_probabilities(matrix, line=2.5)
        self.assertAlmostEqual(probs["btts_yes"] + probs["btts_no"], 1.0, places=9)

    def test_score_matrix_handicap_half_line(self):
        matrix = runner.build_score_matrix(1.5, 1.0)
        home_minus_half = runner.score_matrix_handicap_probability(matrix, "home", -0.5)
        home_plus_half = runner.score_matrix_handicap_probability(matrix, "home", 0.5)
        self.assertGreater(home_plus_half["prob_win"], home_minus_half["prob_win"])
        self.assertAlmostEqual(home_minus_half["prob_push"], 0.0, places=9)

    def test_shrink_value_moves_low_sample_toward_prior(self):
        shrunk = runner.shrink_value(observed=2.5, sample=2, prior=1.2, k=10)
        self.assertLess(shrunk, 2.5)
        self.assertGreater(shrunk, 1.2)

    def test_sample_below_fifteen_gets_low_sample_warning(self):
        row = output_row_with_core_debug()
        row["observacoes"] = row["observacoes"].replace("sample_home=24", "sample_home=11")

        selected, discarded = runner._evaluate_row_v1_1(row, wide_row())

        self.assertIsNone(discarded)
        self.assertIn("warnings=LOW_SAMPLE", selected["observacoes"])

    def test_poisson_overdispersion_requires_higher_edge(self):
        row = output_row_with_core_debug(
            mercado="Total de Gols",
            pick="Over 2.5 gols",
            linha=2.5,
            odd_ofertada=1.60,
            probabilidade_final=65.0,
        )
        row["observacoes"] = row["observacoes"].replace(
            "overdispersion_ratio=1.2200",
            "overdispersion_ratio=1.4700",
        )

        selected, discarded = runner._evaluate_row_v1_1(
            row,
            wide_row(
                odds_OverUnder_Full_Time_2_5_Over=1.50,
                odds_OverUnder_Full_Time_2_5_Under=2.25,
            ),
        )

        self.assertIsNone(selected)
        self.assertEqual(discarded["motivo_descarte_v1_1"], "OVERDISPERSION_REQUIRES_HIGHER_EDGE")

    def test_operational_controls_keep_best_equivalent_market(self):
        rows = pd.DataFrame([
            output_row(
                jogo_id="game-1", mercado="Dupla Chance", pick="1X",
                odd_ofertada=1.35, probabilidade_final=80.0, edge=8.0,
            ).to_dict(),
            output_row(
                jogo_id="game-1", mercado="Handicap Asiatico", pick="Home FC +0.5", linha=0.5,
                odd_ofertada=1.33, probabilidade_final=80.0, edge=6.4,
            ).to_dict(),
        ])

        selected, discarded = runner._apply_operational_controls(rows)

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected.iloc[0]["pick"], "1X")
        self.assertEqual(discarded.iloc[0]["motivo_descarte_v1_1"], "DUPLICATE_EQUIVALENT_MARKET")

    def test_operational_controls_keep_one_nested_total_direction(self):
        rows = pd.DataFrame([
            output_row(
                jogo_id="game-2", mercado="Total de Gols", pick="Under 2.5 gols", linha=2.5,
                odd_ofertada=2.00, probabilidade_final=56.76, edge=13.52,
            ).to_dict(),
            output_row(
                jogo_id="game-2", mercado="Total de Gols", pick="Under 3.5 gols", linha=3.5,
                odd_ofertada=1.38, probabilidade_final=75.88, edge=4.71,
            ).to_dict(),
        ])

        selected, discarded = runner._apply_operational_controls(rows)

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected.iloc[0]["pick"], "Under 2.5 gols")
        self.assertEqual(discarded.iloc[0]["motivo_descarte_v1_1"], "CORRELATED_NESTED_TOTAL_LINE")

    def test_operational_controls_limit_match_to_two_selections(self):
        rows = pd.DataFrame([
            output_row(
                jogo_id="game-3", mercado="Resultado Final", pick="Home FC para vencer",
                edge=12.0, probabilidade_final=60.0,
            ).to_dict(),
            output_row(
                jogo_id="game-3", mercado="Total de Gols", pick="Over 2.5 gols", linha=2.5,
                edge=10.0, probabilidade_final=65.0,
            ).to_dict(),
            output_row(
                jogo_id="game-3", mercado="Ambas Marcam", pick="Ambas Marcam - Sim",
                edge=4.0, probabilidade_final=55.0,
            ).to_dict(),
        ])

        selected, discarded = runner._apply_operational_controls(rows)

        self.assertEqual(len(selected), 2)
        self.assertEqual(discarded.iloc[0]["motivo_descarte_v1_1"], "MATCH_SELECTION_LIMIT")
        self.assertEqual(set(selected["selection_role"]), {"PRINCIPAL", "ALTERNATIVA"})

    def test_adapter_skips_market_row_marked_inconsistent(self):
        base = {
            "data": "10/07/2026", "hora": "13:00", "esporte": "Football",
            "liga": "Finland - Veikkausliiga", "country": "Finland",
            "jogo": "VPS vs SJK", "mandante": "VPS", "visitante": "SJK",
            "linha": "", "bookmaker": "book", "fonte": "OddsAgora",
        }
        rows = [
            {**base, "mercado": "1X2", "pick": "VPS", "odd": 2.00},
            {
                **base, "mercado": "Dupla Chance", "pick": "12", "odd": 1.78,
                "odds_consistency_status": "invalid",
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "coleta.csv"
            wide_path = Path(tmp) / "wide.csv"
            pd.DataFrame(rows).to_csv(csv_path, index=False)
            wide = football_adapter.converter_csv_longo_para_wide(csv_path, wide_path)

        self.assertNotIn("odds_Double_chance_Full_Time_12", wide.columns)
        self.assertIn("Odd bloqueada por incoerencia de mercado", wide.iloc[0]["adapter_warnings"])

    def test_adapter_maps_real_csv_asian_handicap_pairs(self):
        csv_path = Path(
            os.environ.get(
                "FOOTBALL_TEST_CSV",
                r"C:\Users\diass\Downloads\coleta_odds_normalizado (3).csv",
            )
        )
        if not csv_path.exists():
            self.skipTest("CSV real de futebol nao encontrado.")
        with tempfile.TemporaryDirectory() as tmp:
            wide_path = Path(tmp) / "wide.csv"
            wide = football_adapter.converter_csv_longo_para_wide(csv_path, wide_path)
        handicap_cols = [c for c in wide.columns if "Asian_handicap" in c]
        self.assertTrue(handicap_cols)
        self.assertIn("odds_Asian_handicap_Full_Time_Linha1_HANDICAP", wide.columns)
        self.assertIn("odds_Asian_handicap_Full_Time_Linha1_Opp_HANDICAP", wide.columns)
        first = wide.dropna(subset=["odds_Asian_handicap_Full_Time_Linha1_HANDICAP"]).iloc[0]
        self.assertAlmostEqual(
            float(first["odds_Asian_handicap_Full_Time_Linha1_HANDICAP"]),
            -float(first["odds_Asian_handicap_Full_Time_Linha1_Opp_HANDICAP"]),
        )

    def test_adapter_preserves_country_for_ambiguous_super_league(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "coleta.csv"
            wide_path = Path(tmp) / "wide.csv"
            pd.DataFrame([
                {
                    "data": "27.06.2026",
                    "hora": "08:00",
                    "esporte": "Football",
                    "liga": "China - Super League",
                    "country": "China",
                    "jogo": "Liaoning Tieren vs Shandong Taishan",
                    "mandante": "Liaoning Tieren",
                    "visitante": "Shandong Taishan",
                    "mercado": "1X2",
                    "pick": "Liaoning Tieren",
                    "linha": "",
                    "odd": 2.80,
                    "bookmaker": "betano.br",
                    "fonte": "FlashScore",
                },
            ]).to_csv(csv_path, index=False)

            wide = football_adapter.converter_csv_longo_para_wide(csv_path, wide_path)

        self.assertEqual(wide.iloc[0]["country"], "China")
        self.assertEqual(wide.iloc[0]["league"], "Super League")

    def test_adapter_preserves_integer_and_quarter_asian_lines(self):
        base = {
            "data": "09/07/2026", "hora": "19:00", "esporte": "Football",
            "liga": "Brazil - Serie A", "country": "Brazil",
            "jogo": "Home FC vs Away FC", "mandante": "Home FC", "visitante": "Away FC",
            "mercado": "Handicap Asiatico", "bookmaker": "book", "fonte": "source",
        }
        rows = []
        for line in (0.0, 0.25):
            rows.extend([
                {**base, "pick": "Home FC", "linha": line, "odd": 1.95},
                {**base, "pick": "Away FC", "linha": -line, "odd": 1.95},
            ])
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "coleta.csv"
            wide_path = Path(tmp) / "wide.csv"
            pd.DataFrame(rows).to_csv(csv_path, index=False)
            wide = football_adapter.converter_csv_longo_para_wide(csv_path, wide_path)
        home_lines = {
            float(value)
            for column, value in wide.iloc[0].items()
            if column.endswith("_HANDICAP") and pd.notna(value)
        }
        self.assertIn(0.0, home_lines)
        self.assertIn(0.25, home_lines)

    def test_adapter_pairs_opposite_handicap_lines_not_same_signed_lines(self):
        base = {
            "data": "11/07/2026", "hora": "12:30", "esporte": "Football",
            "liga": "Sweden - Allsvenskan", "country": "Sweden",
            "jogo": "Orgryte vs Hacken", "mandante": "Orgryte", "visitante": "Hacken",
            "mercado": "Handicap Asiatico", "bookmaker": "book", "fonte": "source",
        }
        rows = [
            {**base, "pick": "Orgryte +1.5", "linha": 1.5, "odd": 1.58, "odd_mediana": 1.55},
            {**base, "pick": "Hacken -1.5", "linha": -1.5, "odd": 2.37, "odd_mediana": 2.28},
            {**base, "pick": "Orgryte -1.5", "linha": -1.5, "odd": 9.40, "odd_mediana": 9.40},
            {**base, "pick": "Hacken +1.5", "linha": 1.5, "odd": 1.01, "odd_mediana": 1.01},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "coleta.csv"
            wide_path = Path(tmp) / "wide.csv"
            pd.DataFrame(rows).to_csv(csv_path, index=False)
            wide = football_adapter.converter_csv_longo_para_wide(csv_path, wide_path)

        converted = wide.iloc[0]
        self.assertEqual(float(converted["odds_Asian_handicap_Full_Time_Linha1_HANDICAP"]), 1.5)
        self.assertEqual(float(converted["odds_Asian_handicap_Full_Time_Linha1_Opp_HANDICAP"]), -1.5)
        self.assertEqual(float(converted["odds_Asian_handicap_Full_Time_Linha1_Opp_Odd_MEDIANA"]), 2.28)

    def test_adapter_deduplicates_repeated_handicap_lines(self):
        base = {
            "data": "14/07/2026", "hora": "08:35", "esporte": "Football",
            "liga": "China - Super League", "country": "China",
            "jogo": "Home FC vs Away FC", "mandante": "Home FC", "visitante": "Away FC",
            "mercado": "Handicap Asiatico", "bookmaker": "book", "fonte": "source",
        }
        rows = []
        for _ in range(6):
            rows.extend([
                {**base, "pick": "Home FC -1.5", "linha": -1.5, "odd": 2.13, "odd_mediana": 2.05},
                {**base, "pick": "Away FC +1.5", "linha": 1.5, "odd": 1.72, "odd_mediana": 1.63},
            ])
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "coleta.csv"
            wide_path = Path(tmp) / "wide.csv"
            pd.DataFrame(rows).to_csv(csv_path, index=False)
            wide = football_adapter.converter_csv_longo_para_wide(csv_path, wide_path)

        pair_columns = [
            column
            for column in wide.columns
            if column.endswith("_HANDICAP") and "_Opp_" not in column
        ]
        self.assertEqual(pair_columns, ["odds_Asian_handicap_Full_Time_Linha1_HANDICAP"])
        self.assertIn("Handicaps duplicados consolidados", wide.iloc[0]["adapter_warnings"])

    def test_adapter_preserves_median_and_best_odds_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "coleta.csv"
            wide_path = Path(tmp) / "wide.csv"
            pd.DataFrame([
                {
                    "data": "27.06.2026",
                    "hora": "08:00",
                    "esporte": "Football",
                    "liga": "Brazil - Serie A",
                    "country": "Brazil",
                    "jogo": "Home FC vs Away FC",
                    "mandante": "Home FC",
                    "visitante": "Away FC",
                    "mercado": "1X2",
                    "pick": "Home FC",
                    "linha": "",
                    "odd": 2.00,
                    "odd_melhor": 2.10,
                    "odd_mediana": 1.95,
                    "bookmaker": "book-a",
                    "bookmaker_melhor": "book-best",
                    "fonte": "OddsAgora",
                },
            ]).to_csv(csv_path, index=False)

            wide = football_adapter.converter_csv_longo_para_wide(csv_path, wide_path)

        self.assertEqual(float(wide.iloc[0]["odds_1X2_Full_Time_1"]), 2.10)
        self.assertEqual(float(wide.iloc[0]["odds_1X2_Full_Time_1_MEDIANA"]), 1.95)
        self.assertEqual(wide.iloc[0]["odds_1X2_Full_Time_1_BOOKMAKER_MELHOR"], "book-best")

    def test_output_keeps_app_columns_and_no_stake_is_added(self):
        selected_df, discarded_df = runner.aplicar_controles_football_v1_1(
            pd.DataFrame([output_row().to_dict()]),
            pd.DataFrame([wide_row().to_dict()]),
        )
        self.assertTrue(discarded_df.empty)
        for column in [
            "data",
            "hora",
            "esporte",
            "liga",
            "jogo",
            "mandante",
            "visitante",
            "mercado",
            "pick",
            "linha",
            "odd_ofertada",
            "odd_mediana",
            "odd_mercado_base",
            "odd_melhor",
            "bookmaker_melhor",
            "odd_valor",
            "probabilidade_final",
            "edge",
            "observacoes",
        ]:
            self.assertIn(column, selected_df.columns)
        self.assertNotIn("stake", selected_df.columns)
        self.assertNotIn("stake_sugerida", selected_df.columns)


if __name__ == "__main__":
    unittest.main()
