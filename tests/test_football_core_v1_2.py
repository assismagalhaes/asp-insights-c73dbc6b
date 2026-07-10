import importlib.util
import sys
import types
import unittest
from pathlib import Path

import pandas as pd


MODELOS_DIR = Path(__file__).resolve().parents[1] / "modelos"
if str(MODELOS_DIR) not in sys.path:
    sys.path.insert(0, str(MODELOS_DIR))

if importlib.util.find_spec("requests") is None:
    requests_stub = types.ModuleType("requests")
    requests_stub.Session = object
    sys.modules["requests"] = requests_stub

if importlib.util.find_spec("scipy") is None:
    scipy_stub = types.ModuleType("scipy")
    stats_stub = types.ModuleType("scipy.stats")
    stats_stub.poisson = object()
    stats_stub.nbinom = object()
    scipy_stub.stats = stats_stub
    sys.modules["scipy"] = scipy_stub
    sys.modules["scipy.stats"] = stats_stub

import prognosticos_football_real as core


class FootballCoreV12Test(unittest.TestCase):
    def test_clean_completed_matches_rejects_unplayed_and_deduplicates(self):
        frame = pd.DataFrame([
            {"Date": "2026-07-01", "HomeTeam": "A", "AwayTeam": "B", "FTHG": 2, "FTAG": 1, "FTR": "H", "Season": "2026", "Liga": "L"},
            {"Date": "2026-07-01", "HomeTeam": "A", "AwayTeam": "B", "FTHG": 2, "FTAG": 1, "FTR": "H", "Season": "2026", "Liga": "L"},
            {"Date": "02/07/2026", "HomeTeam": "C", "AwayTeam": "D", "FTHG": 0, "FTAG": 0, "FTR": "D", "Season": "2026", "Liga": "L"},
            {"Date": "03/07/2026", "HomeTeam": "E", "AwayTeam": "F", "FTHG": None, "FTAG": None, "FTR": None, "Season": "2026", "Liga": "L"},
        ])
        cleaned = core.clean_completed_matches(frame)
        self.assertEqual(len(cleaned), 2)
        self.assertEqual(cleaned.iloc[0]["Date"], pd.Timestamp("2026-07-01"))
        self.assertEqual(cleaned.iloc[1]["Date"], pd.Timestamp("2026-07-02"))

    def test_temporal_cut_excludes_the_match_day_without_historical_kickoff_time(self):
        frame = pd.DataFrame({
            "Date": [pd.Timestamp("2026-07-08"), pd.Timestamp("2026-07-09")],
            "value": ["previous", "same_day"],
        })
        filtered = core.filter_matches_before_kickoff(frame, pd.Timestamp("2026-07-09 19:00"))
        self.assertEqual(filtered["value"].tolist(), ["previous"])

    def test_reference_date_rolls_split_season_in_july(self):
        core.configure_reference_date("09/07/2026")
        self.assertEqual(core.SEASON_CTX["ref_date"], pd.Timestamp("2026-07-09").date())
        self.assertIn("2026/2027", core.CURRENT_SEASONS)
        self.assertIn("2025/2026", core.PREVIOUS_SEASONS)

    def test_expected_goals_apply_league_prior_shrinkage(self):
        result = core.estimate_expected_goals(
            gf_home=3.0,
            ga_home=0.5,
            gf_away=2.0,
            ga_away=2.5,
            sample_home=1,
            sample_away=1,
            league_home_goals=1.5,
            league_away_goals=1.2,
        )
        self.assertEqual(result["raw_home"], 2.75)
        self.assertLess(result["lambda_home"], result["raw_home"])
        self.assertGreater(result["lambda_home"], 0)

    def test_team_metrics_apply_exponential_time_decay(self):
        current = pd.DataFrame([
            {"Date": pd.Timestamp("2025-01-01"), "HomeTeam": "A", "AwayTeam": "B", "FTHG": 0, "FTAG": 1, "FTR": "A"},
            {"Date": pd.Timestamp("2026-01-01"), "HomeTeam": "A", "AwayTeam": "C", "FTHG": 4, "FTAG": 1, "FTR": "H"},
        ])
        previous_lines = core.LINHAS_OU
        core.LINHAS_OU = [2.5]
        try:
            stats = core.gerar_estatisticas_comparadas(current, pd.DataFrame(), "home")
        finally:
            core.LINHAS_OU = previous_lines
        self.assertGreater(stats["Gols Marcados (média) (Final)"], 2.0)

    def test_1x2_blend_is_always_normalized(self):
        result = core.combinar_modelo_historico(
            {"Casa": 60, "Empate": 20, "Fora": 60},
            {"Casa": 45, "Empate": 25, "Fora": 30},
            sample=30,
            max_history_weight=0.25,
            calibration_key="1x2",
        )
        self.assertAlmostEqual(sum(result.values()), 100.0, places=3)

    def test_btts_calibration_remains_complementary(self):
        yes, no = core.calibrar_par(63.4, "btts")
        self.assertAlmostEqual(yes + no, 100.0)

    def test_dixon_coles_matrix_is_renormalized(self):
        matrix = pd.DataFrame(
            [[0.20, 0.10, 0.05], [0.15, 0.20, 0.05], [0.05, 0.10, 0.10]],
            index=[0, 1, 2],
            columns=[0, 1, 2],
        )
        adjusted = core.aplicar_dixon_coles(matrix, 1.4, 1.1, -0.08)
        self.assertAlmostEqual(float(adjusted.values.sum()), 1.0)
        self.assertNotEqual(adjusted.loc[0, 0], matrix.loc[0, 0])

    def test_audit_export_keeps_all_1x2_options_before_ev_filter(self):
        result = {
            "Home": "A", "Away": "B", "Date": "2026-07-09", "Kickoff": "19:00", "League": "L",
            "Prob_Casa": 40.0, "OddValor_Casa": 2.5, "OddReal_Casa": 2.0,
            "Prob_Empate": 30.0, "OddValor_Empate": 3.333, "OddReal_Empate": 3.1,
            "Prob_Fora": 30.0, "OddValor_Fora": 3.333, "OddReal_Fora": 3.2,
            "Prob_1X": 70.0, "OddValor_1X": 1.429, "OddReal_1X": 1.3,
            "Prob_12": 70.0, "OddValor_12": 1.429, "OddReal_12": 1.3,
            "Prob_X2": 60.0, "OddValor_X2": 1.667, "OddReal_X2": 1.6,
            "Prob_BTTS_Yes": 50.0, "OddValor_BTTS_Yes": 2.0, "OddReal_BTTS_Yes": 1.9,
            "Prob_BTTS_No": 50.0, "OddValor_BTTS_No": 2.0, "OddReal_BTTS_No": 1.9,
            "OU_Lines": [], "HC_Lines_Casa": [], "HC_Lines_Fora": [],
        }
        rows = core.montar_linhas_lovable(result, ev_only=False)
        one_x_two = [row for row in rows if row["mercado"] == "Resultado Final"]
        self.assertEqual(len(one_x_two), 3)
        self.assertEqual({row["opcao_1x2"] for row in one_x_two}, {"H", "D", "A"})


if __name__ == "__main__":
    unittest.main()
