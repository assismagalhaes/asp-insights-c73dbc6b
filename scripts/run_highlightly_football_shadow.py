"""Execute one bounded Football shadow and always restore the provider kill switch."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from typing import Any, Mapping
from uuid import uuid4

from api.highlightly.worker import HighlightlyWorker
from api.highlightly_client import HighlightlyClient
from api.highlightly_repository import HighlightlyRepository


MATCH_ENDPOINT = "football.MatchesController_getMatchById"
DISCOVERY_ENDPOINT = "football.MatchesController_getMatches"


def _payload_items(payload: Any) -> list[Mapping[str, Any]]:
    if not isinstance(payload, Mapping):
        return []
    data = payload.get("data")
    return [item for item in data if isinstance(item, Mapping)] if isinstance(data, list) else []


def _discover_match(
    client: HighlightlyClient,
    repository: HighlightlyRepository,
    provider_id: str,
    sport_id: str,
    requested_date: date | None,
) -> tuple[str, dict[str, Any]]:
    start = requested_date or datetime.now(timezone.utc).date()
    for offset in range(3):
        match_date = start + timedelta(days=offset)
        params = {"date": match_date.isoformat(), "timezone": "America/Sao_Paulo", "limit": 100, "offset": 0}
        response = client.get("/football/matches", params)
        repository.store_raw_payload(
            response.data,
            provider_id=provider_id,
            sport_id=sport_id,
            sport="football",
            endpoint_key=DISCOVERY_ENDPOINT,
            request_metadata={"path": "/football/matches", "params": params, "purpose": "bounded_shadow_discovery"},
            response_metadata={"status": response.status, "content_type": response.content_type},
            retention_until=(datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
        )
        repository.upsert_rows(
            "hl_rate_limit_usage",
            [{
                "provider_id": provider_id,
                "endpoint_key": DISCOVERY_ENDPOINT,
                "requests_used": 1,
                "rate_limit": response.rate_limit,
                "rate_remaining": response.rate_remaining,
            }],
            on_conflict="id",
        )
        matches = _payload_items(response.data)
        if not matches:
            continue
        preferred = next(
            (
                match
                for match in matches
                if str((match.get("state") or {}).get("description") or "").casefold()
                in {"not started", "in progress", "first half", "second half", "half time"}
            ),
            matches[0],
        )
        return str(preferred["id"]), dict(preferred)
    raise RuntimeError("No Football match was returned for the requested three-day discovery window")


def _assert_empty_queue(repository: HighlightlyRepository) -> None:
    occupied: dict[str, str] = {}
    for status in ("pending", "retry", "running"):
        rows = repository.select_rows(
            "hl_ingestion_jobs",
            columns="id,status,endpoint_key",
            filters={"status": status},
            limit=1,
        )
        if rows:
            occupied[status] = str(rows[0].get("endpoint_key"))
    if occupied:
        raise RuntimeError(f"Ingestion queue is not isolated for shadow: {occupied}")


def _count(repository: HighlightlyRepository, table: str, filters: Mapping[str, Any]) -> int:
    return len(repository.select_rows(table, columns="id", filters=filters))


def _validate_shadow(
    repository: HighlightlyRepository,
    *,
    provider_id: str,
    sport_id: str,
    external_match_id: str,
    run_ids: list[str],
) -> dict[str, Any]:
    mappings = repository.select_rows(
        "sports_provider_entities",
        columns="canonical_id",
        filters={
            "provider_id": provider_id,
            "sport_id": sport_id,
            "entity_type": "match",
            "external_id": external_match_id,
        },
        limit=1,
    )
    if not mappings:
        return {"match_mapped": False, "counts": {}, "quality_issues": 0}
    match_id = str(mappings[0]["canonical_id"])
    counts = {
        "participants": _count(repository, "sports_match_participants", {"match_id": match_id}),
        "team_statistics": _count(repository, "sports_match_team_stats", {"match_id": match_id}),
        "odds_current": _count(repository, "sports_odds_current", {"match_id": match_id}),
        "odds_history": _count(repository, "sports_odds_history", {"match_id": match_id}),
        "lineups": _count(repository, "sports_lineups", {"match_id": match_id}),
        "events": _count(repository, "sports_match_events", {"match_id": match_id}),
        "player_box_scores": _count(repository, "sports_player_box_scores", {"match_id": match_id}),
        "highlights": _count(repository, "sports_highlights", {"match_id": match_id}),
    }
    quality_issues = sum(
        _count(repository, "hl_data_quality_issues", {"run_id": run_id})
        for run_id in run_ids
    )
    return {
        "match_mapped": True,
        "canonical_match_id": match_id,
        "counts": counts,
        "quality_issues": quality_issues,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--match-id", help="Highlightly match id; omit to discover an upcoming match")
    parser.add_argument("--date", type=date.fromisoformat, help="Start date for automatic discovery (YYYY-MM-DD)")
    parser.add_argument("--max-jobs", type=int, default=100)
    parser.add_argument("--confirm-bounded-shadow", action="store_true", required=True)
    args = parser.parse_args()
    if args.max_jobs < 1 or args.max_jobs > 200:
        parser.error("--max-jobs must be between 1 and 200")

    repository = HighlightlyRepository.from_environment()
    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
    )
    context = repository.ingestion_context("football")
    provider = context["provider"]
    sport = context["sport"]
    if provider.get("enabled"):
        raise RuntimeError("Highlightly provider was already enabled; refusing a non-isolated shadow")
    _assert_empty_queue(repository)

    discovery: dict[str, Any] = {}
    match_id = args.match_id
    if not match_id:
        match_id, discovery = _discover_match(
            client,
            repository,
            str(provider["id"]),
            str(sport["id"]),
            args.date,
        )

    shadow_scope = f"shadow-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    job_results: list[dict[str, Any]] = []
    run_ids: list[str] = []
    repository.set_provider_enabled("highlightly", True)
    try:
        repository.enqueue_job(
            endpoint_key=MATCH_ENDPOINT,
            sport="football",
            resource="matches",
            dedupe_key=f"{shadow_scope}:{MATCH_ENDPOINT}:{match_id}",
            request_params={"id": match_id, "_fanout": True, "_fanout_scope": shadow_scope},
            priority=0,
        )
        worker = HighlightlyWorker(
            client,
            repository,
            worker_id=shadow_scope,
            enabled=True,
        )
        for _ in range(args.max_jobs):
            result = worker.run_once()
            job_results.append(result.__dict__)
            if result.run_id:
                run_ids.append(result.run_id)
            if result.status == "idle":
                break
    finally:
        repository.set_provider_enabled("highlightly", False)

    provider_after = repository.ingestion_context("football")["provider"]
    validation = _validate_shadow(
        repository,
        provider_id=str(provider["id"]),
        sport_id=str(sport["id"]),
        external_match_id=str(match_id),
        run_ids=run_ids,
    )
    report = {
        "scope": shadow_scope,
        "external_match_id": str(match_id),
        "discovery": {
            "date": discovery.get("date"),
            "home": (discovery.get("homeTeam") or {}).get("name"),
            "away": (discovery.get("awayTeam") or {}).get("name"),
        } if discovery else None,
        "jobs_processed": sum(result["status"] != "idle" for result in job_results),
        "statuses": [result["status"] for result in job_results],
        "provider_restored_disabled": not bool(provider_after.get("enabled")),
        "validation": validation,
    }
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    failed = any(status in {"dead", "retry"} for status in report["statuses"])
    return 1 if failed or not report["provider_restored_disabled"] or not validation["match_mapped"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
