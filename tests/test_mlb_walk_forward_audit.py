from __future__ import annotations

import unittest

from modelos.audit_mlb_v1_1_comparison import (
    build_oos_calibration_candidate,
    materialize_handicap_shadow_rows,
)


class MlbWalkForwardAuditTests(unittest.TestCase):
    def test_materializes_only_qualified_handicap_shadow_rows(self) -> None:
        game = {
            "data": "2026-07-10",
            "hora": "20:00",
            "liga": "MLB",
            "jogo": "New York Yankees vs Boston Red Sox",
            "home": "New York Yankees",
            "away": "Boston Red Sox",
        }
        result = {
            "home": "New York Yankees",
            "away": "Boston Red Sox",
            "home_runs": 5,
            "away_runs": 4,
        }
        rows = [
            {
                "motivo_descarte": "HANDICAP_SHADOW_ONLY",
                "pick": "Boston Red Sox +1.5",
                "linha": 1.5,
                "odd_melhor": 1.80,
                "prob_final": 0.61,
                "edge": 9.8,
                "score_distribution": "Negative Binomial",
                "runs_overdispersion": 0.08,
            },
            {"motivo_descarte": "HANDICAP_EDGE_BELOW_MIN", "pick": "New York Yankees -1.5"},
        ]

        materialized = materialize_handicap_shadow_rows(rows, game, result)

        self.assertEqual(len(materialized), 1)
        self.assertEqual(materialized[0]["resultado_real"], "GREEN")
        self.assertEqual(materialized[0]["modelo_versao"], "MLB_V2_1_HANDICAP_NB_SHADOW")
        self.assertEqual(materialized[0]["score_distribution"], "Negative Binomial")

    def test_calibration_stays_inactive_without_minimum_temporal_sample(self) -> None:
        rows = [
            {
                "data": f"2026-06-{(index % 28) + 1:02d}",
                "jogo": f"Jogo {index}",
                "mercado": "Total de Corridas",
                "probabilidade_v2": 0.60,
                "resultado_real": "GREEN" if index % 2 == 0 else "RED",
            }
            for index in range(80)
        ]

        calibration = build_oos_calibration_candidate(rows)

        self.assertFalse(calibration["totals"]["active"])
        self.assertEqual(calibration["totals"]["sample_size"], 80)
        self.assertEqual(calibration["totals"]["status"], "insufficient_walk_forward_sample")
        self.assertFalse(calibration["handicap"]["active"])
        self.assertEqual(calibration["handicap"]["status"], "operationally_disabled")


if __name__ == "__main__":
    unittest.main()
