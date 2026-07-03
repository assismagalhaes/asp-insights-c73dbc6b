from __future__ import annotations

import unittest

from scrapers.oddsagora_scraper import _extract_match_event_template, parse_league_html, parse_market_html, parse_match_event_payload


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


if __name__ == "__main__":
    unittest.main()
