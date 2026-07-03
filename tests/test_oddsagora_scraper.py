from __future__ import annotations

import unittest

from scrapers.oddsagora_scraper import parse_league_html, parse_market_html


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


if __name__ == "__main__":
    unittest.main()
