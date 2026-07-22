"""Run one idempotent slot of the rolling Highlightly pregame window."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
import json
import subprocess
import sys
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from api.highlightly_repository import HighlightlyRepository
from scripts.run_highlightly_phase7_shadow import (
    DAILY_LIMIT,
    RESERVE_REQUESTS,
    SPORTS,
    _active_jobs,
)


LOCAL_TIMEZONE = ZoneInfo("America/Sao_Paulo")


@dataclass(frozen=True)
class ScheduleSlot:
    name: str
    local_time: time
    start_offset_days: int
    horizon_days: int
    request_budget: int
    max_jobs: int


@dataclass(frozen=True)
class FutureWindowPlan:
    slot: ScheduleSlot
    scheduled_for: datetime
    scope: str
    start_date: date

    @property
    def end_date(self) -> date:
        return self.start_date + timedelta(days=self.slot.horizon_days - 1)


SCHEDULE = (
    ScheduleSlot("morning", time(6, 10), 0, 3, 1_200, 1_200),
    ScheduleSlot("midday", time(12, 10), 0, 2, 1_000, 1_000),
    ScheduleSlot("evening", time(18, 10), 0, 2, 1_000, 1_000),
    ScheduleSlot("night", time(22, 10), 1, 5, 2_500, 2_500),
)
PLANNED_DAILY_BUDGET = sum(slot.request_budget for slot in SCHEDULE)

if PLANNED_DAILY_BUDGET > DAILY_LIMIT - RESERVE_REQUESTS:
    raise RuntimeError("Future schedule exceeds the Highlightly usable daily ceiling")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def most_recent_slot(now: datetime) -> tuple[ScheduleSlot, datetime]:
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    local_now = now.astimezone(LOCAL_TIMEZONE)
    candidates: list[tuple[ScheduleSlot, datetime]] = []
    for target_date in (local_now.date() - timedelta(days=1), local_now.date()):
        for slot in SCHEDULE:
            scheduled = datetime.combine(target_date, slot.local_time, LOCAL_TIMEZONE)
            if scheduled <= local_now:
                candidates.append((slot, scheduled))
    if not candidates:
        raise RuntimeError("Could not resolve a Highlightly future schedule slot")
    return max(candidates, key=lambda candidate: candidate[1])


def build_plan(now: datetime) -> FutureWindowPlan:
    slot, scheduled_for = most_recent_slot(now)
    start_date = scheduled_for.date() + timedelta(days=slot.start_offset_days)
    scope = f"future-{scheduled_for.strftime('%Y%m%dT%H%M')}-{slot.name}"
    return FutureWindowPlan(
        slot=slot,
        scheduled_for=scheduled_for,
        scope=scope,
        start_date=start_date,
    )


def build_phase7_command(plan: FutureWindowPlan) -> list[str]:
    return [
        sys.executable,
        "-m",
        "scripts.run_highlightly_phase7_shadow",
        "--scope",
        plan.scope,
        "--data-start",
        plan.start_date.isoformat(),
        "--backfill-days",
        str(plan.slot.horizon_days),
        "--all-football-leagues",
        "--fanout-mode",
        "pregame",
        "--daily-request-budget",
        str(plan.slot.request_budget),
        "--max-jobs",
        str(plan.slot.max_jobs),
        "--confirm-phase7-shadow",
    ]


def _provider(repository: HighlightlyRepository) -> dict[str, Any]:
    contexts = [repository.ingestion_context(sport) for sport in SPORTS]
    provider_ids = {str(context["provider"]["id"]) for context in contexts}
    if len(provider_ids) != 1:
        raise RuntimeError("Selected sports do not resolve to one Highlightly provider")
    return dict(contexts[0]["provider"])


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-future-window", action="store_true")
    return parser.parse_args(argv)


def _report(plan: FutureWindowPlan, *, mode: str, event: str, **extra: Any) -> dict[str, Any]:
    return {
        "mode": mode,
        "event": event,
        "scope": plan.scope,
        "slot": plan.slot.name,
        "scheduled_for": plan.scheduled_for.isoformat(),
        "timezone": str(LOCAL_TIMEZONE),
        "date_start": plan.start_date.isoformat(),
        "date_end": plan.end_date.isoformat(),
        "sports": list(SPORTS),
        "fanout_mode": "pregame",
        "request_budget": plan.slot.request_budget,
        "max_jobs": plan.slot.max_jobs,
        "planned_daily_budget": PLANNED_DAILY_BUDGET,
        "daily_limit": DAILY_LIMIT,
        "reserve_requests": RESERVE_REQUESTS,
        **extra,
    }


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    plan = build_plan(_now_utc())
    mode = "execute" if args.confirm_future_window else "dry-run"
    if not args.confirm_future_window:
        print(json.dumps(_report(plan, mode=mode, event="future_window_plan"), ensure_ascii=False))
        return 0

    repository = HighlightlyRepository.from_environment()
    provider = _provider(repository)
    if provider.get("enabled"):
        print(
            json.dumps(
                _report(plan, mode=mode, event="future_window_skipped", reason="provider_enabled"),
                ensure_ascii=False,
            )
        )
        return 0

    active = _active_jobs(repository, limit=5_000)
    if active:
        print(
            json.dumps(
                _report(
                    plan,
                    mode=mode,
                    event="future_window_skipped",
                    reason="active_ingestion_queue",
                    active_jobs=len(active),
                ),
                ensure_ascii=False,
            )
        )
        return 0

    usage_date = _now_utc().date().isoformat()
    usage = repository.daily_request_usage(str(provider["id"]), usage_date)
    if usage >= DAILY_LIMIT - RESERVE_REQUESTS:
        print(
            json.dumps(
                _report(
                    plan,
                    mode=mode,
                    event="future_window_skipped",
                    reason="quota_reserve",
                    requests_used=usage,
                ),
                ensure_ascii=False,
            )
        )
        return 0

    completed = subprocess.run(build_phase7_command(plan), check=False)
    print(
        json.dumps(
            _report(
                plan,
                mode=mode,
                event="future_window_finished" if completed.returncode == 0 else "future_window_failed",
                returncode=completed.returncode,
            ),
            ensure_ascii=False,
        )
    )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
