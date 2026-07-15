import unittest

from api.highlightly_quality import audit_odds_rows, audit_standings


class HighlightlyQualityTests(unittest.TestCase):
    def test_flags_repeated_team_corruption(self):
        payload = {"groups": [{"name": "Conference", "standings": [
            {"position": 1, "team": {"id": 784, "name": "Panevezys Women"}},
            {"position": 2, "team": {"id": 784, "name": "Panevezys Women"}},
            {"position": 3, "team": {"id": 784, "name": "Panevezys Women"}},
            {"position": 4, "team": {"id": 784, "name": "Panevezys Women"}},
        ]}]}

        codes = {issue.code for issue in audit_standings(payload)}

        self.assertIn("STANDINGS_SINGLE_TEAM_REPEATED", codes)
        self.assertIn("STANDINGS_TEAM_DUPLICATED", codes)

    def test_accepts_distinct_team_identities(self):
        payload = {"groups": [{"standings": [
            {"position": 1, "team": {"id": 1, "name": "A"}},
            {"position": 2, "team": {"id": 2, "name": "B"}},
        ]}]}

        self.assertEqual(audit_standings(payload), [])

    def test_flags_invalid_odds_and_incomplete_metadata(self):
        row = {
            "mandante": "A", "visitante": "B", "mercado": "Moneyline",
            "pick": "A", "bookmaker": "", "odd": 1.0,
            "raw_ref": {"match_id": "42"},
        }

        codes = {issue.code for issue in audit_odds_rows([row])}

        self.assertEqual(codes, {"ODD_NOT_GREATER_THAN_ONE", "ODDS_METADATA_INCOMPLETE"})

    def test_accepts_complete_decimal_odds(self):
        row = {
            "mandante": "A", "visitante": "B", "mercado": "Moneyline",
            "pick": "A", "bookmaker": "Book", "odd": 1.85,
            "raw_ref": {"match_id": "42"},
        }

        self.assertEqual(audit_odds_rows([row]), [])


if __name__ == "__main__":
    unittest.main()
