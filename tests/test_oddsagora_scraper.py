from __future__ import annotations

import unittest
from unittest.mock import patch

from scrapers.oddsagora_scraper import (
    _extract_market_pages,
    _extract_match_event_template,
    _match_event_url,
    parse_league_html,
    parse_market_html,
    parse_match_event_payload,
)


class OddsAgoraScraperParserTests(unittest.TestCase):
    def test_parse_league_table_extracts_games_and_home_away_odds(self) -> None:
        html = """
        <html><head><title>Odds para Apostas em MLB</title></head><body>
          <table>
            <tr><th>Hoje, 03 Jul</th><th>1</th><th>2</th></tr>
            <tr>
              <td>19:45</td>
              <td><a href="/baseball/h2h/pittsburgh-pirates-tr9K2SqG/washington-nationals-CEO26qRp/#YReFE9Wa:home-away;1">Washington Nationals</a></td>
              <td>Pittsburgh Pirates</td>
              <td>1.73</td><td>2.25</td>
            </tr>
          </table>
        </body></html>
        """

        games = parse_league_html(
            "https://www.oddsagora.com.br/baseball/usa/mlb/",
            html,
            ["home-away", "over-under", "ah"],
            data_inicio="2026-07-03",
            data_fim="2026-07-03",
        )

        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["game_id"], "YReFE9Wa")
        self.assertEqual(games[0]["date"], "2026-07-03")
        self.assertEqual(games[0]["time"], "19:45")
        self.assertEqual(games[0]["home_team"], "Washington Nationals")
        self.assertEqual(games[0]["away_team"], "Pittsburgh Pirates")
        self.assertEqual(games[0]["markets"]["home-away"][0]["home_odd"], 1.73)
        self.assertTrue(games[0]["market_urls"]["over-under"].endswith("#YReFE9Wa:over-under;1"))

    def test_parse_football_league_table_extracts_h2h_and_1x2_odds(self) -> None:
        html = """
        <html><head><title>Odds para Apostas em Serie A</title></head><body>
          <table>
            <tr><th>Hoje, 03 Jul</th><th>1</th><th>X</th><th>2</th></tr>
            <tr>
              <td>16:00</td>
              <td><a href="/football/h2h/flamengo-rJ9abcde/palmeiras-xY8pqwer/#AbCd1234:1x2;1">Flamengo</a></td>
              <td>Palmeiras</td>
              <td>2.10</td><td>3.20</td><td>3.60</td>
            </tr>
          </table>
        </body></html>
        """

        games = parse_league_html(
            "https://www.oddsagora.com.br/football/brazil/brasileirao-betano",
            html,
            ["1x2", "over-under", "ah"],
            data_inicio="2026-07-03",
            data_fim="2026-07-03",
        )

        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["sport"], "Football")
        self.assertEqual(games[0]["league"], "Brazil - Brasileirao Betano")
        self.assertEqual(games[0]["game_id"], "AbCd1234")
        self.assertEqual(games[0]["markets"]["1x2"][0]["home_odd"], 2.10)
        self.assertEqual(games[0]["markets"]["1x2"][0]["draw_odd"], 3.20)
        self.assertEqual(games[0]["markets"]["1x2"][0]["away_odd"], 3.60)

    def test_parse_league_skips_undated_h2h_links_when_date_filter_is_present(self) -> None:
        html = """
        <html><body>
          <a href="/basketball/h2h/minnesota-lynx-AeUcuq4r/new-york-liberty-h4iAv3Jl/#nTkWK5dd:home-away;1">
            Minnesota Lynx vs New York Liberty
          </a>
        </body></html>
        """
        logs: list[dict[str, object]] = []

        games = parse_league_html(
            "https://www.oddsagora.com.br/basketball/usa/wnba/",
            html,
            ["home-away", "over-under", "ah"],
            data_inicio="2026-07-03",
            data_fim="2026-07-03",
            logs=logs,
        )

        self.assertEqual(games, [])
        self.assertTrue(any(log["event"] == "league_link_skipped_missing_date" for log in logs))

    def test_parse_league_does_not_add_extra_links_when_table_has_games(self) -> None:
        html = """
        <html><body>
          <table>
            <tr><th>Hoje, 03 Jul</th><th>1</th><th>2</th></tr>
            <tr>
              <td>19:45</td>
              <td><a href="/basketball/h2h/minnesota-lynx-AeUcuq4r/new-york-liberty-h4iAv3Jl/#nTkWK5dd:home-away;1">Minnesota Lynx</a></td>
              <td>New York Liberty</td>
              <td>1.80</td><td>2.10</td>
            </tr>
          </table>
          <a href="/basketball/h2h/old-team-abc123/other-team-def456/#zzzz1111:home-away;1">Old Team vs Other Team</a>
        </body></html>
        """
        logs: list[dict[str, object]] = []

        games = parse_league_html(
            "https://www.oddsagora.com.br/basketball/usa/wnba/",
            html,
            ["home-away", "over-under", "ah"],
            data_inicio="2026-07-03",
            data_fim="2026-07-03",
            logs=logs,
        )

        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["game_id"], "nTkWK5dd")
        self.assertTrue(any(log["event"] == "league_link_fallback_skipped_table_authoritative" for log in logs))

    def test_parse_league_json_ld_uses_sao_paulo_date_for_late_games(self) -> None:
        html = """
        <html><head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "SportsEvent",
            "name": "Washington Nationals - Pittsburgh Pirates",
            "startDate": "2026-07-04T00:45:00+02:00",
            "url": "https://www.oddsagora.com.br/baseball/h2h/pittsburgh-pirates-tr9K2SqG/washington-nationals-CEO26qRp/#YReEF9Wa/"
          }
          </script>
        </head><body></body></html>
        """

        games = parse_league_html(
            "https://www.oddsagora.com.br/baseball/usa/mlb/",
            html,
            ["home-away", "over-under", "ah"],
            data_inicio="2026-07-03",
            data_fim="2026-07-03",
        )

        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["game_id"], "YReEF9Wa")
        self.assertEqual(games[0]["date"], "2026-07-03")
        self.assertEqual(games[0]["time"], "19:45")
        self.assertEqual(games[0]["home_team"], "Washington Nationals")
        self.assertEqual(games[0]["away_team"], "Pittsburgh Pirates")

    def test_parse_home_away_market_table(self) -> None:
        html = """
        <table>
          <tr><th>Casas de apostas</th><th>1</th><th>2</th><th>Payout</th></tr>
          <tr><td>bet365</td><td>1.67</td><td>2.15</td><td>94.0%</td></tr>
          <tr><td>Superbet.br</td><td>1.68</td><td>2.25</td><td>96.2%</td></tr>
        </table>
        """

        rows = parse_market_html(html, "home-away")

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["bookmaker"], "bet365")
        self.assertEqual(rows[0]["home_odd"], 1.67)
        self.assertEqual(rows[0]["away_odd"], 2.15)
        self.assertEqual(rows[0]["payout"], 94.0)

    def test_parse_over_under_market_table_keeps_line_values(self) -> None:
        html = """
        <table>
          <tr><td>Acima/Abaixo +7</td><td>7</td><td>1.28</td><td>3.40</td><td>93.0%</td></tr>
          <tr><td>Acima/Abaixo +7.5</td><td>9</td><td>1.42</td><td>2.92</td><td>95.5%</td></tr>
          <tr><th>Casas de apostas</th><th>Total</th><th>Acima</th><th>Abaixo</th><th>Payout</th></tr>
          <tr><td>Estrelabet</td><td>+7.5</td><td>1.41</td><td>2.75</td><td>93.2%</td></tr>
          <tr><td>Superbet.br</td><td>+7.5</td><td>1.42</td><td>2.77</td><td>93.9%</td></tr>
        </table>
        """

        rows = parse_market_html(html, "over-under")

        self.assertEqual(len(rows), 2)
        self.assertEqual({row["line"] for row in rows}, {7.5})
        self.assertEqual(rows[0]["odd_over"], 1.41)
        self.assertEqual(rows[0]["odd_under"], 2.75)

    def test_parse_asian_handicap_market_table_keeps_half_line(self) -> None:
        html = """
        <table>
          <tr><td>Handicap Asiatico +1</td><td>3</td><td>1.95</td><td>1.80</td><td>93.6%</td></tr>
          <tr><td>Handicap Asiatico +1.5</td><td>10</td><td>1.43</td><td>2.90</td><td>95.8%</td></tr>
          <tr><th>Casas de apostas</th><th>Handicap</th><th>1</th><th>2</th><th>Payout</th></tr>
          <tr><td>Estrelabet</td><td>+1.5</td><td>1.43</td><td>2.70</td><td>93.5%</td></tr>
          <tr><td>Superbet.br</td><td>+1.5</td><td>1.42</td><td>2.90</td><td>95.3%</td></tr>
        </table>
        """

        rows = parse_market_html(html, "ah")

        self.assertEqual(len(rows), 2)
        self.assertEqual({row["line"] for row in rows}, {1.5})
        self.assertEqual(rows[0]["home_odd"], 1.43)
        self.assertEqual(rows[0]["away_odd"], 2.70)

    def test_extract_match_event_template_from_event_html(self) -> None:
        html = r'''
        <script>
        data='{"requestPreMatch":{"url":"\/match-event\/9-6-SlHmU8og-3-1-yj650.dat?_="}}'
        </script>
        '''

        template = _extract_match_event_template(html, "SlHmU8og")

        self.assertEqual(template["version_id"], "9")
        self.assertEqual(template["sport_id"], "6")
        self.assertEqual(template["scope_id"], "1")
        self.assertEqual(template["xhashf"], "yj650")

    def test_extract_match_event_template_reuses_page_hash_for_requested_game(self) -> None:
        html = r'''
        <script>
        data='{"requestPreMatch":{"url":"\/match-event\/9-6-f3cCact2-3-1-yj806.dat?_="}}'
        </script>
        '''

        template = _extract_match_event_template(html, "27mVBRVO")

        self.assertEqual(template["version_id"], "9")
        self.assertEqual(template["sport_id"], "6")
        self.assertEqual(template["source_game_id"], "f3cCact2")
        self.assertEqual(template["scope_id"], "1")
        self.assertEqual(template["xhashf"], "yj806")

    def test_parse_match_event_payload_uses_provider_names(self) -> None:
        payload = {
            "s": 1,
            "d": {
                "bt": 2,
                "sc": 1,
                "oddsdata": {
                    "back": {
                        "E-2-1-0-7.5-0": {
                            "handicapValue": "7.50",
                            "odds": {"16": [1.91, 1.95]},
                            "movement": {"16": ["up", "down"]},
                            "act": {"16": True},
                        },
                    },
                },
            },
        }

        rows = parse_match_event_payload(payload, "over-under", {"16": "bet365"})

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["bookmaker"], "bet365")
        self.assertEqual(rows[0]["line"], 7.5)
        self.assertEqual(rows[0]["odd_over"], 1.91)
        self.assertEqual(rows[0]["odd_under"], 1.95)

    def test_parse_match_event_payload_supports_1x2(self) -> None:
        payload = {
            "s": 1,
            "d": {
                "bt": 1,
                "sc": 1,
                "oddsdata": {
                    "back": {
                        "E-1-1-0-0-0": {
                            "odds": {"16": [2.1, 3.2, 3.6]},
                            "movement": {"16": ["up", "down", "up"]},
                            "act": {"16": True},
                        },
                    },
                },
            },
        }

        rows = parse_match_event_payload(payload, "1x2", {"16": "bet365"})

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["bookmaker"], "bet365")
        self.assertEqual(rows[0]["home_odd"], 2.1)
        self.assertEqual(rows[0]["draw_odd"], 3.2)
        self.assertEqual(rows[0]["away_odd"], 3.6)

    def test_match_event_url_uses_sport_market_scope(self) -> None:
        template = {"version_id": "9", "sport_id": "1", "scope_id": "1", "xhashf": "yj650"}

        football_url = _match_event_url(
            template,
            "p6RseziI",
            "bts",
            "https://www.oddsagora.com.br/football/h2h/a/b/#p6RseziI:1X2;2",
        )
        hockey_url = _match_event_url(
            template,
            "llTZ1jhI",
            "bts",
            "https://www.oddsagora.com.br/hockey/h2h/a/b/#llTZ1jhI:home-away;1",
        )

        self.assertIn("/match-event/9-1-p6RseziI-9-2-yj650.dat", football_url)
        self.assertIn("/match-event/9-1-llTZ1jhI-9-5-yj650.dat", hockey_url)

    def test_extract_market_pages_skips_html_fallback_after_empty_match_event(self) -> None:
        match_html = r'''
        <script>
        data='{"requestPreMatch":{"url":"\/match-event\/9-1-p6RseziI-1-2-yj650.dat?_="}}'
        </script>
        '''
        games = [
            {
                "game_id": "p6RseziI",
                "match_url": "https://www.oddsagora.com.br/football/h2h/a/b/#p6RseziI:1X2;2",
                "market_urls": {
                    "bts": "https://www.oddsagora.com.br/football/h2h/a/b/#p6RseziI:bts;2",
                },
                "markets": {},
            }
        ]
        logs: list[dict[str, object]] = []

        with (
            patch("scrapers.oddsagora_scraper._fetch_html", return_value=(match_html, games[0]["match_url"])) as fetch_html,
            patch("scrapers.oddsagora_scraper._fetch_oddsagora_json", return_value={"d": {"oddsdata": {"back": {}}}}),
        ):
            rows_count = _extract_market_pages(games, logs, None, {})

        self.assertEqual(rows_count, 0)
        self.assertEqual(fetch_html.call_count, 1)
        self.assertTrue(any(log["event"] == "market_html_fallback_skipped" for log in logs))

    def test_parse_match_event_payload_supports_bts_and_double_chance(self) -> None:
        bts_payload = {
            "d": {"oddsdata": {"back": {"E-bts": {"odds": {"16": [1.8, 1.95]}, "act": {"16": True}}}}},
        }
        double_payload = {
            "d": {"oddsdata": {"back": {"E-double": {"odds": {"16": [1.25, 1.45, 1.32]}, "act": {"16": True}}}}},
        }

        bts_rows = parse_match_event_payload(bts_payload, "bts", {"16": "bet365"})
        double_rows = parse_match_event_payload(double_payload, "double", {"16": "bet365"})

        self.assertEqual(bts_rows[0]["yes_odd"], 1.8)
        self.assertEqual(bts_rows[0]["no_odd"], 1.95)
        self.assertEqual(double_rows[0]["home_draw_odd"], 1.25)
        self.assertEqual(double_rows[0]["away_draw_odd"], 1.45)
        self.assertEqual(double_rows[0]["home_away_odd"], 1.32)


if __name__ == "__main__":
    unittest.main()
