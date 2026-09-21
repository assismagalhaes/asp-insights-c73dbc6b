"""Native canonical 1X2 shadow inference over a frozen prematch snapshot."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import prognosticos_football_real as core

from football_canonical_btts import _metric_value, _team_inputs


CONTRACT = "football_canonical_1x2_shadow@1.0.0"
MIN_ODD = 1.25
MAX_ODD = 2.00
MIN_EDGE = 0.03


def _rate(team: Mapping[str, Any], field: str) -> tuple[float, int]:
    total = 0.0
    sample_total = 0
    for period in ("current_season", "previous_season"):
        block = team[period]
        sample = int(block.get("sample") or 0)
        value = _metric_value(block.get(field))
        if sample > 0 and value is not None:
            total += value
            sample_total += sample
    if sample_total == 0:
        raise ValueError(f"canonical metric unavailable: {field}")
    return 100.0 * total / sample_total, sample_total


def _consensus(snapshot: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    aliases = {
        "home": "home", "1": "home",
        "draw": "draw", "x": "draw",
        "away": "away", "2": "away",
    }
    result = {}
    for row in snapshot["markets"].get("consensus", []):
        if row.get("market_family") != "full_time_result":
            continue
        key = aliases.get(str(row.get("selection_key", "")).lower())
        if key:
            result[key] = row
    return result


def infer_canonical_1x2(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    home = _team_inputs(snapshot["home"])
    away = _team_inputs(snapshot["away"])
    prior = snapshot["league_prior"]
    expected = core.estimate_expected_goals(
        home["gf"], home["ga"], away["gf"], away["ga"],
        int(home["sample"]), int(away["sample"]),
        float(prior["average_home_goals"]),
        float(prior["average_away_goals"]),
    )
    matrix = core.gerar_matriz_poisson(
        expected["lambda_home"], expected["lambda_away"]
    )
    if core.DIXON_COLES_ENABLED:
        matrix = core.aplicar_dixon_coles(
            matrix, expected["lambda_home"], expected["lambda_away"],
            core.DIXON_COLES_RHO,
        )
    model = core.probabilidades_poisson(matrix)["Resultado"]
    home_wins, home_sample = _rate(snapshot["home"], "wins")
    away_wins, away_sample = _rate(snapshot["away"], "wins")
    home_draws, _ = _rate(snapshot["home"], "draws")
    away_draws, _ = _rate(snapshot["away"], "draws")
    history = {
        "Casa": home_wins,
        "Empate": (home_draws + away_draws) / 2.0,
        "Fora": away_wins,
    }
    probabilities = core.combinar_modelo_historico(
        history, model, min(home_sample, away_sample),
        core.MAX_HISTORY_WEIGHT_1X2, calibration_key="1x2",
    )
    consensus = _consensus(snapshot)
    outputs = []
    for key, label, model_key in (
        ("home", "Casa", "Casa"),
        ("draw", "Empate", "Empate"),
        ("away", "Fora", "Fora"),
    ):
        probability = float(probabilities[model_key])
        quote = consensus.get(key)
        offered = None if quote is None else float(quote["best_odds"])
        fair = 100.0 / probability if probability > 0 else None
        edge = None if offered is None else offered * probability / 100.0 - 1.0
        eligible = offered is not None and MIN_ODD <= offered <= MAX_ODD
        outputs.append({
            "mercado": "1X2", "pick": label, "selection_key": key,
            "linha": None, "probabilidade_final": round(probability, 4),
            "odd_valor": None if fair is None else round(fair, 4),
            "odd_ofertada": offered,
            "edge": None if edge is None else round(edge, 6),
            "decision": (
                "SHADOW_CANDIDATE" if eligible and edge >= MIN_EDGE else "PASS"
            ),
        })
    return {
        "contract": CONTRACT, "mode": "shadow", "provider_calls": 0,
        "published": False,
        "lambda_home": round(expected["lambda_home"], 6),
        "lambda_away": round(expected["lambda_away"], 6),
        "history_1x2": {key: round(value, 4) for key, value in history.items()},
        "model_1x2": {key: round(float(value), 4) for key, value in model.items()},
        "inputs": {
            "home": home, "away": away,
            "league_prior_sample": prior.get("sample"),
        },
        "predictions": outputs,
    }
