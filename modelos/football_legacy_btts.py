"""Offline BTTS replay adapter for a frozen Football-Data baseline."""

from __future__ import annotations

from typing import Any, Mapping

import numpy as np
import pandas as pd

import prognosticos_football_real as core


CONTRACT = "football_legacy_btts_shadow@1.0.0"
LEAGUE_MAP = {"Premier League": "ENG - Premier League", "La Liga": "SPA - La Liga"}
LEGACY_TEAM_NAMES = {
    "athletic club": "Ath Bilbao",
    "atletico madrid": "Ath Madrid",
    "manchester united": "Man United",
}
MIN_ODD = 1.25
MAX_ODD = 2.00
MIN_EDGE = 0.03


def _consensus(snapshot: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {
        str(row.get("selection_key", "")).lower(): row
        for row in snapshot["markets"].get("consensus", [])
        if row.get("market_family") == "both_teams_to_score"
    }


def _legacy_team_name(name: str) -> str:
    return LEGACY_TEAM_NAMES.get(core.normalize_str(name), name)


def infer_legacy_btts(
    legacy_artifact: Mapping[str, Any], canonical_artifact: Mapping[str, Any]
) -> dict[str, Any]:
    identity = canonical_artifact["identity"]
    if legacy_artifact["match_id"] != identity["match_id"]:
        raise ValueError("legacy and canonical match_id differ")
    history = legacy_artifact["history"]
    frames = [pd.DataFrame(history[name]) for name in ("current", "previous", "extra")]
    base = core.clean_completed_matches(pd.concat(frames, ignore_index=True))
    kickoff = pd.to_datetime(canonical_artifact["dataset_row"]["kickoff_at"], utc=True)
    core.configure_reference_date(kickoff)
    quotes = _consensus(canonical_artifact["snapshot"])
    odds = {
        key: (float(quotes[key]["best_odds"]) if key in quotes else np.nan)
        for key in ("yes", "no")
    }
    result = core.analyze_match(
        base=base,
        home_team=_legacy_team_name(identity["home_name"]),
        away_team=_legacy_team_name(identity["away_name"]),
        kickoff_date=kickoff.strftime("%Y-%m-%d"),
        kickoff_time=kickoff.strftime("%H:%M"),
        league_key=LEAGUE_MAP[identity["competition_name"]],
        odds_full_time={"home": np.nan, "draw": np.nan, "away": np.nan},
        odds_ou={},
        odds_bt=odds,
        odds_double_chance={"1X": np.nan, "12": np.nan, "X2": np.nan},
        odds_handicap={"casa": {}, "fora": {}},
    )
    predictions = []
    for key, label in (("Yes", "Sim"), ("No", "Não")):
        probability = float(result[f"Prob_BTTS_{key}"])
        fair = float(result[f"OddValor_BTTS_{key}"])
        offered_raw = result[f"OddReal_BTTS_{key}"]
        offered = None if pd.isna(offered_raw) else float(offered_raw)
        edge = None if offered is None else offered * probability / 100.0 - 1.0
        eligible = offered is not None and MIN_ODD <= offered <= MAX_ODD
        predictions.append({
            "mercado": "Ambas Marcam",
            "pick": label,
            "linha": None,
            "probabilidade_final": round(probability, 4),
            "odd_valor": round(fair, 4),
            "odd_ofertada": offered,
            "edge": None if edge is None else round(edge, 6),
            "decision": "SHADOW_CANDIDATE" if eligible and edge >= MIN_EDGE else "PASS",
        })
    return {
        "contract": CONTRACT,
        "mode": "shadow",
        "provider_calls": 0,
        "published": False,
        "lambda_home": result["Lambda_Home_Final"],
        "lambda_away": result["Lambda_Away_Final"],
        "source_data_cutoff": result["Source_Data_Cutoff"],
        "sample_home": result["Sample_Home"],
        "sample_away": result["Sample_Away"],
        "predictions": predictions,
    }
