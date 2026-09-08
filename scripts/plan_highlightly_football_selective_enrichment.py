#!/usr/bin/env python3
"""Plan or explicitly enqueue bounded, scoped football enrichment jobs."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from typing import Any, Sequence

from api.highlightly_repository import HighlightlyRepository

MIN_RESERVE = 1000
DAILY_LIMIT = 7500
MAX_SCOPE_LENGTH = 160


def _utc(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("--at must include a timezone")
    return parsed.astimezone(timezone.utc)


def _scope(value: str) -> str:
    normalized = value.strip()
    if not normalized or len(normalized) > MAX_SCOPE_LENGTH:
        raise argparse.ArgumentTypeError("--scope must contain between 1 and 160 characters")
    return normalized


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--match-id", action="append", required=True)
    parser.add_argument("--scope", type=_scope, help="Collection window that owns every enqueued job")
    parser.add_argument("--at")
    parser.add_argument("--max-jobs", type=int, default=20)
    parser.add_argument("--reserve", type=int, default=MIN_RESERVE)
    parser.add_argument("--enqueue", action="store_true")
    args = parser.parse_args(argv)

    if not 1 <= len(args.match_id) <= 50:
        parser.error("between 1 and 50 --match-id values are required")
    if not 1 <= args.max_jobs <= 100:
        parser.error("--max-jobs must be between 1 and 100")
    if args.reserve < MIN_RESERVE:
        parser.error(f"--reserve cannot be lower than {MIN_RESERVE}")
    if args.enqueue and not args.scope:
        parser.error("--scope is required with --enqueue")

    at = _utc(args.at)
    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    provider = context["provider"]
    usage = repository.daily_request_usage(str(provider["id"]), at.date().isoformat())
    available = max(0, DAILY_LIMIT - args.reserve - usage)
    if available < 1:
        raise SystemExit("no quota is available while preserving the reserve")

    plan: dict[str, Any] = repository.rpc(
        "plan_football_selective_enrichment_v1",
        {
            "p_match_ids": args.match_id,
            "p_as_of": at.isoformat(),
            "p_h2h_ttl": "24 hours",
            "p_statistics_retry_ttl": "30 days",
            "p_limit": min(args.max_jobs, available),
        },
    )
    plan["quota"] = {
        "daily_limit": DAILY_LIMIT,
        "used_before": usage,
        "reserve": args.reserve,
        "available_for_plan": available,
    }
    plan["mode"] = "enqueue" if args.enqueue else "dry-run"
    plan["scope"] = args.scope
    plan["enqueued"] = []

    if args.enqueue:
        if provider.get("enabled"):
            raise SystemExit("provider must remain disabled while jobs are planned")
        jobs = list(plan.get("jobs") or [])
        if len(jobs) > available:
            raise SystemExit("plan would cross the protected quota reserve")
        for item in jobs:
            request_params = dict(item["request_params"])
            request_params["_shadow_scope"] = args.scope
            saved = repository.enqueue_job(
                endpoint_key=str(item["endpoint_key"]),
                sport="football",
                resource=str(item["resource"]),
                dedupe_key=str(item["dedupe_key"]),
                request_params=request_params,
                cursor_data={
                    "source": "phase1_selective_enrichment",
                    "reserve": args.reserve,
                    "shadow_scope": args.scope,
                },
                priority=int(item["priority"]),
                max_attempts=3,
            )
            if saved.get("shadow_scope") != args.scope:
                raise RuntimeError("database did not persist the required selective job scope")
            plan["enqueued"].append({"id": saved.get("id"), "dedupe_key": item["dedupe_key"]})
        plan["enqueue_performed"] = bool(plan["enqueued"])

    print(json.dumps(plan, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
