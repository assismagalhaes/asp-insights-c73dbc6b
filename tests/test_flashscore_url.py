from __future__ import annotations

import unittest

from scrapers.flashscore_url import (
    extract_flashscore_match_id,
    flashscore_market_url,
    normalize_flashscore_url,
)
from scrapers.normalizer import normalize


NEW_HOME_AWAY_URL = (
    "https://www.flashscore.com/match/baseball/arizona-diamondbacks-8bP2bXmH/"
    "san-francisco-giants-bRZ9b6xj/odds/home-away/ft-including-ot/?mid=6wPO81JF"
)


class FlashscoreUrlTests(unittest.TestCase):
    def test_extracts_mid_from_new_flashscore_url(self) -> None:
        self.assertEqual(extract_flashscore_match_id(NEW_HOME_AWAY_URL), "6wPO81JF")

    def test_market_url_preserves_mid_for_same_game(self) -> None:
        asian_url = flashscore_market_url(NEW_HOME_AWAY_URL, "asian-handicap")

        self.assertIn("/odds/asian-handicap/ft-including-ot/", asian_url)
        self.assertEqual(extract_flashscore_match_id(asian_url), "6wPO81JF")

    def test_legacy_url_without_mid_still_uses_path_id(self) -> None:
        old_url = "https://www.flashscore.com/match/6wPO81JF/#/odds-comparison/home-away/full-time"

        self.assertEqual(extract_flashscore_match_id(old_url), "6wPO81JF")

    def test_normalized_url_keeps_mid_and_removes_noise(self) -> None:
        url = f"{NEW_HOME_AWAY_URL}&utm_source=test#section"

        self.assertEqual(
            normalize_flashscore_url(url),
            "https://www.flashscore.com/match/baseball/arizona-diamondbacks-8bP2bXmH/"
            "san-francisco-giants-bRZ9b6xj/odds/home-away/ft-including-ot/?mid=6wPO81JF",
        )

    def test_normalizer_groups_markets_by_mid_in_raw_ref(self) -> None:
        raw = {
            "games": [
                raw_game(NEW_HOME_AWAY_URL, "Home/Away", ["Bookmaker", "1", "2"], ["betano.br", "1.8", "2.0"]),
                raw_game(
                    flashscore_market_url(NEW_HOME_AWAY_URL, "over-under"),
                    "Over/Under",
                    ["Bookmaker", "Total", "Over", "Under"],
                    ["betano.br", "8.5", "1.9", "1.9"],
                ),
            ]
        }

        rows = normalize(raw, "Baseball")["rows"]

        self.assertTrue(rows)
        self.assertEqual({row["raw_ref"]["game_id"] for row in rows}, {"6wPO81JF"})


def raw_game(url: str, market: str, header: list[str], row: list[str]) -> dict:
    return {
        "home": "Arizona Diamondbacks",
        "away": "San Francisco Giants",
        "date": "2026-07-02",
        "hour": "20:10",
        "league": "MLB",
        "link": url,
        "odds": {market: {"Full Time": [header, row]}},
    }
