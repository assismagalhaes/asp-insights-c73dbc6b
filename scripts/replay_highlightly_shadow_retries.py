"""Replay bounded Highlightly shadow retries from saved raw payloads only."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os

from api.highlightly_locks import running_lock_blocks_start
from api.highlightly.worker import HighlightlyWorker
from api.highlightly_client import HighlightlyClient
from api.highlightly_repository import HighlightlyRepository


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    parser.add_argument("--sport", choices=("football", "baseball", "basketball"), required=True)
    parser.add_argument("--max-jobs", type=int, default=100)
    parser.add_argument("--confirm-raw-replay", action="store_true", required=True)
    args = parser.parse_args()
    if args.max_jobs < 1 or args.max_jobs > 200:
        parser.error("--max-jobs must be between 1 and 200")

    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context(args.sport)
    provider = context["provider"]
    if provider.get("enabled"):
        raise RuntimeError("Highlightly provider was already enabled; refusing a non-isolated replay")
    running = repository.select_rows(
        "hl_ingestion_jobs",
        columns="id,status,lock_expires_at",
        filters={"status": "running"},
        limit=1,
        order="lock_expires_at.desc",
    )
    if any(running_lock_blocks_start(row) for row in running):
        raise RuntimeError("An ingestion job is already running; refusing concurrent replay")

    retry_jobs = repository.select_rows(
        "hl_ingestion_jobs",
        columns="*",
        filters={"shadow_scope": args.scope, "sport": args.sport, "status": "retry"},
        order="scheduled_at.asc,created_at.asc",
        limit=args.max_jobs,
    )
    if not retry_jobs:
        print(json.dumps({"scope": args.scope, "sport": args.sport, "replayed": 0}, separators=(",", ":")))
        return 0

    target_ids = {str(job["id"]) for job in retry_jobs}

    prepared: list[dict] = []
    for job in retry_jobs:
        raw_rows = repository.select_rows(
            "hl_raw_objects",
            columns="id,job_id,created_at",
            filters={"job_id": job["id"]},
            order="created_at.desc",
            limit=1,
        )
        if not raw_rows:
            raise RuntimeError(f"Retry job has no saved raw payload: {job['id']}")
        prepared.append({"job": job, "raw": raw_rows[0]})

    request_date = datetime.now(timezone.utc).date().isoformat()
    usage_before = repository.daily_request_usage(str(provider["id"]), request_date)
    replay_rows: list[dict] = []
    for item in prepared:
        replay_rows.append(
            {
                **item["job"],
                "reprocess_raw_object_id": item["raw"]["id"],
                "priority": 0,
                "scheduled_at": "1970-01-01T00:00:00+00:00",
            }
        )
    repository.upsert_rows("hl_ingestion_jobs", replay_rows, on_conflict="id")

    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
    )
    results: list[dict] = []
    remaining_targets = set(target_ids)
    repository.set_provider_enabled("highlightly", True)
    try:
        worker = HighlightlyWorker(
            client,
            repository,
            worker_id=f"{args.scope}:raw-replay",
            enabled=True,
        )
        for _ in prepared:
            result = worker.run_once()
            materialized = result.__dict__
            results.append(materialized)
            if result.status == "idle":
                break
            if str(result.job_id) not in target_ids:
                raise RuntimeError(f"Replay claimed a job outside its bounded target: {result.job_id}")
            remaining_targets.discard(str(result.job_id))
    finally:
        repository.set_provider_enabled("highlightly", False)

    usage_after = repository.daily_request_usage(str(provider["id"]), request_date)
    provider_disabled = not bool(repository.ingestion_context(args.sport)["provider"].get("enabled"))
    report = {
        "scope": args.scope,
        "sport": args.sport,
        "targeted": len(prepared),
        "processed": sum(row["status"] != "idle" for row in results),
        "statuses": dict(Counter(row["status"] for row in results)),
        "unclaimed_target_ids": sorted(remaining_targets),
        "highlightly_requests_added": usage_after - usage_before,
        "provider_restored_disabled": provider_disabled,
    }
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    failed = any(row["status"] in {"dead", "retry"} for row in results)
    return 1 if failed or remaining_targets or usage_after != usage_before or not provider_disabled else 0


if __name__ == "__main__":
    raise SystemExit(main())
