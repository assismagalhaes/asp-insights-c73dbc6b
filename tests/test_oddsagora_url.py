from __future__ import annotations

import unittest

from scrapers.oddsagora_url import build_oddsagora_market_url, extract_oddsagora_game_id


BASE_URL = (
    "https://www.oddsagora.com.br/baseball/h2h/"
    "chicago-cubs-j7ZnBQFi/st-louis-cardinals-IDVz16ES/#SlHmU8og:home-away;1"
)
FOOTBALL_URL = (
    "https://www.oddsagora.com.br/football/h2h/"
    "galway-united-Yi2pvBXo/st-patricks-hhPUKlHi/#p6RseziI:1X2;2"
)
HOCKEY_URL = (
    "https://www.oddsagora.com.br/hockey/h2h/"
    "central-coast-rhinos-EXX9uS4s/perth-thunder-SU3b88LC/#llTZ1jhI:1X2;2"
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

    def test_build_football_market_urls_uses_oddsagora_scopes(self) -> None:
        self.assertTrue(build_oddsagora_market_url(FOOTBALL_URL, "1x2").endswith("#p6RseziI:1X2;2"))
        self.assertTrue(build_oddsagora_market_url(FOOTBALL_URL, "over-under").endswith("#p6RseziI:over-under;2"))
        self.assertTrue(build_oddsagora_market_url(FOOTBALL_URL, "ah").endswith("#p6RseziI:ah;2"))
        self.assertTrue(build_oddsagora_market_url(FOOTBALL_URL, "bts").endswith("#p6RseziI:bts;2"))
        self.assertTrue(build_oddsagora_market_url(FOOTBALL_URL, "double").endswith("#p6RseziI:double;2"))

    def test_build_hockey_market_urls_uses_mixed_scopes(self) -> None:
        self.assertTrue(build_oddsagora_market_url(HOCKEY_URL, "1x2").endswith("#llTZ1jhI:1X2;2"))
        self.assertTrue(build_oddsagora_market_url(HOCKEY_URL, "home-away").endswith("#llTZ1jhI:home-away;1"))
        self.assertTrue(build_oddsagora_market_url(HOCKEY_URL, "over-under").endswith("#llTZ1jhI:over-under;1"))
        self.assertTrue(build_oddsagora_market_url(HOCKEY_URL, "ah").endswith("#llTZ1jhI:ah;1"))
        self.assertTrue(build_oddsagora_market_url(HOCKEY_URL, "bts").endswith("#llTZ1jhI:bts;5"))


if __name__ == "__main__":
    unittest.main()
