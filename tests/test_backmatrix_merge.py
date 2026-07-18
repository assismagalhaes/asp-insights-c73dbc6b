import unittest

import pandas as pd

from modelos.backmatrix_runner_real import merge_windows


class BackMatrixMergeTests(unittest.TestCase):
    def test_same_match_in_different_leagues_does_not_break_one_to_one_merge(self):
        timestamp = pd.Timestamp("2026-07-18 11:00:00")
        recent = pd.DataFrame(
            [
                {
                    "Liga": "Club Friendlies 3",
                    "Data/Hora": timestamp,
                    "Time Casa": "Southport",
                    "Time Visitante": "Fleetwood Town",
                    "Amostra": 10,
                }
            ]
        )
        venue = pd.DataFrame(
            [
                {
                    "Liga": "Club Friendlies 3",
                    "Data/Hora": timestamp,
                    "Time Casa": "Southport",
                    "Time Visitante": "Fleetwood Town",
                    "Amostra": 20,
                },
                {
                    "Liga": "Club Friendlies 4",
                    "Data/Hora": timestamp,
                    "Time Casa": "Southport",
                    "Time Visitante": "Fleetwood Town",
                    "Amostra": 20,
                },
            ]
        )

        merged = merge_windows(recent, venue)

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged.iloc[0]["Liga"], "Club Friendlies 3")
        self.assertEqual(merged.iloc[0]["Liga_10"], "Club Friendlies 3")
        self.assertEqual(merged.iloc[0]["Liga_20"], "Club Friendlies 3")
        self.assertEqual(merged.iloc[0]["Amostra_10"], 10)
        self.assertEqual(merged.iloc[0]["Amostra_20"], 20)


if __name__ == "__main__":
    unittest.main()
