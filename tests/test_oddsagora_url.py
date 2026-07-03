from __future__ import annotations

import unittest

from scrapers.oddsagora_url import build_oddsagora_market_url, extract_oddsagora_game_id


BASE_URL = (
    "https://www.oddsagora.com.br/baseball/h2h/"
    "chicago-cubs-j7ZnBQFi/st-louis-cardinals-IDVz16ES/#SlHmU8og:home-away;1"
)


class OddsAgoraUrlTests(unittest.TestCase):
    def test_extract_game_id_from_market_hashes(self) -> None:
        self.assertEqual(extract_oddsagora_game_id(BASE_URL), "SlHmU8og")
        self.assertEqual(
            extract_oddsagora_game_id(BASE_URL.replace("home-away;1", "over-under;1")),
            "SlHmU8og",
        )
        self.assertEqual(
            extract_oddsagora_game_id(BASE_URL.replace("home-away;1", "ah;1;1.50;0")),
            "SlHmU8og",
        )

    def test_build_market_urls_preserves_game_id(self) -> None:
        self.assertTrue(build_oddsagora_market_url(BASE_URL, "home-away").endswith("#SlHmU8og:home-away;1"))
        self.assertTrue(build_oddsagora_market_url(BASE_URL, "over-under").endswith("#SlHmU8og:over-under;1"))
        self.assertTrue(build_oddsagora_market_url(BASE_URL, "ah").endswith("#SlHmU8og:ah;1"))
        self.assertTrue(build_oddsagora_market_url(BASE_URL, "ah", "1.50").endswith("#SlHmU8og:ah;1;1.50;0"))


if __name__ == "__main__":
    unittest.main()
