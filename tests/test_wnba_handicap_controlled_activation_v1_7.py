from __future__ import annotations

import json
import unittest

from modelos import basketball_runner_real
from modelos.wnba_handicap_controlled_activation_v1_7 import (
    HANDICAP_SELECTED_CONTROLLED,
    HANDICAP_SHADOW_ONLY_DUE_TO_FALLBACKS,
    LOW_PROBABILITY,
    NO_MARKET_BASELINE,
    NO_VALUE_AGAINST_FAIR_ODD,
    OVERCONFIDENCE_FLAG,
    build_wnba_handicap_controlled_activation,
    evaluate_handicap_diagnostic_for_activation,
)


class WnbaHandicapControlledActivationV17Tests(unittest.TestCase):
    def test_v1_7_flag_allows_handicap_evaluation(self) -> None:
        self.assertTrue(basketball_runner_real.WNBA_HANDICAP_ENABLED_V1_7)
        self.assertFalse(basketball_runner_real.WNBA_HANDICAP_ENABLED_V1_1)

    def test_handicap_does_not_enter_with_invalid_pair(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("-4.5", "-4.5"), margin_context())
        self.assertEqual(len(result["prognosticos"]), 0)

    def test_handicap_does_not_enter_without_no_vig(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("-4.5", "+4.5", 1.91, ""), margin_context())
        self.assertEqual(len(result["prognosticos"]), 0)

    def test_handicap_does_not_enter_with_double_fallback(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("+4.5", "-4.5", 1.91, 1.91))
        self.assertEqual(len(result["prognosticos"]), 0)
        self.assertGreater(result["handicap_shadow_diagnostics"]["summary"]["discard_reasons"].get(HANDICAP_SHADOW_ONLY_DUE_TO_FALLBACKS, 0), 0)

    def test_handicap_does_not_enter_when_edge_is_not_positive(self) -> None:
        decision = evaluate_handicap_diagnostic_for_activation(valid_diag(final_prob=0.55, odd=1.70, edge=-0.01))
        self.assertFalse(decision.selected)
        self.assertEqual(decision.reason, NO_VALUE_AGAINST_FAIR_ODD)

    def test_handicap_does_not_enter_when_probability_is_low(self) -> None:
        decision = evaluate_handicap_diagnostic_for_activation(valid_diag(final_prob=0.53, odd=1.91, edge=0.01))
        self.assertFalse(decision.selected)
        self.assertEqual(decision.reason, LOW_PROBABILITY)

    def test_handicap_does_not_enter_when_probability_is_too_high(self) -> None:
        decision = evaluate_handicap_diagnostic_for_activation(valid_diag(final_prob=0.70, odd=1.91, edge=0.20))
        self.assertFalse(decision.selected)
        self.assertEqual(decision.reason, OVERCONFIDENCE_FLAG)

    def test_handicap_enters_when_all_controlled_criteria_pass(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("+4.5", "-4.5", 1.91, 1.91), margin_context(mu=4.0, sigma=10.0))
        self.assertEqual(len(result["prognosticos"]), 1)
        self.assertEqual(result["prognosticos"][0]["mercado"], "Handicap")
        self.assertEqual(result["handicap_shadow_diagnostics"]["summary"]["discard_reasons"].get(HANDICAP_SELECTED_CONTROLLED), 1)

    def test_published_handicap_has_correct_line(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("+4.5", "-4.5", 1.91, 1.91), margin_context(mu=4.0, sigma=10.0))
        self.assertEqual(result["prognosticos"][0]["linha"], "4.5")

    def test_published_handicap_keeps_app_schema(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("+4.5", "-4.5", 1.91, 1.91), margin_context(mu=4.0, sigma=10.0))
        item = result["prognosticos"][0]
        expected = {
            "data",
            "hora",
            "esporte",
            "liga",
            "jogo",
            "mandante",
            "visitante",
            "mercado",
            "pick",
            "linha",
            "probabilidade",
            "probabilidade_final",
            "odd",
            "odd_ofertada",
            "odd_valor",
            "edge",
            "stake",
            "parecer_validacao",
            "observacoes",
            "dados_tecnicos",
            "contexto_adicional",
            "contexto_modelo",
        }
        self.assertTrue(expected.issubset(item.keys()))

    def test_published_handicap_uses_conservative_stake(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("+4.5", "-4.5", 1.91, 1.91), margin_context(mu=4.0, sigma=10.0))
        self.assertEqual(result["prognosticos"][0]["stake"], "0.5u")

    def test_published_count_reflects_output(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("+4.5", "-4.5", 1.91, 1.91), margin_context(mu=4.0, sigma=10.0))
        self.assertEqual(result["handicap_shadow_diagnostics"]["published_count"], len(result["prognosticos"]))

    def test_over_under_is_not_changed_by_activation(self) -> None:
        result = build_wnba_handicap_controlled_activation(over_under_rows(), margin_context())
        self.assertEqual(result["prognosticos"], [])

    def test_moneyline_is_not_changed_by_activation(self) -> None:
        result = build_wnba_handicap_controlled_activation(moneyline_rows(), margin_context())
        self.assertEqual(result["prognosticos"], [])

    def test_nba_does_not_receive_wnba_handicap(self) -> None:
        rows = handicap_rows("+4.5", "-4.5", 1.91, 1.91)
        for row in rows:
            row["liga"] = "NBA"
        result = build_wnba_handicap_controlled_activation(rows, margin_context(mu=4.0, sigma=10.0))
        self.assertEqual(result["prognosticos"], [])

    def test_other_sports_are_not_impacted(self) -> None:
        rows = handicap_rows("+4.5", "-4.5", 1.91, 1.91)
        for row in rows:
            row["esporte"] = "Football"
            row["liga"] = "England - Premier League"
        result = build_wnba_handicap_controlled_activation(rows, margin_context(mu=4.0, sigma=10.0))
        self.assertEqual(result["prognosticos"], [])

    def test_json_serializes_without_error(self) -> None:
        result = build_wnba_handicap_controlled_activation(handicap_rows("+4.5", "-4.5", 1.91, 1.91), margin_context(mu=4.0, sigma=10.0))
        json.dumps(result, ensure_ascii=False)


def valid_diag(final_prob: float, odd: float, edge: float) -> dict[str, object]:
    return {
        "status": "SHADOW_READY",
        "alertas": [],
        "linha": 4.5,
        "odd": odd,
        "final_shadow_prob": final_prob,
        "edge_shadow": edge,
        "componentes": {
            "historical": {"fallback_used": False, "shrinked_cover_rate": 0.55},
            "margin": {"fallback_used": False, "margin_cover_prob": 0.57},
            "market": {"status": "MARKET_BASELINE_OK"},
        },
    }


def handicap_rows(home_line: str = "+4.5", away_line: str = "-4.5", home_odd: object = 1.91, away_odd: object = 1.91) -> list[dict[str, object]]:
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


def margin_context(mu: float | None = None, sigma: float | None = None) -> dict[str, object]:
    if mu is None and sigma is None:
        return {}
    return {
        "margin_by_game": {
            "Toronto Tempo W vs New York Liberty W": {
                "mu_margin": mu,
                "sigma_margin": sigma,
            }
        }
    }


if __name__ == "__main__":
    unittest.main()

