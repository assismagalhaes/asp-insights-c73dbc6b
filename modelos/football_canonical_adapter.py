"""Shadow-only adapter from canonical Highlightly snapshots to MatchMatrix input.

This module performs no provider, database, filesystem, model, training, or
publication operation. It only validates and maps an already materialized
prematch snapshot in memory.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Mapping
from uuid import UUID

import pandas as pd

from football_adapter import converter_dataframe_longo_para_wide


SCHEMA_VERSION = "highlightly_football_prematch@2.0.0"
ADAPTER_VERSION = "football_matchmatrix_canonical_adapter@1.0.0"
READY_STATE = "READY"

FAMILY_TO_MARKET = {
    "full_time_result": "1x2",
    "total_goals": "total gols",
    "both_teams_to_score": "ambas marcam",
    "double_chance": "dupla chance",
    "asian_handicap": "handicap asiatico",
}


def _utc(value: Any, field: str) -> datetime:
    text = str(value or "").strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _uuid(value: Any, field: str) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValueError(f"{field} must be a canonical UUID") from exc


def _canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _line_key(value: Any) -> str:
    if value in (None, ""):
        return ""
    return f"{float(value):.1f}"


def _pick(family: str, selection: str, identity: Mapping[str, Any]) -> str:
    key = selection.strip().lower().replace(" ", "")
    if family == "full_time_result":
        return {
            "home": str(identity["home_name"]),
            "1": str(identity["home_name"]),
            "draw": "Empate",
            "x": "Empate",
            "away": str(identity["away_name"]),
            "2": str(identity["away_name"]),
        }.get(key, selection)
    if family == "both_teams_to_score":
        return {"yes": "Sim", "no": "Nao"}.get(key, selection)
    if family == "total_goals":
        return {"over": "Over", "under": "Under"}.get(key, selection)
    if family == "double_chance":
        return key.upper()
    if family == "asian_handicap":
        return {
            "home": str(identity["home_name"]),
            "1": str(identity["home_name"]),
            "away": str(identity["away_name"]),
            "2": str(identity["away_name"]),
        }.get(key, selection)
    return selection


def _validate(snapshot: Mapping[str, Any], identity: Mapping[str, Any]) -> dict[str, str]:
    if snapshot.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("unsupported canonical feature schema")
    if snapshot.get("quality", {}).get("match_state") != READY_STATE:
        raise ValueError("canonical adapter accepts READY snapshots only")
    if snapshot.get("lineage", {}).get("provider_calls") is not False:
        raise ValueError("snapshot must be stored-data-only")
    if snapshot.get("lineage", {}).get("target_match_forbidden") is not True:
        raise ValueError("snapshot does not certify target-match exclusion")

    match = snapshot.get("match") or {}
    ids = {
        "match_id": _uuid(match.get("match_id"), "match.match_id"),
        "competition_id": _uuid(match.get("competition_id"), "match.competition_id"),
        "season_id": _uuid(match.get("season_id"), "match.season_id"),
        "home_team_id": _uuid(match.get("home_team_id"), "match.home_team_id"),
        "away_team_id": _uuid(match.get("away_team_id"), "match.away_team_id"),
    }
    for key, expected in ids.items():
        if key in identity and str(identity[key]) != expected:
            raise ValueError(f"identity {key} does not match canonical snapshot")
    for field in ("competition_name", "country", "home_name", "away_name"):
        if not str(identity.get(field) or "").strip():
            raise ValueError(f"identity.{field} is required")

    kickoff = _utc(match.get("kickoff_at"), "match.kickoff_at")
    cutoff = _utc(snapshot.get("cutoff", {}).get("cutoff_at"), "cutoff.cutoff_at")
    source_max = _utc(snapshot.get("lineage", {}).get("source_max_at"), "lineage.source_max_at")
    if not source_max <= cutoff < kickoff:
        raise ValueError("canonical temporal invariant source_max_at <= cutoff_at < kickoff_at failed")

    target = ids["match_id"]
    history_ids: list[str] = []
    for section in ("home", "away"):
        for component in ("current_season", "previous_season", "recent_overall", "recent_venue"):
            history_ids.extend(str(x) for x in snapshot.get(section, {}).get(component, {}).get("match_ids", []))
    history_ids.extend(str(x) for x in snapshot.get("h2h", {}).get("match_ids", []))
    history_ids.extend(str(x) for x in snapshot.get("league_prior", {}).get("match_ids", []))
    if target in history_ids:
        raise ValueError("target match leaked into historical components")
    return ids


def canonical_snapshot_to_matchmatrix(
    snapshot: Mapping[str, Any], identity: Mapping[str, Any]
) -> dict[str, Any]:
    """Return deterministic long rows, a wide row and an audit manifest."""
    snapshot = deepcopy(dict(snapshot))
    identity = deepcopy(dict(identity))
    ids = _validate(snapshot, identity)
    match = snapshot["match"]
    kickoff = _utc(match["kickoff_at"], "match.kickoff_at")

    quotes = snapshot.get("markets", {}).get("quotes", [])
    consensus = snapshot.get("markets", {}).get("consensus", [])
    consensus_by_key = {
        (
            str(item.get("market_family") or ""),
            str(item.get("selection_key") or ""),
            _line_key(item.get("line_value")),
        ): item
        for item in consensus
    }

    best_by_key: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    for quote in quotes:
        family = str(quote.get("market_family") or "")
        selection = str(quote.get("selection_key") or "")
        line = _line_key(quote.get("line_value"))
        key = (family, selection, line)
        if family not in FAMILY_TO_MARKET:
            continue
        try:
            odd = float(quote.get("decimal_odds"))
        except (TypeError, ValueError):
            continue
        if odd <= 1:
            continue
        current = best_by_key.get(key)
        if current is None or odd > float(current["decimal_odds"]):
            best_by_key[key] = quote

    long_rows: list[dict[str, Any]] = []
    for key in sorted(best_by_key):
        family, selection, line_key = key
        quote = best_by_key[key]
        market_consensus = consensus_by_key.get(key, {})
        line_value = quote.get("line_value")
        row = {
            "data": kickoff.strftime("%Y-%m-%d"),
            "hora": kickoff.strftime("%H:%M"),
            "esporte": "football",
            "country": identity["country"],
            "liga": identity["competition_name"],
            "jogo": f"{identity['home_name']} vs {identity['away_name']}",
            "mandante": identity["home_name"],
            "visitante": identity["away_name"],
            "mercado": FAMILY_TO_MARKET[family],
            "pick": _pick(family, selection, identity),
            "linha": line_value,
            "odd": float(quote["decimal_odds"]),
            "odd_melhor": float(market_consensus.get("best_odds", quote["decimal_odds"])),
            "odd_mediana": market_consensus.get("median_odds"),
            "bookmaker": quote.get("bookmaker_key") or quote.get("bookmaker_id"),
            "bookmaker_melhor": quote.get("bookmaker_key") or quote.get("bookmaker_id"),
            "fonte": "highlightly_canonical_snapshot",
            "odds_consistency_status": "valid",
            **ids,
            "cutoff_at": snapshot["cutoff"]["cutoff_at"],
            "source_max_at": snapshot["lineage"]["source_max_at"],
            "market_family": family,
            "selection_key": selection,
        }
        long_rows.append(row)

    if not long_rows:
        raise ValueError("canonical snapshot has no executable market quotes")

    wide = converter_dataframe_longo_para_wide(pd.DataFrame(long_rows))
    if len(wide.index) != 1:
        raise ValueError("one canonical snapshot must produce exactly one MatchMatrix row")
    wide_row = wide.iloc[0].to_dict()
    wide_row.update(ids)
    wide_row["canonical_source_fingerprint"] = snapshot.get("fingerprint")
    manifest = {
        "adapter_version": ADAPTER_VERSION,
        "source_schema_version": SCHEMA_VERSION,
        "source_fingerprint": snapshot.get("fingerprint"),
        "match_id": ids["match_id"],
        "cutoff_at": snapshot["cutoff"]["cutoff_at"],
        "source_max_at": snapshot["lineage"]["source_max_at"],
        "provider_calls": 0,
        "automatic_training": False,
        "automatic_predictions": False,
        "long_row_count": len(long_rows),
        "adapter_output_fingerprint": _canonical_hash({"long_rows": long_rows, "wide_row": wide_row}),
    }
    return {"long_rows": long_rows, "wide_row": wide_row, "manifest": manifest}
