from __future__ import annotations

import unittest

from api.scraping_params import DEFAULT_BASEBALL_MARKETS, normalize_scraping_params


class ScrapingParamsTests(unittest.TestCase):
    def test_baseball_empty_markets_uses_default_flashscore_markets(self) -> None:
        params = normalize_scraping_params(
            {
                "esporte": "Baseball",
                "leagues": ["https://www.flashscore.com/baseball/usa/mlb/fixtures/"],
                "mercados": [],
            }
        )

        self.assertEqual(params["mercados"], DEFAULT_BASEBALL_MARKETS)
        self.assertTrue(params["mercados_padrao_aplicados"])
        self.assertEqual(params["leagues"], ["https://www.flashscore.com/baseball/usa/mlb/fixtures/"])

    def test_non_empty_markets_are_preserved(self) -> None:
        params = normalize_scraping_params({"esporte": "Baseball", "mercados": ["home-away"]})

        self.assertEqual(params["mercados"], ["home-away"])
        self.assertFalse(params["mercados_padrao_aplicados"])

    def test_non_baseball_empty_markets_are_not_defaulted(self) -> None:
        params = normalize_scraping_params({"esporte": "Football", "mercados": []})

        self.assertEqual(params["mercados"], [])
        self.assertFalse(params["mercados_padrao_aplicados"])
