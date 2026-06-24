from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, Iterable

from modelos.wnba_handicap_probability_engine_v1_5 import (
    CONFIRMED_PLACEHOLDER_ODD,
    MARGIN_FALLBACK_USED,
    NO_MARKET_BASELINE,
    OVERCONFIDENCE_FLAG,
)
from modelos.wnba_handicap_shadow_runner_integration_v1_6 import build_wnba_handicap_shadow_diagnostics


MODEL_VERSION = "BASKETBALL_WNBA_V1_7_HANDICAP_CONTROLLED"

HANDICAP_SELECTED_CONTROLLED = "HANDICAP_SELECTED_CONTROLLED"
HANDICAP_SHADOW_ONLY_DUE_TO_FALLBACKS = "HANDICAP_SHADOW_ONLY_DUE_TO_FALLBACKS"
INVALID_HANDICAP_PAIR = "INVALID_HANDICAP_PAIR"
INVALID_LINE = "INVALID_LINE"
INVALID_ODDS = "INVALID_ODDS"
NO_VALUE_AGAINST_FAIR_ODD = "NO_VALUE_AGAINST_FAIR_ODD"
LOW_PROBABILITY = "LOW_PROBABILITY"
PAIR_INCOMPLETE = "PAIR_INCOMPLETE"
NON_SYMMETRIC_PAIR = "NON_SYMMETRIC_PAIR"
SAME_SIGN_PAIR = "SAME_SIGN_PAIR"
AMBIGUOUS_SIDE = "AMBIGUOUS_SIDE"
MISSING_MARGIN_COMPONENT = "MISSING_MARGIN_COMPONENT"
MISSING_HISTORICAL_COMPONENT = "MISSING_HISTORICAL_COMPONENT"

MIN_HANDICAP_PROBABILITY = 0.54
MAX_HANDICAP_PROBABILITY = 0.70
MIN_ODD = 1.25
MAX_ODD = 2.00


@dataclass
class ActivationDecision:
    selected: bool
    reason: str


def build_wnba_handicap_controlled_activation(
    normalized_rows: Iterable[dict[str, Any]],
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    shadow = build_wnba_handicap_shadow_diagnostics(normalized_rows, context)
    diagnostics = shadow.get("diagnostics", [])
    selected: list[dict[str, Any]] = []
    discarded: list[dict[str, Any]] = []
    reason_counts: Counter[str] = Counter()

    for index, diagnostic in enumerate(diagnostics):
        decision = evaluate_handicap_diagnostic_for_activation(diagnostic)
        diagnostic["activation_status"] = decision.reason
        diagnostic["published"] = decision.selected
        diagnostic["model_version"] = MODEL_VERSION
        if decision.selected:
            output = diagnostic_to_prognostico(diagnostic, index)
            selected.append(output)
            diagnostic["published_id"] = output["id_shadow"]
        else:
            discarded.append(diagnostic)
        reason_counts[decision.reason] += 1

    shadow["mode"] = "controlled_activation"
    shadow["model_version"] = MODEL_VERSION
    shadow["published"] = bool(selected)
    shadow["published_count"] = len(selected)
    shadow["discarded_count"] = len(discarded)
    shadow["selected_ids"] = [item["id_shadow"] for item in selected]
    shadow["diagnostics"] = diagnostics
    shadow.setdefault("summary", {})
    shadow["summary"].update(
        {
            "published_count": len(selected),
            "discarded_count": len(discarded),
            "selected_reasons": {HANDICAP_SELECTED_CONTROLLED: len(selected)},
            "discard_reasons": dict(reason_counts),
            "controlled_activation_version": MODEL_VERSION,
        }
    )
    return {
        "handicap_shadow_diagnostics": shadow,
        "prognosticos": selected,
        "discarded": discarded,
    }


def evaluate_handicap_diagnostic_for_activation(diagnostic: dict[str, Any]) -> ActivationDecision:
    alerts = set(diagnostic.get("alertas") or [])
    status = str(diagnostic.get("status") or "")

    if status in {INVALID_HANDICAP_PAIR, PAIR_INCOMPLETE, NON_SYMMETRIC_PAIR, SAME_SIGN_PAIR, AMBIGUOUS_SIDE}:
        return ActivationDecision(False, INVALID_HANDICAP_PAIR)
    if PAIR_INCOMPLETE in alerts:
        return ActivationDecision(False, PAIR_INCOMPLETE)
    if SAME_SIGN_PAIR in alerts:
        return ActivationDecision(False, SAME_SIGN_PAIR)
    if NON_SYMMETRIC_PAIR in alerts:
        return ActivationDecision(False, NON_SYMMETRIC_PAIR)
    if AMBIGUOUS_SIDE in alerts:
        return ActivationDecision(False, AMBIGUOUS_SIDE)
    if status == NO_MARKET_BASELINE or NO_MARKET_BASELINE in alerts:
        return ActivationDecision(False, NO_MARKET_BASELINE)
    if CONFIRMED_PLACEHOLDER_ODD in alerts:
        return ActivationDecision(False, CONFIRMED_PLACEHOLDER_ODD)

    line = _to_float(diagnostic.get("linha"))
    odd = _to_float(diagnostic.get("odd"))
    final_prob = _to_float(diagnostic.get("final_shadow_prob"))
    edge = _to_float(diagnostic.get("edge_shadow"))
    if line is None:
        return ActivationDecision(False, INVALID_LINE)
    if odd is None or not (odd > MIN_ODD and odd <= MAX_ODD):
        return ActivationDecision(False, INVALID_ODDS)
    if final_prob is None:
        return ActivationDecision(False, LOW_PROBABILITY)
    if final_prob >= MAX_HANDICAP_PROBABILITY or status == OVERCONFIDENCE_FLAG or OVERCONFIDENCE_FLAG in alerts:
        return ActivationDecision(False, OVERCONFIDENCE_FLAG)
    if final_prob < MIN_HANDICAP_PROBABILITY:
        return ActivationDecision(False, LOW_PROBABILITY)
    if edge is None or edge <= 0:
        return ActivationDecision(False, NO_VALUE_AGAINST_FAIR_ODD)

    historical_fallback = _component_fallback(diagnostic, "historical") or "NO_HISTORY" in alerts or "LOW_HISTORY_SAMPLE" in alerts
    margin_fallback = _component_fallback(diagnostic, "margin") or MARGIN_FALLBACK_USED in alerts
    if historical_fallback and margin_fallback:
        return ActivationDecision(False, HANDICAP_SHADOW_ONLY_DUE_TO_FALLBACKS)
    if historical_fallback and "margin_cover_prob" not in _component(diagnostic, "margin"):
        return ActivationDecision(False, MISSING_MARGIN_COMPONENT)
    if margin_fallback and "shrinked_cover_rate" not in _component(diagnostic, "historical"):
        return ActivationDecision(False, MISSING_HISTORICAL_COMPONENT)

    return ActivationDecision(True, HANDICAP_SELECTED_CONTROLLED)


def diagnostic_to_prognostico(diagnostic: dict[str, Any], index: int) -> dict[str, Any]:
    final_prob = float(diagnostic.get("final_shadow_prob") or 0.0)
    odd = float(diagnostic.get("odd") or 0.0)
    odd_justa = float(diagnostic.get("odd_justa_shadow") or (1 / final_prob if final_prob else 0.0))
    edge = float(diagnostic.get("edge_shadow") or 0.0)
    line = diagnostic.get("linha")
    pick = str(diagnostic.get("pick") or "")
    technical = build_technical_text(diagnostic)
    return {
        "id_shadow": f"wnba_hc_v1_7_{index}",
        "data": str(diagnostic.get("data") or ""),
        "hora": str(diagnostic.get("hora") or "") or None,
        "esporte": "Basketball",
        "liga": str(diagnostic.get("liga") or "WNBA"),
        "jogo": str(diagnostic.get("jogo") or ""),
        "mandante": str(diagnostic.get("mandante") or "") or None,
        "visitante": str(diagnostic.get("visitante") or "") or None,
        "mercado": "Handicap",
        "pick": pick,
        "linha": None if line in (None, "") else str(line),
        "odd": round(odd, 2),
        "odd_ofertada": round(odd, 2),
        "odd_valor": round(odd_justa, 2),
        "probabilidade": round(final_prob * 100, 2),
        "probabilidade_final": round(final_prob * 100, 2),
        "edge": round(edge * 100, 2),
        "stake": "0.5u",
        "parecer_validacao": "AGUARDAR_VALIDAÇÃO",
        "observacoes": "Handicap WNBA V1.7 controlled activation",
        "dados_tecnicos": technical,
        "contexto_adicional": technical,
        "contexto_modelo": technical,
        "modelo_versao": MODEL_VERSION,
    }


def build_technical_text(diagnostic: dict[str, Any]) -> str:
    components = diagnostic.get("componentes") or {}
    market = components.get("market") or {}
    historical = components.get("historical") or {}
    margin = components.get("margin") or {}
    combined = components.get("combined") or {}
    return "\n".join(
        [
            "Handicap WNBA V1.7 controlled activation",
            f"Jogo: {diagnostic.get('jogo')}",
            f"Lado avaliado: {diagnostic.get('lado')}",
            f"Linha real: {diagnostic.get('linha')}",
            f"Odd ofertada: {diagnostic.get('odd')}",
            f"Odd oposta: {diagnostic.get('odd_oposta')}",
            f"Probabilidade no-vig: {diagnostic.get('market_no_vig_prob')}",
            f"Probabilidade histórica: {diagnostic.get('historical_cover_prob')}",
            f"Probabilidade por margem: {diagnostic.get('margin_cover_prob')}",
            f"Final shadow prob: {diagnostic.get('final_shadow_prob')}",
            f"Odd justa shadow: {diagnostic.get('odd_justa_shadow')}",
            f"Edge shadow: {diagnostic.get('edge_shadow')}",
            f"Status V1.7: {diagnostic.get('activation_status')}",
            f"Fallback histórico: {historical.get('fallback_used')}",
            f"Fallback margem: {margin.get('fallback_used')}",
            f"No-vig status: {market.get('status')}",
            f"Pesos/componentes: {combined.get('weights_used')}",
        ]
    )


def _component(diagnostic: dict[str, Any], name: str) -> dict[str, Any]:
    components = diagnostic.get("componentes") or {}
    value = components.get(name) or {}
    return value if isinstance(value, dict) else {}


def _component_fallback(diagnostic: dict[str, Any], name: str) -> bool:
    return bool(_component(diagnostic, name).get("fallback_used"))


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None

