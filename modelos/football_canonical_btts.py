"""Native canonical BTTS canary using the audited MatchMatrix probability core."""

from __future__ import annotations

from typing import Any, Mapping
import math

import numpy as np

import prognosticos_football_real as core


CONTRACT = "football_canonical_btts_shadow@1.0.0"


def _weighted(team: Mapping[str, Any], field: str) -> tuple[float, int]:
    values = []
    for period in ("current_season", "previous_season"):
        block = team[period]
        sample = int(block.get("sample") or 0)
        value = block.get(field)
        if sample > 0 and value is not None and np.isfinite(float(value)):
            values.append((float(value), sample))
    if not values:
        raise ValueError(f"canonical metric unavailable: {field}")
    sample = sum(weight for _, weight in values)
    return sum(value * weight for value, weight in values) / sample, sample


def _team_inputs(team: Mapping[str, Any]) -> dict[str, float | int]:
    gf_venue, sample = _weighted(team, "goals_for")
    ga_venue, _ = _weighted(team, "goals_against")
    btts_venue, _ = _weighted(team, "btts_yes")
    recent = team["recent_overall"]
    recent_sample = int(recent.get("sample") or 0)
    gf, recent_weight = core.blend_venue_with_recent(gf_venue, recent.get("goals_for"), recent_sample)
    ga, _ = core.blend_venue_with_recent(ga_venue, recent.get("goals_against"), recent_sample)
    recent_btts = (100.0 * float(recent.get("btts_yes") or 0) / recent_sample) if recent_sample else None
    btts_pct, btts_recent_weight = core.blend_venue_with_recent(
        100.0 * btts_venue, recent_btts, recent_sample
    )
    return {
        "gf": gf, "ga": ga, "btts_pct": btts_pct, "sample": sample,
        "recent_sample": recent_sample, "recent_weight": recent_weight,
        "btts_recent_weight": btts_recent_weight,
    }


def _consensus(snapshot: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {
        str(row.get("selection_key", "")).lower(): row
        for row in snapshot["markets"].get("consensus", [])
        if row.get("market_family") == "both_teams_to_score"
    }


def infer_canonical_btts(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    home = _team_inputs(snapshot["home"])
    away = _team_inputs(snapshot["away"])
    prior = snapshot["league_prior"]
    expected = core.estimate_expected_goals(
        home["gf"], home["ga"], away["gf"], away["ga"],
        int(home["sample"]), int(away["sample"]),
        float(prior["average_home_goals"]), float(prior["average_away_goals"]),
    )
    matrix = core.gerar_matriz_poisson(expected["lambda_home"], expected["lambda_away"])
    if core.DIXON_COLES_ENABLED:
        matrix = core.aplicar_dixon_coles(
            matrix, expected["lambda_home"], expected["lambda_away"], core.DIXON_COLES_RHO
        )
    model = core.probabilidades_poisson(matrix)["BTTS"]
    history = {
        "Yes": (float(home["btts_pct"]) + float(away["btts_pct"])) / 2.0,
        "No": 100.0 - (float(home["btts_pct"]) + float(away["btts_pct"])) / 2.0,
    }
    blended = core.combinar_modelo_historico(
        history, model, min(int(home["sample"]), int(away["sample"])), core.MAX_HISTORY_WEIGHT_BTTS
    )
    yes, no = core.calibrar_par(blended["Yes"], "btts")
    consensus = _consensus(snapshot)
    outputs = []
    for key, probability in (("yes", yes), ("no", no)):
        quote = consensus.get(key)
        offered = None if quote is None else float(quote["best_odds"])
        fair = 100.0 / probability if probability > 0 else None
        edge = None if offered is None else offered * probability / 100.0 - 1.0
        eligible = offered is not None and core.MIN_ODD_FOOTBALL_V1_1 <= offered <= core.MAX_ODD_FOOTBALL_V1_1
        outputs.append({
            "mercado": "Ambas Marcam", "pick": "Sim" if key == "yes" else "Não",
            "linha": None, "probabilidade_final": round(probability, 4),
            "odd_valor": None if fair is None else round(fair, 4),
            "odd_ofertada": offered, "edge": None if edge is None else round(edge, 6),
            "decision": "SHADOW_CANDIDATE" if eligible and edge >= core.MIN_EDGE_FOOTBALL_V1_1 else "PASS",
        })
    return {
        "contract": CONTRACT, "mode": "shadow", "provider_calls": 0, "published": False,
        "lambda_home": round(expected["lambda_home"], 6),
        "lambda_away": round(expected["lambda_away"], 6),
        "history_btts_yes": round(history["Yes"], 4),
        "model_btts_yes": round(model["Yes"], 4),
        "inputs": {"home": home, "away": away, "league_prior_sample": prior.get("sample")},
        "predictions": outputs,
    }
