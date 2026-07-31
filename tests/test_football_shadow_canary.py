import tempfile
import unittest
from pathlib import Path

from api.football_shadow import (
    build_storage_payload,
    central_candidates_to_long_rows,
    compare_shadow_results,
    coverage_report, missing_required_fields,
    write_long_csv,
)


def candidate(**overrides):
    value = {
        "match_id": "00000000-0000-0000-0000-000000000001",
        "match_date": "2026-07-31",
        "match_time": "20:00",
        "country": "Brazil",
        "league": "Serie A",
        "home": "Flamengo",
        "away": "Palmeiras",
        "market_definition_id": "00000000-0000-0000-0000-000000000002",
        "market_family": "moneyline",
        "selection_key": "home",
        "selection_name": "Flamengo",
        "line_key": "",
        "line_value": None,
        "median_odds": 2.0,
        "best_odds": 2.1,
        "bookmaker_count": 3,
        "best_bookmaker": "bet365",
        "snapshot_at": "2026-07-31T15:00:00+00:00",
    }
    value.update(overrides)
    return value


class FootballShadowCanaryTests(unittest.TestCase):
    def test_builds_existing_matchmatrix_long_contract(self):
        rows = central_candidates_to_long_rows([candidate()])
        self.assertEqual(rows[0]["mercado"], "Resultado Final")
        self.assertEqual(rows[0]["odd"], 2.0)
        self.assertEqual(rows[0]["odd_melhor"], 2.1)
        self.assertEqual(rows[0]["fonte"], "Highlightly/Central Esportiva")

    def test_unknown_market_is_excluded_and_coverage_is_explicit(self):
        candidates = [candidate(market_family="corners_total")]
        rows = central_candidates_to_long_rows(candidates)
        self.assertEqual(rows, [])
        self.assertEqual(coverage_report(candidates, rows)["coverage_ratio"], 0.0)
        self.assertEqual(build_storage_payload(candidates), {"matches": [], "features": [], "odds": []})

    def test_missing_required_fields_are_reported(self):
        rows = central_candidates_to_long_rows([candidate(league="")])
        self.assertEqual(missing_required_fields(rows), ["liga"])

    def test_storage_payload_keeps_exact_odds_lineage(self):
        payload = build_storage_payload([candidate()])
        self.assertEqual(len(payload["matches"]), 1)
        self.assertEqual(payload["odds"][0]["decimal_odds"], 2.1)
        self.assertEqual(payload["odds"][0]["source_lineage"]["median_odds"], 2.0)

    def test_comparison_is_always_shadow_and_never_publishes(self):
        prediction = {"data": "2026-07-31", "jogo": "A vs B", "mercado": "1X2", "pick": "A", "linha": "", "probabilidade_final": 60}
        comparison = compare_shadow_results({"prognosticos": [prediction]}, {"prognosticos": [prediction]})
        self.assertEqual(comparison["mode"], "shadow")
        self.assertFalse(comparison["automatic_publication"])
        self.assertEqual(comparison["maximum_probability_delta"], 0.0)

    def test_csv_is_written_atomically_with_expected_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.csv"
            write_long_csv(central_candidates_to_long_rows([candidate()]), path)
            text = path.read_text(encoding="utf-8-sig")
            self.assertTrue(text.startswith("data,hora,esporte,country,liga"))
            self.assertFalse(path.with_suffix(".tmp").exists())


if __name__ == "__main__":
    unittest.main()
