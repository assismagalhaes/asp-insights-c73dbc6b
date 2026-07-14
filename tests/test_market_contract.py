import unittest

from modelos.market_contract import standardize_prediction


class MarketContractTests(unittest.TestCase):
    def assert_contract(self, model, row, expected_market, expected_pick):
        result = standardize_prediction(row, model)
        self.assertEqual(result["mercado"], expected_market)
        self.assertEqual(result["pick"], expected_pick)
        self.assertNotIn("linha", result)

    def test_matchmatrix_markets(self):
        base = {"esporte": "Futebol", "mandante": "A", "visitante": "B"}
        cases = [
            ({"mercado": "Resultado Final", "pick": "A para vencer"}, "Moneyline", "Moneyline Casa"),
            ({"mercado": "Dupla Chance", "pick": "X2"}, "Dupla Chance", "X2"),
            ({"mercado": "Total de Gols", "pick": "Over", "linha": 2.5}, "Over Gols", "Over 2.5"),
            ({"mercado": "Ambas Marcam", "pick": "Ambas Marcam - Não"}, "Ambas Marcam Não", "BTTS Não"),
            ({"mercado": "Handicap Asiático", "pick": "B", "linha": 1.5}, "Handicap Asiático", "HA Visitante +1.5"),
        ]
        for row, market, pick in cases:
            with self.subTest(market=market, pick=pick):
                self.assert_contract("ASP MatchMatrix", {**base, **row}, market, pick)

    def test_goalmatrix_markets(self):
        self.assert_contract(
            "ASP GoalMatrix",
            {"mercado": "ASP GoalMatrix", "pick": "Under", "linha": 3.5, "market_type": "OU"},
            "Under Gols",
            "Under 3.5",
        )
        self.assert_contract(
            "ASP GoalMatrix",
            {"mercado": "ASP GoalMatrix", "pick": "BTTS Sim", "market_type": "BTTS"},
            "Ambas Marcam Sim",
            "BTTS Sim",
        )

    def test_cornermatrix_markets(self):
        cases = [
            ({"mercado": "ASP CornerMatrix", "pick": "Over", "linha": 8.5}, "Over Cantos", "Over 8.5"),
            ({"mercado": "Race Cantos", "pick": "Casa Race 3 Cantos", "linha": 3}, "Race Cantos", "Race 3 Cantos Casa"),
            ({"mercado": "Mais Cantos", "pick": "Visitante"}, "Mais Cantos", "Mais Cantos Visitante"),
        ]
        for row, market, pick in cases:
            with self.subTest(market=market, pick=pick):
                self.assert_contract("ASP CornerMatrix", row, market, pick)

    def test_diamond_and_court_markets(self):
        self.assert_contract(
            "ASP Diamond",
            {"mercado": "Total de Corridas", "pick": "Over 5.5", "linha": 5.5},
            "Over Corridas",
            "Over 5.5",
        )
        self.assert_contract(
            "ASP Court W",
            {"mercado": "Handicap Asiático", "pick": "Phoenix Mercury W", "linha": -5.5, "visitante": "Phoenix Mercury W"},
            "Handicap Asiático",
            "HA Visitante -5.5",
        )


if __name__ == "__main__":
    unittest.main()
