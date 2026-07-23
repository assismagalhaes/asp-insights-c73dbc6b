"""Refresh only pregame odds at T-24h, T-6h and T-60m."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import os
from typing import Any, Iterable, Mapping

from api.highlightly.worker import HighlightlyWorker
from api.highlightly_client import HighlightlyClient
from api.highlightly_locks import running_lock_blocks_start
from api.highlightly_repository import HighlightlyRepository
from scripts.run_highlightly_phase7_shadow import (
    DAILY_LIMIT,
    RESERVE_REQUESTS,
    SPORTS,
    _active_jobs,
)


DEFAULT_REQUEST_BUDGET = 750
MAX_REQUEST_BUDGET = 2_000
PHASE8D_SCOPE_PREFIX = "phase8d-odds-"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _as_rows(value: Any) -> list[dict[str, Any]]:
    return [dict(row) for row in (value or []) if isinstance(row, Mapping)]


def _provider(repository: HighlightlyRepository) -> dict[str, Any]:
    contexts = [repository.ingestion_context(sport) for sport in SPORTS]
    provider_ids = {str(context["provider"]["id"]) for context in contexts}
    if len(provider_ids) != 1:
        raise RuntimeError("Selected sports do not resolve to one Highlightly provider")
    return dict(contexts[0]["provider"])


def _phase8d_job(row: Mapping[str, Any]) -> bool:
    return str(row.get("shadow_scope") or "").startswith(PHASE8D_SCOPE_PREFIX)


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--at", type=datetime.fromisoformat)
    parser.add_argument("--max-jobs", type=int, default=500)
    parser.add_argument("--request-budget", type=int, default=DEFAULT_REQUEST_BUDGET)
    parser.add_argument("--confirm-odds-refresh", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.max_jobs <= 2_000:
        parser.error("--max-jobs must be between 1 and 2000")
    if not 1 <= args.request_budget <= MAX_REQUEST_BUDGET:
        parser.error(f"--request-budget must be between 1 and {MAX_REQUEST_BUDGET}")
    if args.at is not None and (args.at.tzinfo is None or args.at.utcoffset() is None):
        parser.error("--at must include a timezone")
    return args


def _report(*, mode: str, event: str, at: datetime, **extra: Any) -> dict[str, Any]:
    return {
        "mode": mode,
        "event": event,
        "at": at.isoformat(),
        "cadence": ["T-24h", "T-6h", "T-60m"],
        "sports": list(SPORTS),
        "odds_only": True,
        "daily_limit": DAILY_LIMIT,
        "reserve_requests": RESERVE_REQUESTS,
        **extra,
    }


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    at = (args.at or _now_utc()).astimezone(timezone.utc)
    mode = "execute" if args.confirm_odds_refresh else "dry-run"
    scope = f"{PHASE8D_SCOPE_PREFIX}{at.strftime('%Y%m%dT%H%MZ')}"
    repository = HighlightlyRepository.from_environment()
    provider = _provider(repository)

    candidates = _as_rows(
        repository.rpc(
            "get_highlightly_odds_refresh_candidates",
            {"p_at": at.isoformat(), "p_limit": args.max_jobs},
        )
    )
    by_horizon = dict(Counter(str(row.get("refresh_horizon")) for row in candidates))
    if not args.confirm_odds_refresh:
        print(
            json.dumps(
                _report(
                    mode=mode,
                    event="phase8d_odds_refresh_plan",
                    at=at,
                    scope=scope,
                    candidates=len(candidates),
                    by_horizon=by_horizon,
                    request_budget=args.request_budget,
                    max_jobs=args.max_jobs,
                ),
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        return 0

    if provider.get("enabled"):
        print(
            json.dumps(
                _report(
                    mode=mode,
                    event="phase8d_odds_refresh_skipped",
                    at=at,
                    scope=scope,
                    reason="provider_enabled",
                ),
                ensure_ascii=False,
            )
        )
        return 0

    active_before = _active_jobs(repository, limit=args.max_jobs)
    outsiders = [row for row in active_before if not _phase8d_job(row)]
    if outsiders:
        print(
            json.dumps(
                _report(
                    mode=mode,
                    event="phase8d_odds_refresh_skipped",
                    at=at,
                    scope=scope,
                    reason="active_foreign_queue",
                    active_jobs=len(active_before),
                    foreign_jobs=len(outsiders),
                ),
                ensure_ascii=False,
            )
        )
        return 0
    if any(running_lock_blocks_start(row) for row in active_before):
        print(
            json.dumps(
                _report(
                    mode=mode,
                    event="phase8d_odds_refresh_skipped",
                    at=at,
                    scope=scope,
                    reason="active_worker_lock",
                    active_jobs=len(active_before),
                ),
                ensure_ascii=False,
            )
        )
        return 0

    usage_date = at.date().isoformat()
    usage_before = repository.daily_request_usage(str(provider["id"]), usage_date)
    hard_ceiling = DAILY_LIMIT - RESERVE_REQUESTS
    quota_ceiling = min(hard_ceiling, usage_before + args.request_budget)
    if usage_before >= hard_ceiling:
        print(
            json.dumps(
                _report(
                    mode=mode,
                    event="phase8d_odds_refresh_skipped",
                    at=at,
                    scope=scope,
                    reason="quota_reserve",
                    requests_used=usage_before,
                ),
                ensure_ascii=False,
            )
        )
        return 0

    for candidate in candidates:
        repository.enqueue_job(
            endpoint_key=str(candidate["endpoint_key"]),
            sport=str(candidate["sport"]),
            resource="odds",
            dedupe_key=str(candidate["dedupe_key"]),
            request_params={
                "matchId": candidate["external_match_id"],
                "limit": 5,
                "offset": 0,
                "_shadow_scope": scope,
                "_phase8d_horizon": candidate["refresh_horizon"],
                "_canonical_match_id": candidate["match_id"],
                "_kickoff_at": candidate["kickoff_at"],
            },
            priority=0,
        )

    results: list[dict[str, Any]] = []
    if candidates or active_before:
        client = HighlightlyClient(
            os.environ.get("HIGHLIGHTLY_API_KEY", ""),
            base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
        )
        repository.set_provider_enabled("highlightly", True)
        try:
            worker = HighlightlyWorker(
                client,
                repository,
                worker_id=f"{scope}:phase8d",
                enabled=True,
                daily_quota_ceiling=quota_ceiling,
            )
            for _ in range(args.max_jobs):
                result = worker.run_once()
                results.append(result.__dict__)
                if result.status == "idle":
                    break
                if result.status == "retry" and "quota guard" in str(
                    result.message or ""
                ).casefold():
                    break
        finally:
            repository.set_provider_enabled("highlightly", False)

    active_after = _active_jobs(repository, limit=args.max_jobs)
    provider_disabled = not bool(repository.ingestion_context(SPORTS[0])["provider"].get("enabled"))
    quality = repository.rpc(
        "get_highlightly_odds_quality_report",
        {
            "p_from": at.isoformat(),
            "p_to": (at.replace(microsecond=0) + timedelta(days=5)).isoformat(),
        },
    )
    print(
        json.dumps(
            _report(
                mode=mode,
                event="phase8d_odds_refresh_finished",
                at=at,
                scope=scope,
                candidates=len(candidates),
                by_horizon=by_horizon,
                usage_before=usage_before,
                quota_ceiling=quota_ceiling,
                processed=sum(row.get("status") != "idle" for row in results),
                statuses=dict(Counter(str(row.get("status")) for row in results)),
                active_after=len(active_after),
                provider_restored_disabled=provider_disabled,
                quality=quality,
            ),
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
    )
    failed = any(row.get("status") == "dead" for row in results)
    return 1 if failed or not provider_disabled else 0


if __name__ == "__main__":
    raise SystemExit(main())
