"""Read the Phase 7 activation gate without changing data or consuming provider quota."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from typing import Any

from api.highlightly_repository import HighlightlyRepository


ACTIVE_STATUSES = ("pending", "retry", "running")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()

    repository = HighlightlyRepository.from_environment()
    health_rows = repository.select_rows(
        "hl_phase7_window_health_v",
        filters={"scope": args.scope},
        limit=1,
    )
    if not health_rows:
        print(json.dumps({"scope": args.scope, "error": "window_not_found"}, separators=(",", ":")))
        return 2

    health = health_rows[0]
    window_id = str(health["window_id"])
    observations = repository.select_rows(
        "hl_shadow_observations",
        filters={"window_id": window_id},
        order="observed_on.desc,sport.asc",
        limit=100,
    )
    reconciliations = repository.select_rows(
        "hl_source_reconciliations",
        filters={"window_id": window_id},
        order="observed_on.desc,sport.asc",
        limit=200,
    )
    active_jobs: list[dict[str, Any]] = []
    for status in ACTIVE_STATUSES:
        active_jobs.extend(
            repository.select_rows(
                "hl_ingestion_jobs",
                columns="id,status,sport,endpoint_key,scheduled_at,last_error",
                filters={"shadow_scope": args.scope, "status": status},
                limit=1_501,
                order="scheduled_at.asc",
            )
        )

    provider_enabled = bool(
        repository.ingestion_context(str(health["sports"][0]))["provider"].get("enabled")
    )
    gate_status = str(health.get("gate_status") or "blocked")
    failed = provider_enabled or gate_status in {
        "blocked",
        "below_sla",
        "historical_complete_with_exceptions",
        "future_slice_complete_with_exceptions",
    }
    if args.require_ready and gate_status != "ready":
        failed = True
    job_breakdown = Counter(
        (
            str(job.get("sport") or "unknown"),
            str(job.get("status") or "unknown"),
            str(job.get("endpoint_key") or "unknown"),
        )
        for job in active_jobs
    )
    retry_errors = Counter(
        (
            str(job.get("endpoint_key") or "unknown"),
            str(job.get("last_error") or "sem mensagem"),
        )
        for job in active_jobs
        if job.get("status") == "retry"
    )
    report = {
        "scope": args.scope,
        "gate_status": gate_status,
        "provider_disabled_at_rest": not provider_enabled,
        "active_jobs": len(active_jobs),
        "active_job_breakdown": [
            {"sport": sport, "status": status, "endpoint_key": endpoint, "count": count}
            for (sport, status, endpoint), count in job_breakdown.most_common()
        ],
        "retry_error_breakdown": [
            {"endpoint_key": endpoint, "error": error, "count": count}
            for (endpoint, error), count in retry_errors.most_common(25)
        ],
        "health": health,
        "observations": observations,
        "reconciliations": reconciliations,
    }
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
