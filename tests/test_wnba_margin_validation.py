from __future__ import annotations

import unittest

import pandas as pd

from modelos.wnba_margin_validation import build_margin_calibration_payload


class WnbaMarginValidationTests(unittest.TestCase):
    def test_calibration_stays_inactive_without_verified_walk_forward_sample(self) -> None:
        frame = pd.DataFrame([{
            'game_date': '15/07/2026',
            'home': 'MIN',
            'away': 'LAS',
            'snapshot_at_utc': '2026-07-15T12:00:00+00:00',
            'pregame_verified': False,
            'score_margin_pre_strength': 6.0,
            'strength_margin_reference': 8.0,
            'actual_margin': 8.0,
        }])

        result = build_margin_calibration_payload(frame, minimum_games=1)

        self.assertFalse(result['active'])
        self.assertEqual(result['status'], 'insufficient_walk_forward_sample')

    def test_calibration_activates_only_after_temporal_holdout_improves(self) -> None:
        rows = []
        for index in range(120):
            model_margin = float((index % 21) - 10)
            rows.append({
                'game_date': pd.Timestamp('2026-01-01') + pd.Timedelta(days=index),
                'home': f'H{index}',
                'away': f'A{index}',
                'snapshot_at_utc': (pd.Timestamp('2026-01-01', tz='UTC') + pd.Timedelta(days=index)).isoformat(),
                'pregame_verified': True,
                'score_margin_pre_strength': model_margin,
                'strength_margin_reference': model_margin,
                'actual_margin': 2.0 + 1.2 * model_margin,
            })

        result = build_margin_calibration_payload(pd.DataFrame(rows), minimum_games=100)

        self.assertTrue(result['active'])
        self.assertEqual(result['status'], 'active_oos_calibration')
        self.assertAlmostEqual(result['intercept'], 2.0, places=6)
        self.assertAlmostEqual(result['slope'], 1.2, places=6)


if __name__ == '__main__':
    unittest.main()
