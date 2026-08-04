import unittest

from api.main import _collection_warning


class CollectionWarningTests(unittest.TestCase):
    def test_expected_empty_collection_does_not_create_warning(self) -> None:
        warning = _collection_warning(
            {"mercados": ["1x2", "over-under"]},
            total_jogos=0,
            total_odds=0,
            raw_data={"status": "EMPTY", "games": []},
        )

        self.assertIsNone(warning)

    def test_home_away_alias_does_not_create_false_warning(self) -> None:
        raw = {
            "games": [
                {
                    "markets": {
                        "home-away": [{"home_odd": 1.8, "away_odd": 2.1}],
                        "over-under": [{"line": 8.5, "odd_over": 1.9, "odd_under": 1.9}],
                        "ah": [{"line": -1.5, "home_odd": 2.0, "away_odd": 1.8}],
                    }
                }
            ]
        }

        warning = _collection_warning(
            {"mercados": ["home-away", "over-under", "ah"]},
            total_jogos=1,
            total_odds=6,
            raw_data=raw,
        )

        self.assertIsNone(warning)

    def test_requested_market_aliases_share_the_raw_canonical_names(self) -> None:
        raw = {
            "games": [
                {
                    "markets": {
                        "moneyline": [{"home_odd": 1.8, "away_odd": 2.1}],
                        "asian-handicap": [{"line": -1.5, "home_odd": 2.0, "away_odd": 1.8}],
                        "both-teams-score": [{"yes_odd": 1.9, "no_odd": 1.9}],
                        "double-chance": [{"home_draw_odd": 1.3}],
                    }
                }
            ]
        }

        warning = _collection_warning(
            {"mercados": ["home-away", "handicap", "bts", "double"]},
            total_jogos=1,
            total_odds=7,
            raw_data=raw,
        )

        self.assertIsNone(warning)
