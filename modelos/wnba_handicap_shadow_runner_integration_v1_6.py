from __future__ import annotations

from collections import Counter
from typing import Any, Iterable

from modelos.wnba_handicap_probability_engine_v1_5 import (
    MARGIN_FALLBACK_USED,
    OVERCONFIDENCE_FLAG,
    POSSIBLE_PLACEHOLDER_ODD,
    SHADOW_READY,
    VALID_ODD,
    build_handicap_pick_diagnostic,
    classify_odd,
    read_validated_wnba_handicap_pairs,
)
from modelos.wnba_handicap_shadow_v1_4 import VALID_HANDICAP_PAIR


MODEL_VERSION = "WNBA_HANDICAP_SHADOW_V1_6"


def build_wnba_handicap_shadow_diagnostics(
    normalized_rows: Iterable[dict[str, Any]],
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build WNBA Handicap diagnostics without publishing picks."""

    ctx = context or {}
    historical_games = ctx.get("historical_games") or []
    margin_by_game = ctx.get("margin_by_game") or {}
    pairs = read_validated_wnba_handicap_pairs(normalized_rows)

    diagnostics: list[dict[str, Any]] = []
    warnings: list[str] = []
    pair_status_counts: Counter[str] = Counter()
    side_status_counts: Counter[str] = Counter()
    alert_counts: Counter[str] = Counter()
    real_odd_2_count = 0

    for pair in pairs:
        pair_status_counts[pair.status] += 1
        if not pair.is_valid:
            warnings.extend(pair.reasons or [pair.status])
            continue

        if _is_real_odd_two(pair.home_odd, _side_row(pair, "home")):
            real_odd_2_count += 1
        if _is_real_odd_two(pair.away_odd, _side_row(pair, "away")):
            real_odd_2_count += 1

        margin_context = _margin_context_for_pair(pair, margin_by_game)
        for side in ("home", "away"):
            diagnostic = build_handicap_pick_diagnostic(
                pair,
                side,
                historical_games=historical_games,
                mu_margin=margin_context.get(side, {}).get("mu_margin"),
                sigma_margin=margin_context.get(side, {}).get("sigma_margin"),
            )
            item = diagnostic.to_dict()
            item["published"] = False
            item["stake"] = None
            item["model_version"] = MODEL_VERSION
            diagnostics.append(item)
            side_status_counts[diagnostic.status] += 1
            for alert in diagnostic.alertas:
                alert_counts[alert] += 1

    summary = {
        "pairs_analyzed": len(pairs),
        "valid_pairs": pair_status_counts.get(VALID_HANDICAP_PAIR, 0),
        "invalid_pairs": len(pairs) - pair_status_counts.get(VALID_HANDICAP_PAIR, 0),
        "diagnostics_generated": len(diagnostics),
        "shadow_ready": side_status_counts.get(SHADOW_READY, 0),
        "historical_fallback": alert_counts.get("NO_HISTORY", 0) + alert_counts.get("LOW_HISTORY_SAMPLE", 0),
        "margin_fallback": alert_counts.get(MARGIN_FALLBACK_USED, 0),
        "overconfidence_flags": max(
            side_status_counts.get(OVERCONFIDENCE_FLAG, 0),
            alert_counts.get(OVERCONFIDENCE_FLAG, 0),
        ),
        "real_odd_2_00": real_odd_2_count,
        "pair_status_counts": dict(pair_status_counts),
        "side_status_counts": dict(side_status_counts),
        "alert_counts": dict(alert_counts),
    }

    return {
        "enabled": True,
        "mode": "shadow_only",
        "model_version": MODEL_VERSION,
        "published": False,
        "pairs_analyzed": summary["pairs_analyzed"],
        "valid_pairs": summary["valid_pairs"],
        "diagnostics": diagnostics,
        "summary": summary,
        "warnings": sorted(set(warnings)),
    }


def ensure_main_output_has_no_handicap(prognosticos: Iterable[dict[str, Any]]) -> bool:
    for item in prognosticos:
        market = str(item.get("mercado") or "").lower()
        if "handicap" in market:
            return False
    return True


def _is_real_odd_two(value: Any, metadata: dict[str, Any]) -> bool:
    odd = classify_odd(value, metadata)
    return odd.status == VALID_ODD and odd.odd == 2.0


def _side_row(pair: Any, side: str) -> dict[str, Any]:
    from modelos.wnba_handicap_probability_engine_v1_5 import identify_pick_side

    for row in pair.raw_rows:
        if identify_pick_side(row.get("pick"), pair.mandante, pair.visitante) == side:
            return row
    return {}


def _margin_context_for_pair(pair: Any, margin_by_game: dict[str, Any]) -> dict[str, dict[str, float | None]]:
    if not margin_by_game:
        return {"home": {"mu_margin": None, "sigma_margin": None}, "away": {"mu_margin": None, "sigma_margin": None}}

    candidates = [
        pair.jogo,
        f"{pair.mandante} vs {pair.visitante}",
        f"{pair.data}|{pair.hora}|{pair.mandante}|{pair.visitante}",
    ]
    raw = None
    for key in candidates:
        if key in margin_by_game:
            raw = margin_by_game[key]
            break
    if not isinstance(raw, dict):
        return {"home": {"mu_margin": None, "sigma_margin": None}, "away": {"mu_margin": None, "sigma_margin": None}}

    home_mu = raw.get("home_mu_margin", raw.get("mu_margin_home", raw.get("mu_margin")))
    away_mu = raw.get("away_mu_margin", raw.get("mu_margin_away"))
    if away_mu is None and home_mu is not None:
        try:
            away_mu = -float(home_mu)
        except Exception:
            away_mu = None
    sigma = raw.get("sigma_margin")
    return {
        "home": {"mu_margin": home_mu, "sigma_margin": sigma},
        "away": {"mu_margin": away_mu, "sigma_margin": sigma},
    }
