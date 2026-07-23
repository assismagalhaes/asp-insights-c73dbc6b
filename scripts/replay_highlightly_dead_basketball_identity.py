"""Replay dead basketball match-list jobs caused by duplicate participant identity."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from typing import Any

from api.highlightly.worker import HighlightlyWorker
from api.highlightly_client import HighlightlyClient
from api.highlightly_repository import HighlightlyRepository, HighlightlyRepositoryError
from scripts.run_highlightly_phase7_shadow import ACTIVE_STATUSES, DAILY_LIMIT, RESERVE_REQUESTS


ENDPOINT = "basketball.MatchesController_getMatches"
ERROR_MARKERS = (
    "Supabase returned HTTP 409:",
    "sports_match_participants_match_team_unique",
    "duplicate key value violates unique constraint",
)


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


def _is_identity_error(row: dict[str, Any]) -> bool:
    error = str(row.get("last_error") or "")
    return all(marker in error for marker in ERROR_MARKERS)


def _dead_candidates(
    repository: HighlightlyRepository, scope: str, limit: int
) -> list[dict[str, Any]]:
    rows = repository.select_rows(
        "hl_ingestion_jobs",
        columns=(
            "id,status,sport,endpoint_key,last_error,attempts,max_attempts,"
            "request_params,updated_at"
        ),
        filters={
            "shadow_scope": scope,
            "sport": "basketball",
            "endpoint_key": ENDPOINT,
            "status": "dead",
        },
        order="updated_at.asc,created_at.asc",
        limit=100,
    )
    return [row for row in rows if _is_identity_error(row)][:limit]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    parser.add_argument("--max-jobs", type=int, default=1)
    parser.add_argument("--confirm-basketball-identity-replay", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.max_jobs <= 10:
        parser.error("--max-jobs must be between 1 and 10")

    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("basketball")
    provider = context["provider"]
    if provider.get("enabled"):
        raise RuntimeError(
            "Highlightly provider must be disabled before the basketball identity replay"
        )
    if _active_jobs(repository):
        raise RuntimeError(
            "Active ingestion queue must be empty before the basketball identity replay"
        )

    candidates = _dead_candidates(repository, args.scope, args.max_jobs)
    report: dict[str, Any] = {
        "scope": args.scope,
        "mode": (
            "execute" if args.confirm_basketball_identity_replay else "dry-run"
        ),
        "eligible": len(candidates),
        "max_jobs": args.max_jobs,
        "endpoint_key": ENDPOINT,
        "provider_disabled_at_rest": True,
    }
    if not args.confirm_basketball_identity_replay or not candidates:
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
        return 0

    usage_date = datetime.now(timezone.utc).date().isoformat()
    usage_before = repository.daily_request_usage(str(provider["id"]), usage_date)
    hard_ceiling = DAILY_LIMIT - RESERVE_REQUESTS
    if usage_before + len(candidates) > hard_ceiling:
        raise RuntimeError(
            "Replay would cross the protected quota ceiling "
            f"({usage_before}+{len(candidates)}/{hard_ceiling})"
        )

    requeued_value = repository.rpc(
        "requeue_highlightly_dead_basketball_identity_jobs",
        {"p_scope": args.scope, "p_limit": len(candidates)},
    )
    requeued = list(requeued_value or [])
    if len(requeued) != len(candidates):
        raise RuntimeError(
            f"Expected {len(candidates)} requeued jobs, received {len(requeued)}"
        )
    target_ids = {str(row["id"]) for row in requeued}

    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get(
            "HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"
        ),
    )
    results: list[dict[str, Any]] = []
    remaining = set(target_ids)
    repository.set_provider_enabled("highlightly", True)
    try:
        worker = HighlightlyWorker(
            client,
            repository,
            worker_id=f"{args.scope}:basketball-identity-replay",
            enabled=True,
            daily_quota_ceiling=usage_before + len(candidates),
        )
        for _ in candidates:
            result = worker.run_once()
            results.append(result.__dict__)
            if result.status == "idle":
                break
            if str(result.job_id) not in target_ids:
                raise RuntimeError(
                    f"Replay claimed a job outside the bounded target: {result.job_id}"
                )
            remaining.discard(str(result.job_id))
    finally:
        repository.set_provider_enabled("highlightly", False)

    successful = sum(
        1 for row in results if str(row.get("status")) in {"succeeded", "partial"}
    )
    usage_after = repository.daily_request_usage(str(provider["id"]), usage_date)
    provider_disabled = not bool(
        repository.ingestion_context("basketball")["provider"].get("enabled")
    )
    remaining_dead = _dead_candidates(repository, args.scope, 100)

    finalization_error: dict[str, Any] | None = None
    try:
        repository.rpc(
            "finalize_highlightly_shadow_window",
            {"p_scope": args.scope},
        )
    except HighlightlyRepositoryError as exc:
        finalization_error = {"status": exc.status, "body": exc.body}

    completed = (
        successful == len(candidates)
        and not remaining
        and not remaining_dead
        and provider_disabled
        and finalization_error is None
    )
    report.update(
        {
            "targeted": len(candidates),
            "processed": len(candidates) - len(remaining),
            "statuses": [str(row.get("status")) for row in results],
            "unclaimed_target_ids": sorted(remaining),
            "remaining_dead_identity_jobs": len(remaining_dead),
            "highlightly_requests_recorded": usage_after - usage_before,
            "provider_restored_disabled": provider_disabled,
            "finalization_error": finalization_error,
            "recommended_action": (
                "basketball_identity_replay_complete"
                if completed
                else "stop_and_review_basketball_identity_replay"
            ),
        }
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
    return 0 if completed else 1


if __name__ == "__main__":
    raise SystemExit(main())
