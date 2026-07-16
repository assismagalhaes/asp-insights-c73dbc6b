"""Run one quota-bounded Phase 7 shadow slice with the provider disabled at rest."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import json
import os
from typing import Any, Iterable, Mapping
from uuid import uuid4

from api.highlightly.worker import HighlightlyWorker
from api.highlightly_client import HighlightlyClient
from api.highlightly_repository import HighlightlyRepository


SPORTS = ("football", "baseball", "basketball")
ACTIVE_STATUSES = ("pending", "retry", "running")
DAILY_LIMIT = 7_500
BACKFILL_BUDGET_LIMIT = 1_500
RESERVE_REQUESTS = 750
WNBA_LEAGUE_ID = 11_847


@dataclass(frozen=True)
class SeedJob:
    endpoint_key: str
    sport: str
    resource: str
    dedupe_key: str
    request_params: dict[str, Any]


def _dates(start: date, days: int) -> Iterable[date]:
    for offset in range(days):
        yield start + timedelta(days=offset)


def build_seed_jobs(
    *,
    scope: str,
    start_date: date,
    days: int,
    sports: Iterable[str],
    football_league_ids: Iterable[int],
    all_football_leagues: bool = False,
) -> list[SeedJob]:
    if not 1 <= days <= 7:
        raise ValueError("days must be between 1 and 7")
    selected = tuple(dict.fromkeys(sports))
    if not selected or any(sport not in SPORTS for sport in selected):
        raise ValueError("sports must contain football, baseball, or basketball")
    league_ids = tuple(dict.fromkeys(int(value) for value in football_league_ids))
    if "football" in selected and all_football_leagues and league_ids:
        raise ValueError("all football leagues and explicit football league ids are mutually exclusive")
    if "football" in selected and not all_football_leagues and not league_ids:
        raise ValueError(
            "select --all-football-leagues or at least one football league id when football is selected"
        )

    jobs: list[SeedJob] = []
    if "football" in selected and all_football_leagues:
        endpoint = "football.LeaguesController_getLeagues"
        snapshot = start_date.isoformat()
        jobs.append(
            SeedJob(
                endpoint_key=endpoint,
                sport="football",
                resource="leagues",
                dedupe_key=f"{scope}:catalog:{endpoint}:{snapshot}:all",
                request_params={
                    "limit": 100,
                    "offset": 0,
                    "_fanout_scope": scope,
                    "_shadow_batch": snapshot,
                    "_pagination_priority": 0,
                },
            )
        )
    for target_date in _dates(start_date, days):
        date_value = target_date.isoformat()
        if "football" in selected:
            if all_football_leagues:
                endpoint = "football.MatchesController_getMatches"
                jobs.append(
                    SeedJob(
                        endpoint_key=endpoint,
                        sport="football",
                        resource="matches",
                        dedupe_key=f"{scope}:seed:{endpoint}:{date_value}:all",
                        request_params={
                            "date": date_value,
                            "timezone": "America/Sao_Paulo",
                            "limit": 10,
                            "offset": 0,
                            "_fanout": True,
                            "_fanout_scope": scope,
                        },
                    )
                )
            else:
                for league_id in league_ids:
                    endpoint = "football.MatchesController_getMatches"
                    jobs.append(
                        SeedJob(
                            endpoint_key=endpoint,
                            sport="football",
                            resource="matches",
                            dedupe_key=f"{scope}:seed:{endpoint}:{date_value}:league:{league_id}",
                            request_params={
                                "leagueId": league_id,
                                "date": date_value,
                                "timezone": "America/Sao_Paulo",
                                "limit": 10,
                                "offset": 0,
                                "_fanout": True,
                                "_fanout_scope": scope,
                            },
                        )
                    )
        if "baseball" in selected:
            endpoint = "baseball.BaseballMatchController_getMatches"
            jobs.append(
                SeedJob(
                    endpoint_key=endpoint,
                    sport="baseball",
                    resource="matches",
                    dedupe_key=f"{scope}:seed:{endpoint}:{date_value}:MLB",
                    request_params={
                        "league": "MLB",
                        "date": date_value,
                        "timezone": "America/Sao_Paulo",
                        "limit": 10,
                        "offset": 0,
                        "_fanout": True,
                        "_fanout_scope": scope,
                    },
                )
            )
        if "basketball" in selected:
            endpoint = "basketball.MatchesController_getMatches"
            jobs.append(
                SeedJob(
                    endpoint_key=endpoint,
                    sport="basketball",
                    resource="matches",
                    dedupe_key=f"{scope}:seed:{endpoint}:{date_value}:WNBA",
                    request_params={
                        "leagueId": WNBA_LEAGUE_ID,
                        "date": date_value,
                        "timezone": "America/Sao_Paulo",
                        "limit": 10,
                        "offset": 0,
                        "_fanout": True,
                        "_fanout_scope": scope,
                    },
                )
            )
    return jobs


def _active_jobs(repository: HighlightlyRepository, *, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for status in ACTIVE_STATUSES:
        rows.extend(
            repository.select_rows(
                "hl_ingestion_jobs",
                columns="id,status,endpoint_key,dedupe_key",
                filters={"status": status},
                limit=limit + 1,
                order="created_at.asc",
            )
        )
    return rows


def _as_row(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        return dict(value[0]) if value else {}
    return dict(value or {})


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", help="Reuse the same exact scope during the seven-day window")
    parser.add_argument("--data-start", type=date.fromisoformat, default=datetime.now(timezone.utc).date())
    parser.add_argument("--backfill-days", type=int, default=1)
    parser.add_argument("--sport", action="append", choices=SPORTS, dest="sports")
    football_scope = parser.add_mutually_exclusive_group()
    football_scope.add_argument("--all-football-leagues", action="store_true")
    football_scope.add_argument("--football-league-id", action="append", type=int, default=[])
    parser.add_argument("--daily-request-budget", type=int, default=BACKFILL_BUDGET_LIMIT)
    parser.add_argument("--max-jobs", type=int, default=200)
    parser.add_argument("--confirm-phase7-shadow", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.backfill_days <= 7:
        parser.error("--backfill-days must be between 1 and 7")
    if not 1 <= args.daily_request_budget <= BACKFILL_BUDGET_LIMIT:
        parser.error(f"--daily-request-budget must be between 1 and {BACKFILL_BUDGET_LIMIT}")
    if not 1 <= args.max_jobs <= 1_500:
        parser.error("--max-jobs must be between 1 and 1500")
    return args


def main() -> int:
    args = _parse_args()
    sports = tuple(args.sports or SPORTS)
    scope = args.scope or (
        f"phase7-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    )
    seed_jobs = build_seed_jobs(
        scope=scope,
        start_date=args.data_start,
        days=args.backfill_days,
        sports=sports,
        football_league_ids=args.football_league_id,
        all_football_leagues=args.all_football_leagues,
    )
    plan = {
        "mode": "execute" if args.confirm_phase7_shadow else "dry-run",
        "scope": scope,
        "sports": sports,
        "data_start": args.data_start.isoformat(),
        "backfill_days": args.backfill_days,
        "seed_jobs": len(seed_jobs),
        "daily_request_budget": args.daily_request_budget,
        "reserve_requests": RESERVE_REQUESTS,
        "max_jobs": args.max_jobs,
        "all_football_leagues": args.all_football_leagues,
        "football_league_ids": args.football_league_id,
    }
    if not args.confirm_phase7_shadow:
        plan["jobs"] = [job.__dict__ for job in seed_jobs]
        print(json.dumps(plan, ensure_ascii=False, separators=(",", ":"), default=str))
        return 0

    repository = HighlightlyRepository.from_environment()
    contexts = {sport: repository.ingestion_context(sport) for sport in sports}
    providers = {str(context["provider"]["id"]) for context in contexts.values()}
    if len(providers) != 1:
        raise RuntimeError("Selected sports do not resolve to one Highlightly provider")
    provider = next(iter(contexts.values()))["provider"]
    if provider.get("enabled"):
        raise RuntimeError("Highlightly provider was already enabled; refusing a non-isolated Phase 7 run")

    active_before = _active_jobs(repository, limit=args.max_jobs)
    outsiders = [row for row in active_before if scope not in str(row.get("dedupe_key") or "")]
    if outsiders:
        raise RuntimeError("Active ingestion queue contains jobs outside the requested Phase 7 scope")
    if any(row.get("status") == "running" for row in active_before):
        raise RuntimeError("An ingestion job is already running; refusing concurrent Phase 7 execution")

    today = datetime.now(timezone.utc).date().isoformat()
    usage_before = repository.daily_request_usage(str(provider["id"]), today)
    hard_ceiling = DAILY_LIMIT - RESERVE_REQUESTS
    quota_ceiling = min(hard_ceiling, usage_before + args.daily_request_budget)
    if usage_before >= hard_ceiling or quota_ceiling <= usage_before:
        raise RuntimeError("Phase 7 daily quota budget is unavailable while preserving the reserve")

    existing_windows = repository.select_rows(
        "hl_shadow_windows",
        columns="id,scope,status,started_at,planned_end_at",
        filters={"scope": scope},
        limit=1,
    )
    if existing_windows:
        window = existing_windows[0]
        if window.get("status") not in {"planned", "running"}:
            raise RuntimeError(f"Phase 7 window {scope} is already {window.get('status')}")
    else:
        started_at = datetime.now(timezone.utc)
        saved = repository.upsert_rows(
            "hl_shadow_windows",
            [
                {
                    "provider_id": provider["id"],
                    "scope": scope,
                    "status": "running",
                    "sports": list(sports),
                    "started_at": started_at.isoformat(),
                    "planned_end_at": (started_at + timedelta(days=7)).isoformat(),
                    "daily_request_budget": args.daily_request_budget,
                    "reserve_requests": RESERVE_REQUESTS,
                    "config": {
                        "data_start": args.data_start.isoformat(),
                        "backfill_days": args.backfill_days,
                        "all_football_leagues": args.all_football_leagues,
                        "football_league_ids": args.football_league_id,
                        "max_jobs_per_slice": args.max_jobs,
                    },
                }
            ],
            on_conflict="scope",
        )
        window = saved[0]

    for job in seed_jobs:
        repository.enqueue_job(
            endpoint_key=job.endpoint_key,
            sport=job.sport,
            resource=job.resource,
            dedupe_key=job.dedupe_key,
            request_params=job.request_params,
            priority=1,
        )

    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
    )
    results: list[dict[str, Any]] = []
    repository.set_provider_enabled("highlightly", True)
    try:
        worker = HighlightlyWorker(
            client,
            repository,
            worker_id=f"{scope}:phase7",
            enabled=True,
            daily_quota_ceiling=quota_ceiling,
        )
        for _ in range(args.max_jobs):
            result = worker.run_once()
            results.append(result.__dict__)
            if result.status == "idle":
                break
            if result.status == "retry" and "quota guard" in str(result.message or "").casefold():
                break
    finally:
        repository.set_provider_enabled("highlightly", False)

    observations: dict[str, Any] = {}
    reconciliations: dict[str, Any] = {}
    for sport in sports:
        reconciliation = _as_row(
            repository.rpc(
                "refresh_highlightly_source_reconciliation",
                {
                    "p_window_id": window["id"],
                    "p_observed_on": today,
                    "p_sport": sport,
                },
            )
        )
        reconciliations[sport] = reconciliation
        observations[sport] = _as_row(
            repository.rpc(
                "refresh_highlightly_shadow_observation",
                {
                    "p_window_id": window["id"],
                    "p_observed_on": today,
                    "p_sport": sport,
                    "p_scope": scope,
                    "p_matches_expected": int(reconciliation.get("expected_matches") or 0),
                },
            )
        )

    provider_disabled = not bool(repository.ingestion_context(sports[0])["provider"].get("enabled"))
    active_after = _active_jobs(repository, limit=args.max_jobs)
    health_rows = repository.select_rows(
        "hl_phase7_window_health_v",
        filters={"window_id": window["id"]},
        limit=1,
    )
    report = {
        **plan,
        "window_id": window["id"],
        "usage_before": usage_before,
        "quota_ceiling": quota_ceiling,
        "processed": sum(row["status"] != "idle" for row in results),
        "statuses": dict(Counter(row["status"] for row in results)),
        "active_after": len(active_after),
        "provider_restored_disabled": provider_disabled,
        "observations": observations,
        "reconciliations": reconciliations,
        "health": health_rows[0] if health_rows else None,
    }
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
    failed = any(row["status"] == "dead" for row in results)
    return 1 if failed or not provider_disabled else 0


if __name__ == "__main__":
    raise SystemExit(main())
