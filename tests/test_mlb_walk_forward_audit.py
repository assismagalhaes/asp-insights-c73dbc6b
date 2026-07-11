from __future__ import annotations

import unittest

from modelos.audit_mlb_v1_1_comparison import build_oos_calibration_candidate


class MlbWalkForwardAuditTests(unittest.TestCase):
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
