from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping, Sequence


LONG_COLUMNS = (
    "data", "hora", "esporte", "country", "liga", "jogo", "mandante",
    "visitante", "mercado", "pick", "linha", "odd", "bookmaker", "fonte",
    "odd_melhor", "odd_mediana", "bookmaker_melhor", "odds_consistency_status",
)

MARKET_NAMES = {
    "moneyline": "Resultado Final",
    "double_chance": "Dupla Chance",
    "total": "Total de Gols",
    "both_teams_to_score": "Ambas Marcam",
    "handicap": "Handicap Asiatico",
}


def _football_pick(candidate: Mapping[str, Any], home: str, away: str) -> str:
    """Map provider selection keys to the public MatchMatrix pick contract."""

    key = str(candidate.get("selection_key") or "").strip().lower()
    if str(candidate.get("market_family") or "").strip().lower() == "moneyline":
        if key in {"home", "1", "home_win"}:
            return home
        if key in {"away", "2", "away_win"}:
            return away
        if key in {"draw", "x", "tie"}:
            return "Empate"
    return str(candidate.get("selection_name") or candidate.get("selection_key") or "").strip()


def central_candidates_to_long_rows(candidates: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for candidate in candidates:
        family = str(candidate.get("market_family") or "").strip().lower()
        market = MARKET_NAMES.get(family)
        if not market:
            continue
        home = str(candidate.get("home") or "").strip()
        away = str(candidate.get("away") or "").strip()
        if not home or not away:
            continue
        median = _positive_odd(candidate.get("median_odds"))
        best = _positive_odd(candidate.get("best_odds"))
        if median is None or best is None:
            continue
        row = {
            "data": candidate.get("match_date"),
            "hora": candidate.get("match_time"),
            "esporte": "Football",
            "country": candidate.get("country") or "",
            "liga": candidate.get("league") or "",
            "jogo": f"{home} vs {away}",
            "mandante": home,
            "visitante": away,
            "mercado": market,
            "pick": _football_pick(candidate, home, away),
            "linha": candidate.get("line_value"),
            "odd": median,
            "bookmaker": candidate.get("best_bookmaker") or "consensus",
            "fonte": "Highlightly/Central Esportiva",
            "odd_melhor": best,
            "odd_mediana": median,
            "bookmaker_melhor": candidate.get("best_bookmaker") or "",
            "odds_consistency_status": "OK" if int(candidate.get("bookmaker_count") or 0) >= 2 else "QUORUM_INSUFICIENTE",
        }
        rows.append(row)
    return rows


def write_long_csv(rows: Sequence[Mapping[str, Any]], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=LONG_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(destination)


def build_storage_payload(candidates: Sequence[Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    matches: list[dict[str, Any]] = []
    odds: list[dict[str, Any]] = []
    seen_matches: set[str] = set()
    for item in candidates:
        if str(item.get("market_family") or "").strip().lower() not in MARKET_NAMES:
            continue
        match_id = str(item["match_id"])
        if match_id not in seen_matches:
            seen_matches.add(match_id)
            matches.append({
                "match_id": match_id,
                "date": item.get("match_date"),
                "time": item.get("match_time"),
                "country": item.get("country"),
                "league": item.get("league"),
                "home": item.get("home"),
                "away": item.get("away"),
            })
        odds.append({
            "match_id": match_id,
            "market_key": item.get("market_family"),
            "selection_key": item.get("selection_key"),
            "line_key": item.get("line_key") or "",
            "line_value": item.get("line_value"),
            "decimal_odds": item.get("best_odds"),
            "bookmaker": item.get("best_bookmaker"),
            "source_kind": "highlightly",
            "observed_at": item.get("snapshot_at"),
            "source_lineage": {
                "market_definition_id": item.get("market_definition_id"),
                "median_odds": item.get("median_odds"),
                "bookmaker_count": item.get("bookmaker_count"),
            },
        })
    return {"matches": matches, "features": [], "odds": odds}


def compare_shadow_results(
    central: Mapping[str, Any], traditional: Mapping[str, Any] | None
) -> dict[str, Any]:
    central_predictions = list(central.get("prognosticos") or [])
    traditional_predictions = list((traditional or {}).get("prognosticos") or [])
    central_index = {_prediction_key(row): row for row in central_predictions}
    traditional_index = {_prediction_key(row): row for row in traditional_predictions}
    shared = sorted(central_index.keys() & traditional_index.keys())
    probability_deltas = []
    for key in shared:
        left = _number(central_index[key].get("probabilidade_final"))
        right = _number(traditional_index[key].get("probabilidade_final"))
        if left is not None and right is not None:
            probability_deltas.append(abs(left - right))
    return {
        "mode": "shadow",
        "automatic_publication": False,
        "central_prediction_count": len(central_predictions),
        "traditional_prediction_count": len(traditional_predictions),
        "shared_prediction_count": len(shared),
        "central_only": len(central_index.keys() - traditional_index.keys()),
        "traditional_only": len(traditional_index.keys() - central_index.keys()),
        "maximum_probability_delta": max(probability_deltas, default=None),
        "identical_predictions": bool(traditional is not None) and central_index == traditional_index,
        "central_result_sha256": _sha256(central_predictions),
        "traditional_result_sha256": _sha256(traditional_predictions) if traditional is not None else None,
    }


def coverage_report(candidates: Sequence[Mapping[str, Any]], rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    match_ids = {str(item["match_id"]) for item in candidates}
    usable_ids = {
        str(item["match_id"])
        for item in candidates
        if MARKET_NAMES.get(str(item.get("market_family") or "").lower())
    }
    return {
        "candidate_matches": len(match_ids),
        "usable_matches": len(usable_ids),
        "candidate_odds": len(candidates),
        "generated_rows": len(rows),
        "coverage_ratio": (len(usable_ids) / len(match_ids)) if match_ids else 0.0,
    }


def missing_required_fields(rows: Sequence[Mapping[str, Any]]) -> list[str]:
    required = (
        "data", "hora", "esporte", "liga", "jogo", "mandante", "visitante",
        "mercado", "pick", "odd", "bookmaker", "fonte",
    )
    return [field for field in required if any(row.get(field) in (None, "") for row in rows)]


def _prediction_key(row: Mapping[str, Any]) -> str:
    return "|".join(str(row.get(key) or "").strip().casefold() for key in ("data", "jogo", "mercado", "pick", "linha"))


def _sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _positive_odd(value: Any) -> float | None:
    parsed = _number(value)
    return parsed if parsed is not None and parsed > 1 else None


def _number(value: Any) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None
