from __future__ import annotations

import unittest

from api.scraping_params import (
    DEFAULT_FLASHSCORE_BASEBALL_MARKETS,
    DEFAULT_ODDSAGORA_BASEBALL_MARKETS,
    DEFAULT_ODDSAGORA_FOOTBALL_MARKETS,
    DEFAULT_ODDSAGORA_HOCKEY_MARKETS,
    ODDSAGORA_MLB_URL,
    normalize_scraping_params,
)


class ScrapingParamsTests(unittest.TestCase):
    def test_baseball_empty_markets_uses_default_oddsagora_markets(self) -> None:
        params = normalize_scraping_params(
            {
                "esporte": "Baseball",
                "leagues": ["https://www.flashscore.com/baseball/usa/mlb/fixtures/"],
                "mercados": [],
            }
        )

        self.assertEqual(params["source"], "OddsAgora")
        self.assertEqual(params["mercados"], DEFAULT_ODDSAGORA_BASEBALL_MARKETS)
        self.assertTrue(params["mercados_padrao_aplicados"])
        self.assertEqual(params["leagues"], [ODDSAGORA_MLB_URL])

    def test_baseball_flashscore_source_keeps_flashscore_defaults(self) -> None:
        params = normalize_scraping_params({"esporte": "Baseball", "source": "FlashScore", "mercados": []})

        self.assertEqual(params["source"], "FlashScore")
        self.assertEqual(params["mercados"], DEFAULT_FLASHSCORE_BASEBALL_MARKETS)

    def test_non_empty_markets_are_preserved(self) -> None:
        params = normalize_scraping_params({"esporte": "Baseball", "mercados": ["home-away"]})

        self.assertEqual(params["mercados"], ["home-away"])
        self.assertFalse(params["mercados_padrao_aplicados"])

    def test_football_empty_markets_uses_default_oddsagora_markets_and_leagues(self) -> None:
        params = normalize_scraping_params({"esporte": "Football", "mercados": []})

        self.assertEqual(params["source"], "OddsAgora")
        self.assertEqual(params["mercados"], DEFAULT_ODDSAGORA_FOOTBALL_MARKETS)
        self.assertTrue(params["mercados_padrao_aplicados"])
        self.assertIn("https://www.oddsagora.com.br/football/brazil/brasileirao-betano", params["leagues"])

    def test_hockey_empty_markets_uses_hockey_oddsagora_markets(self) -> None:
        params = normalize_scraping_params({"esporte": "Hockey", "mercados": []})

        self.assertEqual(params["source"], "OddsAgora")
        self.assertEqual(params["mercados"], DEFAULT_ODDSAGORA_HOCKEY_MARKETS)
        self.assertEqual(params["leagues"], ["https://www.oddsagora.com.br/hockey/usa/nhl/"])

    def test_unknown_sport_empty_markets_are_not_defaulted(self) -> None:
        params = normalize_scraping_params({"esporte": "Tennis", "mercados": []})

        self.assertEqual(params["mercados"], [])
        self.assertFalse(params["mercados_padrao_aplicados"])
