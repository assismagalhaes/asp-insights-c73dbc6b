"""Continue one isolated Highlightly future queue while quota remains."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
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


DEFAULT_MAX_JOBS = 5_000
MAX_CONSECUTIVE_RETRIES = 10


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-jobs", type=int, default=DEFAULT_MAX_JOBS)
    parser.add_argument("--confirm-continuation", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.max_jobs <= DEFAULT_MAX_JOBS:
        parser.error(f"--max-jobs must be between 1 and {DEFAULT_MAX_JOBS}")
    return args


def _job_scope(row: Mapping[str, Any]) -> str:
    return str(row.get("shadow_scope") or "").strip()


def resolve_future_scope(active_jobs: Iterable[Mapping[str, Any]]) -> str:
    scopes = {_job_scope(row) for row in active_jobs}
    if "" in scopes:
        raise RuntimeError("Active ingestion queue contains jobs without a canonical shadow scope")
    if len(scopes) != 1:
        raise RuntimeError("Active ingestion queue contains more than one shadow scope")
    scope = next(iter(scopes))
    if not scope.startswith("future-"):
        raise RuntimeError(f"Active ingestion queue belongs to non-future scope {scope}")
    return scope


def available_requests(usage: int) -> int:
    return max(0, DAILY_LIMIT - RESERVE_REQUESTS - usage)


def _provider(repository: HighlightlyRepository) -> dict[str, Any]:
    contexts = [repository.ingestion_context(sport) for sport in SPORTS]
    provider_ids = {str(context["provider"]["id"]) for context in contexts}
    if len(provider_ids) != 1:
        raise RuntimeError("Selected sports do not resolve to one Highlightly provider")
    return dict(contexts[0]["provider"])


def _report(event: str, **extra: Any) -> dict[str, Any]:
    return {
        "mode": "execute",
        "event": event,
        "daily_limit": DAILY_LIMIT,
        "reserve_requests": RESERVE_REQUESTS,
        **extra,
    }


def finalize_idle_future_windows(
    repository: HighlightlyRepository,
) -> list[dict[str, Any]]:
    rows = repository.select_rows(
        "hl_shadow_windows",
        columns="id,scope,status,config",
        filters={"status": "running"},
        order="started_at.asc",
        limit=100,
    )
    finalized: list[dict[str, Any]] = []
    for row in rows:
        scope = str(row.get("scope") or "").strip()
        config = dict(row.get("config") or {})
        if not scope.startswith("future-") and config.get("window_kind") != "future":
            continue
        result = repository.rpc(
            "finalize_highlightly_shadow_window",
            {"p_scope": scope},
        )
        if isinstance(result, list):
            finalized.append(dict(result[0]) if result else {})
        else:
            finalized.append(dict(result or {}))
    return finalized


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    if not args.confirm_continuation:
        print(
            json.dumps(
                {
                    "mode": "dry-run",
                    "event": "future_continuation_plan",
                    "max_jobs": args.max_jobs,
                    "daily_limit": DAILY_LIMIT,
                    "reserve_requests": RESERVE_REQUESTS,
                },
                separators=(",", ":"),
            )
        )
        return 0

    repository = HighlightlyRepository.from_environment()
    provider = _provider(repository)
    if provider.get("enabled"):
        print(
            json.dumps(
                _report("future_continuation_skipped", reason="provider_enabled"),
                separators=(",", ":"),
            )
        )
        return 0

    active_before = _active_jobs(repository, limit=DEFAULT_MAX_JOBS)
    if not active_before:
        finalized_windows = finalize_idle_future_windows(repository)
        print(
            json.dumps(
                _report(
                    (
                        "future_continuation_finalized_idle"
                        if finalized_windows
                        else "future_continuation_idle"
                    ),
                    active_jobs=0,
                    finalized_windows=finalized_windows,
                ),
                separators=(",", ":"),
                default=str,
            )
        )
        return 0

    scope = resolve_future_scope(active_before)
    running = [row for row in active_before if running_lock_blocks_start(row)]
    if running:
        print(
            json.dumps(
                _report(
                    "future_continuation_skipped",
                    scope=scope,
                    reason="worker_running",
                    active_jobs=len(active_before),
                ),
                separators=(",", ":"),
            )
        )
        return 0

    usage_date = datetime.now(timezone.utc).date().isoformat()
    usage_before = repository.daily_request_usage(str(provider["id"]), usage_date)
    remaining_before = available_requests(usage_before)
    if remaining_before <= 0:
        print(
            json.dumps(
                _report(
                    "future_continuation_waiting_quota",
                    scope=scope,
                    active_jobs=len(active_before),
                    requests_used=usage_before,
                    requests_available=0,
                ),
                separators=(",", ":"),
            )
        )
        return 0

    max_jobs = min(args.max_jobs, remaining_before)
    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
    )
    results: list[dict[str, Any]] = []
    consecutive_retries = 0
    repository.set_provider_enabled("highlightly", True)
    try:
        worker = HighlightlyWorker(
            client,
            repository,
            worker_id=f"{scope}:future-continuation",
            enabled=True,
            daily_quota_ceiling=DAILY_LIMIT - RESERVE_REQUESTS,
        )
        for _ in range(max_jobs):
            result = worker.run_once()
            materialized = result.__dict__
            results.append(materialized)
            if result.status == "idle":
                break
            if result.status == "retry":
                consecutive_retries += 1
                if "quota guard" in str(result.message or "").casefold():
                    break
                if consecutive_retries >= MAX_CONSECUTIVE_RETRIES:
                    break
            else:
                consecutive_retries = 0
    finally:
        repository.set_provider_enabled("highlightly", False)

    usage_after = repository.daily_request_usage(str(provider["id"]), usage_date)
    active_after = _active_jobs(repository, limit=DEFAULT_MAX_JOBS)
    provider_disabled = not bool(_provider(repository).get("enabled"))
    finalized_windows: list[dict[str, Any]] = []
    if not active_after and provider_disabled:
        finalized_windows = finalize_idle_future_windows(repository)

    statuses = Counter(str(row.get("status") or "unknown") for row in results)
    event = (
        "future_continuation_completed"
        if not active_after
        else "future_continuation_waiting_quota"
        if available_requests(usage_after) <= 0
        else "future_continuation_pending"
    )
    report = _report(
        event,
        scope=scope,
        active_before=len(active_before),
        processed=sum(row.get("status") != "idle" for row in results),
        statuses=dict(statuses),
        active_after=len(active_after),
        requests_used_before=usage_before,
        requests_used_after=usage_after,
        requests_available_after=available_requests(usage_after),
        provider_restored_disabled=provider_disabled,
        finalized_windows=finalized_windows,
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))

    failed = any(row.get("status") == "dead" for row in results)
    return 1 if failed or not provider_disabled else 0


if __name__ == "__main__":
    raise SystemExit(main())
