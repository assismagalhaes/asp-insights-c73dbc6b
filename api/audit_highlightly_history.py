"""Read-only Highlightly historical/statistics capability probe."""
from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(__file__))
from highlightly_client import HighlightlyClient, HighlightlyError
from highlightly_quality import audit_standings

SPORTS = ("football", "basketball", "baseball")
DEFAULT_DATES = ("2026-08-01",)


def items(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, Mapping):
        for key in ("data", "matches", "results", "groups", "standings", "teams", "players"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def first_id(value: Any) -> Any:
    return value.get("id") if isinstance(value, Mapping) else None


def parse_dates(value: str | None) -> tuple[str, ...]:
    candidates = [item.strip() for item in (value or ",".join(DEFAULT_DATES)).split(",") if item.strip()]
    if not candidates:
        raise ValueError("At least one audit date is required")
    for candidate in candidates:
        date.fromisoformat(candidate)
    return tuple(dict.fromkeys(candidates))


def player_ids(sport: str, payload: Any) -> list[Any]:
    found: set[Any] = set()
    for team_block in items(payload):
        if not isinstance(team_block, Mapping):
            continue
        if sport == "football":
            candidates = team_block.get("players")
        elif sport == "baseball":
            candidates = team_block.get("boxScores")
        else:
            candidates = None
        for candidate in candidates if isinstance(candidates, list) else []:
            if not isinstance(candidate, Mapping):
                continue
            player = candidate.get("player") if isinstance(candidate.get("player"), Mapping) else candidate
            player_id = first_id(player)
            if player_id is not None:
                found.add(player_id)
    return sorted(found, key=str)


def league_identity(sport: str, match: Mapping[str, Any]) -> tuple[str, str, Any, Any] | None:
    if sport == "baseball":
        league_name = match.get("league")
        season = match.get("season")
        if league_name and season is not None:
            return (str(league_name), str(season), league_name, season)
        return None
    league = match.get("league") if isinstance(match.get("league"), Mapping) else {}
    league_id = league.get("id")
    season = league.get("season")
    if league_id is None or season is None:
        return None
    league_name = league.get("name") or league.get("leagueName") or league_id
    return (str(league_name), str(season), league_id, season)


def standings_request(sport: str, league: tuple[str, str, Any, Any]) -> tuple[str, dict[str, Any]]:
    _, _, provider_league, season = league
    if sport == "baseball":
        return "/baseball/standings", {"leagueName": provider_league, "year": season, "limit": 100, "offset": 0}
    return f"/{sport}/standings", {"leagueId": provider_league, "season": season}


def standing_entries(payload: Any) -> list[Mapping[str, Any]]:
    found: list[Mapping[str, Any]] = []
    for document in items(payload):
        if not isinstance(document, Mapping):
            continue
        direct_rows = document.get("standings")
        if isinstance(direct_rows, list):
            found.extend(row for row in direct_rows if isinstance(row, Mapping))
            continue
        groups = document.get("groups")
        if not isinstance(groups, list):
            groups = document.get("data") if isinstance(document.get("data"), list) else []
        for group in groups:
            if not isinstance(group, Mapping):
                continue
            rows = group.get("standings")
            if not isinstance(rows, list):
                rows = group.get("data") if isinstance(group.get("data"), list) else []
            found.extend(row for row in rows if isinstance(row, Mapping))
    return found


def standings_quality_codes(sport: str, league: str | None, payload: Any) -> list[str]:
    codes: set[str] = set()
    documents = [row for row in items(payload) if isinstance(row, Mapping)]
    if not standing_entries(payload):
        codes.add("STANDINGS_EMPTY")
    for document in documents:
        quality_document = document
        if isinstance(document.get("standings"), list):
            quality_document = {"groups": [document]}
        codes.update(issue.code for issue in audit_standings(quality_document))
    normalized_league = (league or "").casefold()
    if sport == "basketball" and ("nba women" in normalized_league or "wnba" in normalized_league):
        codes.add("BASKETBALL_STANDINGS_PROVIDER_QUARANTINED")
    return sorted(codes)


@dataclass
class AuditState:
    max_calls: int
    reserve: int
    calls: int = 0
    rate_limit: int | None = None
    rate_remaining: int | None = None
    records: list[dict[str, Any]] = field(default_factory=list)

    def can_call(self) -> bool:
        return self.calls < self.max_calls and (
            self.rate_remaining is None or self.rate_remaining > self.reserve
        )


def probe(
    client: HighlightlyClient,
    state: AuditState,
    sport: str,
    label: str,
    path: str,
    params: Mapping[str, Any],
    *,
    audit_date: str | None = None,
    league: str | None = None,
) -> Any:
    if not state.can_call():
        raise RuntimeError("Audit call budget or provider reserve reached")
    started = time.perf_counter()
    state.calls += 1
    record: dict[str, Any] = {
        "sport": sport,
        "endpoint": label,
        "date": audit_date,
        "league": league,
        "status": None,
        "latency_ms": None,
        "rows": 0,
        "fields": [],
    }
    try:
        response = client.get(path, params=params)
        rows = items(response.data)
        record.update(
            {
                "status": response.status,
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "rows": len(rows),
                "fields": sorted(rows[0].keys())[:20]
                if rows and isinstance(rows[0], Mapping)
                else [],
            }
        )
        if label == "standings":
            record["standing_rows"] = len(standing_entries(response.data))
            record["quality_codes"] = standings_quality_codes(sport, league, response.data)
        state.rate_limit = response.rate_limit
        state.rate_remaining = response.rate_remaining
        state.records.append(record)
        print(
            f"{sport}\t{label}\t{response.status}\t{record['latency_ms']}ms\t{len(rows)}\t"
            f"{','.join(record['fields'])}\tquota={response.rate_remaining}/{response.rate_limit}"
        )
        return response.data
    except HighlightlyError as exc:
        record.update(
            {
                "status": exc.status,
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "error": str(exc),
            }
        )
        state.records.append(record)
        print(f"{sport}\t{label}\t{exc.status}\t{record['latency_ms']}ms\t0\tERROR\t{exc}")
        return None


def build_summary(state: AuditState, dates: tuple[str, ...]) -> dict[str, Any]:
    league_rows: dict[tuple[str, str], dict[str, Any]] = {}
    for record in state.records:
        league = record.get("league")
        if not league:
            continue
        key = (record["sport"], league)
        row = league_rows.setdefault(
            key,
            {"sport": record["sport"], "league": league, "dates": set(), "endpoints": {}},
        )
        if record.get("date"):
            row["dates"].add(record["date"])
        row["endpoints"][record["endpoint"]] = record["status"]
    coverage = []
    for row in league_rows.values():
        row["dates"] = sorted(row["dates"])
        coverage.append(row)
    coverage.sort(key=lambda row: (row["sport"], row["league"]))
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dates": list(dates),
        "calls": state.calls,
        "max_calls": state.max_calls,
        "reserve": state.reserve,
        "rate_limit": state.rate_limit,
        "rate_remaining": state.rate_remaining,
        "records": state.records,
        "league_coverage": coverage,
    }


def main() -> None:
    dates = parse_dates(os.environ.get("HIGHLIGHTLY_AUDIT_DATES") or os.environ.get("HIGHLIGHTLY_AUDIT_DATE"))
    max_calls = int(os.environ.get("HIGHLIGHTLY_AUDIT_MAX_CALLS", "100"))
    reserve = int(os.environ.get("HIGHLIGHTLY_AUDIT_RESERVE", "750"))
    matches_per_date = int(os.environ.get("HIGHLIGHTLY_AUDIT_MATCH_LIMIT", "5"))
    output_path = os.environ.get("HIGHLIGHTLY_AUDIT_OUTPUT")
    state = AuditState(max_calls=max_calls, reserve=reserve)
    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
    )
    detailed_leagues: set[tuple[str, str, str]] = set()
    player_probed: set[str] = set()
    standings_probed: set[tuple[str, str, str]] = set()
    print("sport\tendpoint\tstatus\tlatency\trows\tfields\tquota")
    try:
        for audit_date in dates:
            for sport in SPORTS:
                matches_payload = probe(
                    client,
                    state,
                    sport,
                    "matches",
                    f"/{sport}/matches",
                    {"date": audit_date, "limit": matches_per_date},
                    audit_date=audit_date,
                )
                for match in items(matches_payload):
                    if not isinstance(match, Mapping):
                        continue
                    league = league_identity(sport, match)
                    league_name = f"{league[0]}:{league[1]}" if league else "unknown"
                    state.records.append(
                        {
                            "sport": sport,
                            "endpoint": "match_coverage",
                            "date": audit_date,
                            "league": league_name,
                            "status": 200,
                            "rows": 1,
                            "fields": [],
                            "latency_ms": 0,
                        }
                    )
                    if league:
                        standings_key = (sport, league[0], league[1])
                        if standings_key not in standings_probed:
                            path, params = standings_request(sport, league)
                            probe(
                                client,
                                state,
                                sport,
                                "standings",
                                path,
                                params,
                                audit_date=audit_date,
                                league=league_name,
                            )
                            standings_probed.add(standings_key)
                    detail_key = (sport, audit_date, "sample")
                    if detail_key in detailed_leagues:
                        continue
                    detailed_leagues.add(detail_key)
                    match_id = first_id(match)
                    if match_id is None:
                        continue
                    probe(client, state, sport, "match_detail", f"/{sport}/matches/{match_id}", {}, audit_date=audit_date, league=league_name)
                    probe(client, state, sport, "match_statistics", f"/{sport}/statistics/{match_id}", {}, audit_date=audit_date, league=league_name)
                    box_payload = None
                    if sport == "football":
                        box_payload = probe(client, state, sport, "box_scores", f"/{sport}/box-score/{match_id}", {}, audit_date=audit_date, league=league_name)
                    elif sport == "baseball":
                        box_payload = probe(client, state, sport, "box_scores", f"/{sport}/box-scores/{match_id}", {}, audit_date=audit_date, league=league_name)
                    home = match.get("homeTeam") or match.get("home") or {}
                    team_id = first_id(home)
                    if team_id is not None:
                        probe(client, state, sport, "team_statistics", f"/{sport}/teams/statistics/{team_id}", {"fromDate": audit_date}, audit_date=audit_date, league=league_name)
                        probe(client, state, sport, "last_five_games", f"/{sport}/last-five-games", {"teamId": team_id}, audit_date=audit_date, league=league_name)
                    if sport not in player_probed:
                        ids = player_ids(sport, box_payload)
                        if ids:
                            probe(client, state, sport, "player_statistics", f"/{sport}/players/{ids[0]}/statistics", {}, audit_date=audit_date, league=league_name)
                            player_probed.add(sport)
    except RuntimeError as exc:
        print(f"audit\tbudget\tSTOP\t0ms\t0\tERROR\t{exc}")
    summary = build_summary(state, dates)
    if output_path:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"audit\toutput\tOK\t0ms\t{len(summary['records'])}\t{path}\tquota={state.rate_remaining}/{state.rate_limit}")


if __name__ == "__main__":
    main()
