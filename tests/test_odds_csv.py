import unittest

import pandas as pd

from api.odds_csv import consolidar_csv_odds


class ConsolidarCsvOddsTests(unittest.TestCase):
    def test_keeps_one_best_bookmaker_row_and_consensus_values(self):
        common = {
            "data": "2026-07-18",
            "hora": "08:00",
            "esporte": "Football",
            "liga": "China - Superliga",
            "country": "",
            "jogo": "Casa vs Fora",
            "mandante": "Casa",
            "visitante": "Fora",
            "mercado": "1X2",
            "pick": "Casa",
            "linha": "",
            "fonte": "OddsAgora",
            "odd_media": 2.66900000000003,
            "odd_mediana": 2.63000000000001,
            "odd_minima": 2.62,
            "odd_maxima": 2.85,
            "odd_melhor": 2.85,
            "bookmaker_melhor": "bet365",
            "probabilidade_implicita_media": 0.34263946816893553,
            "margem_mercado_media": 1.0942309601710902,
        }
        frame = pd.DataFrame([
            {**common, "odd": 2.72, "bookmaker": "Outra"},
            {**common, "odd": 2.85, "bookmaker": "bet365"},
        ])

        result = consolidar_csv_odds(frame)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["odd"], 2.85)
        self.assertEqual(result.iloc[0]["odd_mediana"], 2.63)
        self.assertEqual(result.iloc[0]["bookmaker"], "bet365")
        self.assertEqual(result.iloc[0]["margem_mercado_media"], 1.094231)


if __name__ == "__main__":
    unittest.main()
