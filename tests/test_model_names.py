import unittest

from api.model_names import (
    MODEL_NAME_BASEBALL,
    MODEL_NAME_FOOTBALL,
    basketball_model_name,
)
from modelos import baseball_runner_real, basketball_runner_real


class PredictiveModelNamesTests(unittest.TestCase):
    def test_api_model_names(self) -> None:
        self.assertEqual(MODEL_NAME_FOOTBALL, "ASP MatchMatrix")
        self.assertEqual(MODEL_NAME_BASEBALL, "ASP Diamond")
        self.assertEqual(basketball_model_name("nba"), "ASP Court")
        self.assertEqual(basketball_model_name("WNBA"), "ASP Court W")

    def test_runner_model_names_match_api(self) -> None:
        self.assertEqual(baseball_runner_real.MODEL_NAME, MODEL_NAME_BASEBALL)
        self.assertEqual(basketball_runner_real.model_name("NBA"), "ASP Court")
        self.assertEqual(basketball_runner_real.model_name("WNBA"), "ASP Court W")

    def test_invalid_basketball_league_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            basketball_model_name("NCAA")


if __name__ == "__main__":
    unittest.main()
