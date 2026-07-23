"""Replay a bounded canary of dead Highlightly HTTP 521 football jobs."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from typing import Any

from api.highlightly.worker import HighlightlyWorker
from api.highlightly_client import HighlightlyClient
from api.highlightly_repository import HighlightlyRepository, HighlightlyRepositoryError
from scripts.run_highlightly_phase7_shadow import ACTIVE_STATUSES, DAILY_LIMIT, RESERVE_REQUESTS


ENDPOINT = "football.FootballStatisticsController_getStatistics"
ERROR = "Highlightly returned HTTP 521"


def _active_jobs(repository: HighlightlyRepository) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for status in ACTIVE_STATUSES:
        rows.extend(
            repository.select_rows(
                "hl_ingestion_jobs",
                columns="id,status,shadow_scope",
                filters={"status": status},
                limit=1,
            )
        )
    return rows


def _dead_candidates(
    repository: HighlightlyRepository, scope: str, limit: int
) -> list[dict[str, Any]]:
    return repository.select_rows(
        "hl_ingestion_jobs",
        columns="id,status,sport,endpoint_key,last_error,attempts,max_attempts,updated_at",
        filters={
            "shadow_scope": scope,
            "sport": "football",
            "endpoint_key": ENDPOINT,
            "status": "dead",
            "last_error": ERROR,
        },
        order="updated_at.asc,created_at.asc",
        limit=limit,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    parser.add_argument("--max-jobs", type=int, default=10)
    parser.add_argument("--minimum-success-rate", type=float, default=0.80)
    parser.add_argument("--confirm-dead-521-replay", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.max_jobs <= 200:
        parser.error("--max-jobs must be between 1 and 200")
    if not 0 <= args.minimum_success_rate <= 1:
        parser.error("--minimum-success-rate must be between 0 and 1")

    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    provider = context["provider"]
    if provider.get("enabled"):
        raise RuntimeError("Highlightly provider must be disabled before the 521 replay")
    if _active_jobs(repository):
        raise RuntimeError("Active ingestion queue must be empty before the 521 replay")

    candidates = _dead_candidates(repository, args.scope, args.max_jobs)
    report: dict[str, Any] = {
        "scope": args.scope,
        "mode": "execute" if args.confirm_dead_521_replay else "dry-run",
        "eligible": len(candidates),
        "max_jobs": args.max_jobs,
        "minimum_success_rate": args.minimum_success_rate,
        "endpoint_key": ENDPOINT,
        "provider_disabled_at_rest": True,
    }
    if not args.confirm_dead_521_replay or not candidates:
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
        return 0

    usage_date = datetime.now(timezone.utc).date().isoformat()
    usage_before = repository.daily_request_usage(str(provider["id"]), usage_date)
    hard_ceiling = DAILY_LIMIT - RESERVE_REQUESTS
    if usage_before + len(candidates) > hard_ceiling:
        raise RuntimeError(
            f"Canary would cross the protected quota ceiling ({usage_before}+{len(candidates)}/{hard_ceiling})"
        )

    requeued_value = repository.rpc(
        "requeue_highlightly_dead_521_jobs",
        {"p_scope": args.scope, "p_limit": len(candidates)},
    )
    requeued = list(requeued_value or [])
    if len(requeued) != len(candidates):
        raise RuntimeError(f"Expected {len(candidates)} requeued jobs, received {len(requeued)}")
    target_ids = {str(row["id"]) for row in requeued}

    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
    )
    results: list[dict[str, Any]] = []
    remaining = set(target_ids)
    repository.set_provider_enabled("highlightly", True)
    try:
        worker = HighlightlyWorker(
            client,
            repository,
            worker_id=f"{args.scope}:dead-521-canary",
            enabled=True,
            daily_quota_ceiling=usage_before + len(candidates),
        )
        for _ in candidates:
            result = worker.run_once()
            materialized = result.__dict__
            results.append(materialized)
            if result.status == "idle":
                break
            if str(result.job_id) not in target_ids:
                raise RuntimeError(f"Replay claimed a job outside the canary: {result.job_id}")
            remaining.discard(str(result.job_id))
    finally:
        repository.set_provider_enabled("highlightly", False)

    statuses = Counter(str(row["status"]) for row in results if row["status"] != "idle")
    successful = statuses["succeeded"] + statuses["partial"]
    success_rate = successful / len(candidates)
    usage_after = repository.daily_request_usage(str(provider["id"]), usage_date)
    provider_disabled = not bool(
        repository.ingestion_context("football")["provider"].get("enabled")
    )

    observation_refresh_error: dict[str, Any] | None = None
    finalization_error: dict[str, Any] | None = None
    windows = repository.select_rows(
        "hl_shadow_windows",
        columns="id,scope",
        filters={"scope": args.scope},
        limit=1,
    )
    if windows:
        observations = repository.select_rows(
            "hl_shadow_observations",
            columns="matches_expected",
            filters={"window_id": windows[0]["id"], "sport": "football"},
            order="observed_on.desc",
            limit=1,
        )
        try:
            repository.rpc(
                "refresh_highlightly_shadow_observation",
                {
                    "p_window_id": windows[0]["id"],
                    "p_observed_on": usage_date,
                    "p_sport": "football",
                    "p_scope": args.scope,
                    "p_matches_expected": int(
                        observations[0].get("matches_expected") or 0
                    )
                    if observations
                    else 0,
                },
            )
        except HighlightlyRepositoryError as exc:
            observation_refresh_error = {
                "status": exc.status,
                "body": exc.body,
            }
        try:
            repository.rpc("finalize_highlightly_shadow_window", {"p_scope": args.scope})
        except HighlightlyRepositoryError as exc:
            finalization_error = {
                "status": exc.status,
                "body": exc.body,
            }

    remaining_dead = _dead_candidates(repository, args.scope, 1_000)
    report.update(
        {
            "targeted": len(candidates),
            "processed": len(candidates) - len(remaining),
            "statuses": dict(statuses),
            "success_rate": round(success_rate, 4),
            "unclaimed_target_ids": sorted(remaining),
            "remaining_dead_521": len(remaining_dead),
            "highlightly_requests_recorded": usage_after - usage_before,
            "provider_restored_disabled": provider_disabled,
            "observation_refresh_error": observation_refresh_error,
            "finalization_error": finalization_error,
            "recommended_action": (
                "continue_bounded_replay"
                if success_rate >= args.minimum_success_rate
                and not remaining
                and finalization_error is None
                else "stop_and_escalate_provider"
            ),
        }
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
    return 0 if (
        success_rate >= args.minimum_success_rate
        and not remaining
        and provider_disabled
        and finalization_error is None
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
