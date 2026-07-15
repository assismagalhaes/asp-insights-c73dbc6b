"""Safely drain only the active Highlightly jobs belonging to one shadow scope."""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os

from api.highlightly.worker import HighlightlyWorker
from api.highlightly_client import HighlightlyClient
from api.highlightly_repository import HighlightlyRepository


ACTIVE_STATUSES = ("pending", "retry", "running")


def _active_jobs(repository: HighlightlyRepository, *, limit: int) -> list[dict]:
    rows: list[dict] = []
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True, help="Exact shadow scope embedded in every dedupe key")
    parser.add_argument("--sport", choices=("football", "baseball", "basketball"), default="baseball")
    parser.add_argument("--max-jobs", type=int, default=100)
    parser.add_argument("--confirm-bounded-drain", action="store_true", required=True)
    args = parser.parse_args()
    if args.max_jobs < 1 or args.max_jobs > 200:
        parser.error("--max-jobs must be between 1 and 200")

    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context(args.sport)
    if context["provider"].get("enabled"):
        raise RuntimeError("Highlightly provider was already enabled; refusing a non-isolated drain")

    active_before = _active_jobs(repository, limit=args.max_jobs)
    running = [row for row in active_before if row.get("status") == "running"]
    if running:
        raise RuntimeError("An ingestion job is already running; refusing concurrent drain")
    outsiders = [row for row in active_before if args.scope not in str(row.get("dedupe_key") or "")]
    if outsiders:
        raise RuntimeError("Active ingestion queue contains jobs outside the requested shadow scope")

    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
    )
    results: list[dict] = []
    repository.set_provider_enabled("highlightly", True)
    try:
        worker = HighlightlyWorker(client, repository, worker_id=f"{args.scope}:drain", enabled=True)
        for _ in range(args.max_jobs):
            result = worker.run_once()
            results.append(result.__dict__)
            if result.status == "idle":
                break
    finally:
        repository.set_provider_enabled("highlightly", False)

    active_after = _active_jobs(repository, limit=args.max_jobs)
    provider_disabled = not bool(repository.ingestion_context(args.sport)["provider"].get("enabled"))
    report = {
        "scope": args.scope,
        "sport": args.sport,
        "active_before": len(active_before),
        "processed": sum(row["status"] != "idle" for row in results),
        "statuses": dict(Counter(row["status"] for row in results)),
        "active_after": len(active_after),
        "provider_restored_disabled": provider_disabled,
    }
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    failed = any(row["status"] in {"dead", "retry"} for row in results)
    return 1 if failed or active_after or not provider_disabled else 0


if __name__ == "__main__":
    raise SystemExit(main())
