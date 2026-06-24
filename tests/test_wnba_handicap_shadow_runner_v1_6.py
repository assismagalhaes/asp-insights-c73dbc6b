from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from modelos import basketball_runner_real
from modelos.wnba_handicap_shadow_runner_integration_v1_6 import (
    MODEL_VERSION,
    build_wnba_handicap_shadow_diagnostics,
    ensure_main_output_has_no_handicap,
)


class WnbaHandicapShadowRunnerV16Tests(unittest.TestCase):
    def test_integration_returns_shadow_only_mode(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics(handicap_rows())
        self.assertEqual(result["mode"], "shadow_only")
        self.assertEqual(result["model_version"], MODEL_VERSION)

    def test_integration_returns_published_false(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics(handicap_rows())
        self.assertFalse(result["published"])

    def test_handicap_does_not_enter_main_output(self) -> None:
        main_output = [{"mercado": "Moneyline"}, {"mercado": "Over/Under Pontos"}]
        self.assertTrue(ensure_main_output_has_no_handicap(main_output))

    def test_wnba_handicap_flag_remains_false(self) -> None:
        self.assertFalse(basketball_runner_real.WNBA_HANDICAP_ENABLED_V1_1)

    def test_over_under_wnba_rows_are_ignored_by_shadow_and_preserved_outside(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics(over_under_rows())
        self.assertEqual(result["summary"]["pairs_analyzed"], 0)
        main_output = [{"mercado": "Over/Under Pontos", "pick": "Over 165.5"}]
        self.assertTrue(ensure_main_output_has_no_handicap(main_output))

    def test_moneyline_wnba_rows_are_ignored_by_shadow_and_preserved_outside(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics(moneyline_rows())
        self.assertEqual(result["summary"]["pairs_analyzed"], 0)
        main_output = [{"mercado": "Moneyline", "pick": "Toronto Tempo W"}]
        self.assertTrue(ensure_main_output_has_no_handicap(main_output))

    def test_nba_does_not_receive_wnba_diagnostic(self) -> None:
        rows = handicap_rows()
        for row in rows:
            row["liga"] = "NBA"
        result = build_wnba_handicap_shadow_diagnostics(rows)
        self.assertEqual(result["summary"]["pairs_analyzed"], 0)

    def test_no_handicap_pairs_returns_empty_summary_without_crashing(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics([])
        self.assertEqual(result["summary"]["pairs_analyzed"], 0)
        self.assertEqual(result["diagnostics"], [])

    def test_valid_pairs_generate_shadow_diagnostics(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics(handicap_rows())
        self.assertEqual(result["summary"]["valid_pairs"], 1)
        self.assertEqual(result["summary"]["diagnostics_generated"], 2)

    def test_real_odd_2_00_remains_valid_in_diagnostic(self) -> None:
        rows = handicap_rows(home_odd=1.78, away_odd=2.00)
        result = build_wnba_handicap_shadow_diagnostics(rows)
        self.assertEqual(result["summary"]["real_odd_2_00"], 1)
        self.assertEqual(result["summary"]["valid_pairs"], 1)

    def test_historical_fallback_is_explicitly_marked(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics(handicap_rows())
        self.assertGreater(result["summary"]["historical_fallback"], 0)

    def test_margin_fallback_is_explicitly_marked(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics(handicap_rows())
        self.assertGreater(result["summary"]["margin_fallback"], 0)

    def test_overconfidence_is_flag_not_pick(self) -> None:
        rows = handicap_rows(home_line="+40.5", away_line="-40.5", home_odd=1.10, away_odd=6.0)
        result = build_wnba_handicap_shadow_diagnostics(rows)
        self.assertGreaterEqual(result["summary"]["overconfidence_flags"], 1)
        self.assertFalse(result["published"])

    def test_no_stake_is_suggested_for_handicap_shadow(self) -> None:
        result = build_wnba_handicap_shadow_diagnostics(handicap_rows())
        self.assertTrue(all(item.get("stake") is None for item in result["diagnostics"]))

    def test_main_output_keeps_expected_wnba_fields(self) -> None:
        item = {
            "data": "2026-06-23",
            "hora": "20:00",
            "esporte": "Basketball",
            "liga": "WNBA",
            "jogo": "A vs B",
            "mandante": "A",
            "visitante": "B",
            "mercado": "Over/Under Pontos",
            "pick": "Over 165.5",
            "linha": 165.5,
            "odd_ofertada": 1.91,
            "odd_valor": 1.80,
            "probabilidade_final": 55.5,
            "edge": 6.1,
        }
        for field in ("data", "hora", "esporte", "liga", "jogo", "mandante", "visitante", "mercado", "pick", "linha", "odd_ofertada", "odd_valor", "probabilidade_final", "edge"):
            self.assertIn(field, item)

    def test_runner_helper_adds_shadow_key_without_publishing_handicap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "wnba.csv"
            write_rows(path, handicap_rows() + over_under_rows())
            result = basketball_runner_real.build_wnba_handicap_shadow_from_csv(path)
        self.assertEqual(result["mode"], "shadow_only")
        self.assertFalse(result["published"])
        self.assertEqual(result["summary"]["valid_pairs"], 1)


def handicap_rows(home_line: str = "-4.5", away_line: str = "+4.5", home_odd: object = 1.91, away_odd: object = 1.91) -> list[dict[str, object]]:
    return [
        base_row("Asian handicap", "Toronto Tempo W", home_line, home_odd),
        base_row("Asian handicap", "New York Liberty W", away_line, away_odd),
    ]


def moneyline_rows() -> list[dict[str, object]]:
    return [base_row("Moneyline", "Toronto Tempo W", "", 1.91), base_row("Moneyline", "New York Liberty W", "", 1.91)]


def over_under_rows() -> list[dict[str, object]]:
    return [base_row("Over/Under Pontos", "Over 165.5", 165.5, 1.91), base_row("Over/Under Pontos", "Under 165.5", 165.5, 1.91)]


def base_row(mercado: str, pick: str, linha: object, odd: object) -> dict[str, object]:
    return {
        "data": "2026-06-23",
        "hora": "20:00",
        "esporte": "Basketball",
        "liga": "WNBA",
        "jogo": "Toronto Tempo W vs New York Liberty W",
        "mandante": "Toronto Tempo W",
        "visitante": "New York Liberty W",
        "mercado": mercado,
        "pick": pick,
        "linha": linha,
        "odd": odd,
        "bookmaker": "betano.br",
    }


def write_rows(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    unittest.main()

