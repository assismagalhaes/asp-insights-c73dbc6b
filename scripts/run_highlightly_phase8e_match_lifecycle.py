"""Collect prematch, live and postgame match resources with a bounded quota."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import os
from typing import Any, Iterable, Mapping

from api.highlightly.worker import HighlightlyWorker, WorkerResult
from api.highlightly_client import HighlightlyClient
from api.highlightly_locks import running_lock_blocks_start
from api.highlightly_repository import HighlightlyRepository
from scripts.run_highlightly_phase7_shadow import (
    DAILY_LIMIT,
    RESERVE_REQUESTS,
    SPORTS,
    _active_jobs,
)


DEFAULT_REQUEST_BUDGET = 1_500
MAX_REQUEST_BUDGET = 2_000
PHASE8E_SCOPE_PREFIX = "phase8e-lifecycle-"


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


def _phase8e_job(row: Mapping[str, Any]) -> bool:
    return str(row.get("shadow_scope") or "").startswith(PHASE8E_SCOPE_PREFIX)


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--at", type=datetime.fromisoformat)
    parser.add_argument("--max-jobs", type=int, default=1_000)
    parser.add_argument("--request-budget", type=int, default=DEFAULT_REQUEST_BUDGET)
    parser.add_argument("--confirm-lifecycle", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.max_jobs <= 3_000:
        parser.error("--max-jobs must be between 1 and 3000")
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
        "phase": "8E",
        "cadence": ["T-2h", "T-30m", "live-5m", "T+15m", "T+2h", "T+24h"],
        "sports": list(SPORTS),
        "daily_limit": DAILY_LIMIT,
        "reserve_requests": RESERVE_REQUESTS,
        **extra,
    }


def _resource_status(result: WorkerResult) -> str:
    if result.status == "succeeded":
        return "succeeded"
    if result.status == "partial":
        return "quality_rejected"
    if result.status == "retry":
        return "retry"
    if result.status == "dead":
        message = str(result.message or "").casefold()
        if "http 404" in message or "not found" in message or "unavailable" in message:
            return "provider_unavailable"
        return "dead"
    return "pending"


def _pending_resource_row(
    candidate: Mapping[str, Any],
    *,
    job: Mapping[str, Any],
    scope: str,
    attempted_at: datetime,
) -> dict[str, Any]:
    return {
        "match_id": candidate["match_id"],
        "resource": candidate["resource"],
        "endpoint_key": candidate["endpoint_key"],
        "status": "pending",
        "last_job_id": job.get("id"),
        "attempts": int(job.get("attempts") or 0),
        "last_attempted_at": attempted_at.isoformat(),
        "completed_at": None,
        "last_error": None,
        "metadata": {
            "phase": "8E",
            "scope": scope,
            "cadenceKey": candidate["cadence_key"],
            "lifecycleStage": candidate["lifecycle_stage"],
            "dedupeKey": candidate["dedupe_key"],
        },
    }


def _candidate_from_existing_job(job: Mapping[str, Any]) -> dict[str, Any] | None:
    params = job.get("request_params")
    if not isinstance(params, Mapping):
        return None
    match_id = params.get("_canonical_match_id")
    resource = params.get("_phase8e_resource") or job.get("resource")
    stage = params.get("_phase8e_stage")
    if not match_id or not resource or not stage:
        return None
    external_match_id = params.get("matchId") or params.get("id")
    dedupe_key = str(job.get("dedupe_key") or "")
    return {
        "match_id": match_id,
        "sport": job.get("sport"),
        "external_match_id": external_match_id,
        "kickoff_at": params.get("_kickoff_at"),
        "match_status": None,
        "lifecycle_stage": stage,
        "cadence_key": dedupe_key.rsplit(":", 1)[-1],
        "resource": resource,
        "endpoint_key": job.get("endpoint_key"),
        "request_params": dict(params),
        "dedupe_key": dedupe_key,
        "priority": int(job.get("priority") or 2),
    }


def _finished_resource_row(
    pending: Mapping[str, Any],
    result: WorkerResult,
    *,
    finished_at: datetime,
) -> dict[str, Any]:
    status = _resource_status(result)
    return {
        **dict(pending),
        "status": status,
        "attempts": max(1, int(pending.get("attempts") or 0) + 1),
        "completed_at": finished_at.isoformat()
        if status in {
            "succeeded",
            "dead",
            "provider_unavailable",
            "quality_rejected",
            "not_supported",
        }
        else None,
        "last_error": str(result.message or "")[:1000] or None,
    }


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    at = (args.at or _now_utc()).astimezone(timezone.utc)
    mode = "execute" if args.confirm_lifecycle else "dry-run"
    scope = f"{PHASE8E_SCOPE_PREFIX}{at.strftime('%Y%m%dT%H%MZ')}"
    repository = HighlightlyRepository.from_environment()
    provider = _provider(repository)

    candidates = _as_rows(
        repository.rpc(
            "get_highlightly_match_lifecycle_candidates",
            {
                "p_at": at.isoformat(),
                "p_limit": args.max_jobs,
                "p_include_disabled": not args.confirm_lifecycle,
            },
        )
    )
    by_stage = dict(Counter(str(row.get("lifecycle_stage")) for row in candidates))
    by_resource = dict(Counter(str(row.get("resource")) for row in candidates))

    if not args.confirm_lifecycle:
        print(
            json.dumps(
                _report(
                    mode=mode,
                    event="phase8e_lifecycle_plan",
                    at=at,
                    scope=scope,
                    candidates=len(candidates),
                    by_stage=by_stage,
                    by_resource=by_resource,
                    request_budget=args.request_budget,
                    max_jobs=args.max_jobs,
                    includes_disabled_policies=True,
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
                    event="phase8e_lifecycle_skipped",
                    at=at,
                    scope=scope,
                    reason="provider_enabled",
                ),
                ensure_ascii=False,
            )
        )
        return 0

    active_before = _active_jobs(repository, limit=args.max_jobs)
    outsiders = [row for row in active_before if not _phase8e_job(row)]
    if outsiders:
        print(
            json.dumps(
                _report(
                    mode=mode,
                    event="phase8e_lifecycle_skipped",
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
                    event="phase8e_lifecycle_skipped",
                    at=at,
                    scope=scope,
                    reason="active_worker_lock",
                    active_jobs=len(active_before),
                ),
                ensure_ascii=False,
            )
        )
        return 0

    if not candidates and not active_before:
        print(
            json.dumps(
                _report(
                    mode=mode,
                    event="phase8e_lifecycle_idle",
                    at=at,
                    scope=scope,
                    candidates=0,
                    reason="no_enabled_policy_candidates",
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
                    event="phase8e_lifecycle_skipped",
                    at=at,
                    scope=scope,
                    reason="quota_reserve",
                    requests_used=usage_before,
                ),
                ensure_ascii=False,
            )
        )
        return 0

    candidate_by_job: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    pending_rows: list[dict[str, Any]] = []
    for active_job in active_before:
        existing_rows = repository.select_rows(
            "hl_ingestion_jobs",
            columns=(
                "id,sport,resource,endpoint_key,dedupe_key,request_params,"
                "priority,attempts"
            ),
            filters={"id": active_job["id"]},
            limit=1,
        )
        if not existing_rows:
            continue
        existing_job = existing_rows[0]
        existing_candidate = _candidate_from_existing_job(existing_job)
        if existing_candidate is None:
            continue
        pending = _pending_resource_row(
            existing_candidate,
            job=existing_job,
            scope=str(existing_job["request_params"].get("_shadow_scope") or scope),
            attempted_at=at,
        )
        pending_rows.append(pending)
        candidate_by_job[str(existing_job["id"])] = (existing_candidate, pending)

    for candidate in candidates:
        request_params = dict(candidate.get("request_params") or {})
        request_params.update(
            {
                "_shadow_scope": scope,
                "_phase8e_stage": candidate["lifecycle_stage"],
                "_phase8e_resource": candidate["resource"],
                "_canonical_match_id": candidate["match_id"],
                "_kickoff_at": candidate["kickoff_at"],
            }
        )
        job = repository.enqueue_job(
            endpoint_key=str(candidate["endpoint_key"]),
            sport=str(candidate["sport"]),
            resource=str(candidate["resource"]),
            dedupe_key=str(candidate["dedupe_key"]),
            request_params=request_params,
            priority=int(candidate["priority"]),
        )
        pending = _pending_resource_row(candidate, job=job, scope=scope, attempted_at=at)
        pending_rows.append(pending)
        if job.get("id"):
            candidate_by_job[str(job["id"])] = (candidate, pending)

    if pending_rows:
        repository.upsert_rows(
            "hl_match_lifecycle_resources",
            pending_rows,
            on_conflict="match_id,resource",
        )

    results: list[WorkerResult] = []
    finished_rows: list[dict[str, Any]] = []
    if candidates or active_before:
        client = HighlightlyClient(
            os.environ.get("HIGHLIGHTLY_API_KEY", ""),
            base_url=os.environ.get(
                "HIGHLIGHTLY_BASE_URL",
                "https://sports.highlightly.net",
            ),
        )
        repository.set_provider_enabled("highlightly", True)
        try:
            worker = HighlightlyWorker(
                client,
                repository,
                worker_id=f"{scope}:phase8e",
                enabled=True,
                daily_quota_ceiling=quota_ceiling,
            )
            for _ in range(args.max_jobs):
                result = worker.run_once()
                results.append(result)
                if result.job_id and result.job_id in candidate_by_job:
                    _, pending = candidate_by_job[result.job_id]
                    finished_rows.append(
                        _finished_resource_row(
                            pending,
                            result,
                            finished_at=_now_utc(),
                        )
                    )
                if result.status == "idle":
                    break
                if result.status == "retry" and "quota guard" in str(
                    result.message or ""
                ).casefold():
                    break
        finally:
            repository.set_provider_enabled("highlightly", False)

    if finished_rows:
        repository.upsert_rows(
            "hl_match_lifecycle_resources",
            finished_rows,
            on_conflict="match_id,resource",
        )

    lifecycle_refresh = repository.rpc(
        "refresh_highlightly_match_lifecycle_states",
        {"p_at": at.isoformat()},
    )
    lifecycle_report = repository.rpc(
        "get_highlightly_match_lifecycle_report",
        {
            "p_from": (at - timedelta(hours=12)).isoformat(),
            "p_to": (at + timedelta(hours=36)).isoformat(),
        },
    )
    active_after = _active_jobs(repository, limit=args.max_jobs)
    provider_disabled = not bool(
        repository.ingestion_context(SPORTS[0])["provider"].get("enabled")
    )
    statuses = Counter(result.status for result in results)
    print(
        json.dumps(
            _report(
                mode=mode,
                event="phase8e_lifecycle_finished",
                at=at,
                scope=scope,
                candidates=len(candidates),
                by_stage=by_stage,
                by_resource=by_resource,
                usage_before=usage_before,
                quota_ceiling=quota_ceiling,
                processed=sum(result.status != "idle" for result in results),
                statuses=dict(statuses),
                active_after=len(active_after),
                provider_restored_disabled=provider_disabled,
                lifecycle_refresh=lifecycle_refresh,
                lifecycle=lifecycle_report,
            ),
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
    )
    failed = any(result.status == "dead" for result in results)
    return 1 if failed or not provider_disabled else 0


if __name__ == "__main__":
    raise SystemExit(main())
