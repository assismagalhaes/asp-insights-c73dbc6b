"""Run a resumable Highlightly backfill across an inclusive date range."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time as time_module
from typing import Any, Iterable

from api.highlightly_repository import HighlightlyRepository
from scripts.run_highlightly_phase7_shadow import (
    ACTIVE_STATUSES,
    BACKFILL_BUDGET_LIMIT,
    DAILY_LIMIT,
    RESERVE_REQUESTS,
    SPORTS,
)


MAX_CHUNK_DAYS = 7
DEFAULT_POLL_SECONDS = 300


@dataclass(frozen=True)
class DateChunk:
    start: date
    days: int

    @property
    def end(self) -> date:
        return self.start + timedelta(days=self.days - 1)


def split_date_range(start: date, end: date) -> list[DateChunk]:
    if end < start:
        raise ValueError("date end must be on or after date start")
    chunks: list[DateChunk] = []
    cursor = start
    while cursor <= end:
        days = min(MAX_CHUNK_DAYS, (end - cursor).days + 1)
        chunks.append(DateChunk(cursor, days))
        cursor += timedelta(days=days)
    return chunks


def seconds_until_next_utc_day(now: datetime, *, buffer_seconds: int = 120) -> float:
    current = now.astimezone(timezone.utc)
    next_day = datetime.combine(current.date() + timedelta(days=1), time.min, timezone.utc)
    return max(1.0, (next_day - current).total_seconds() + buffer_seconds)


def _load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"next_chunk_index": 0}
    return json.loads(path.read_text(encoding="utf-8"))


def _save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _active_scope_jobs(repository: HighlightlyRepository, scope: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for status in ACTIVE_STATUSES:
        page = repository.select_rows(
            "hl_ingestion_jobs",
            columns="id,status,dedupe_key,scheduled_for",
            filters={"status": status},
            limit=5_001,
            order="created_at.asc",
        )
        outsiders = [row for row in page if scope not in str(row.get("dedupe_key") or "")]
        if outsiders:
            raise RuntimeError("Active ingestion queue contains jobs outside the requested range scope")
        rows.extend(page)
    return rows


def _provider(repository: HighlightlyRepository) -> dict[str, Any]:
    contexts = [repository.ingestion_context(sport) for sport in SPORTS]
    provider_ids = {str(context["provider"]["id"]) for context in contexts}
    if len(provider_ids) != 1:
        raise RuntimeError("Selected sports do not resolve to one Highlightly provider")
    provider = contexts[0]["provider"]
    if provider.get("enabled"):
        raise RuntimeError("Highlightly provider must be disabled before starting the range runner")
    return provider


def build_slice_command(
    *, scope: str, chunk: DateChunk, daily_request_budget: int, max_jobs: int
) -> list[str]:
    return [
        sys.executable,
        "-m",
        "scripts.run_highlightly_phase7_shadow",
        "--scope",
        scope,
        "--data-start",
        chunk.start.isoformat(),
        "--backfill-days",
        str(chunk.days),
        "--all-football-leagues",
        "--daily-request-budget",
        str(daily_request_budget),
        "--max-jobs",
        str(max_jobs),
        "--confirm-phase7-shadow",
    ]


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    parser.add_argument("--date-start", type=date.fromisoformat, required=True)
    parser.add_argument("--date-end", type=date.fromisoformat, required=True)
    parser.add_argument("--daily-request-budget", type=int, default=BACKFILL_BUDGET_LIMIT)
    parser.add_argument("--max-jobs", type=int, default=5_000)
    parser.add_argument("--poll-seconds", type=int, default=DEFAULT_POLL_SECONDS)
    parser.add_argument("--state-file", type=Path, required=True)
    parser.add_argument("--confirm-date-range", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.daily_request_budget <= BACKFILL_BUDGET_LIMIT:
        parser.error(f"--daily-request-budget must be between 1 and {BACKFILL_BUDGET_LIMIT}")
    if not 1 <= args.max_jobs <= 5_000:
        parser.error("--max-jobs must be between 1 and 5000")
    if not 1 <= args.poll_seconds <= 3_600:
        parser.error("--poll-seconds must be between 1 and 3600")
    if args.date_end < args.date_start:
        parser.error("--date-end must be on or after --date-start")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    chunks = split_date_range(args.date_start, args.date_end)
    plan = {
        "mode": "execute" if args.confirm_date_range else "dry-run",
        "scope": args.scope,
        "date_start": args.date_start.isoformat(),
        "date_end": args.date_end.isoformat(),
        "sports": list(SPORTS),
        "all_football_leagues": True,
        "include_finished_matches": True,
        "daily_limit": DAILY_LIMIT,
        "reserve_requests": RESERVE_REQUESTS,
        "usable_daily_ceiling": DAILY_LIMIT - RESERVE_REQUESTS,
        "chunks": [
            {**asdict(chunk), "start": chunk.start.isoformat(), "end": chunk.end.isoformat()}
            for chunk in chunks
        ],
    }
    if not args.confirm_date_range:
        print(json.dumps(plan, ensure_ascii=False, separators=(",", ":")))
        return 0

    state = _load_state(args.state_file)
    expected = {
        "scope": args.scope,
        "date_start": args.date_start.isoformat(),
        "date_end": args.date_end.isoformat(),
    }
    for key, value in expected.items():
        if key in state and state[key] != value:
            raise RuntimeError(f"State file belongs to a different {key}")
        state[key] = value
    state.setdefault("next_chunk_index", 0)
    _save_state(args.state_file, state)

    repository = HighlightlyRepository.from_environment()
    provider = _provider(repository)
    hard_ceiling = DAILY_LIMIT - RESERVE_REQUESTS

    while state["next_chunk_index"] < len(chunks):
        chunk_index = int(state["next_chunk_index"])
        chunk = chunks[chunk_index]
        usage_date = datetime.now(timezone.utc).date().isoformat()
        usage = repository.daily_request_usage(str(provider["id"]), usage_date)
        if usage >= hard_ceiling:
            wait_seconds = seconds_until_next_utc_day(datetime.now(timezone.utc))
            print(json.dumps({"event": "quota_wait", "usage": usage, "seconds": wait_seconds}), flush=True)
            time_module.sleep(wait_seconds)
            continue

        command = build_slice_command(
            scope=args.scope,
            chunk=chunk,
            daily_request_budget=args.daily_request_budget,
            max_jobs=args.max_jobs,
        )
        print(
            json.dumps(
                {"event": "slice_start", "chunk_index": chunk_index, "start": chunk.start.isoformat(), "end": chunk.end.isoformat()}
            ),
            flush=True,
        )
        completed = subprocess.run(command, check=False)
        if completed.returncode != 0:
            raise RuntimeError(f"Phase 7 slice exited with code {completed.returncode}")

        active = _active_scope_jobs(repository, args.scope)
        if active:
            current_usage = repository.daily_request_usage(
                str(provider["id"]), datetime.now(timezone.utc).date().isoformat()
            )
            wait_seconds = (
                seconds_until_next_utc_day(datetime.now(timezone.utc))
                if current_usage >= hard_ceiling
                else float(args.poll_seconds)
            )
            print(
                json.dumps({"event": "active_jobs_wait", "active": len(active), "usage": current_usage, "seconds": wait_seconds}),
                flush=True,
            )
            time_module.sleep(wait_seconds)
            continue

        state["next_chunk_index"] = chunk_index + 1
        state["last_completed_date"] = chunk.end.isoformat()
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_state(args.state_file, state)

    if _provider(repository).get("enabled"):
        raise RuntimeError("Highlightly provider was not restored to disabled")
    state["completed_at"] = datetime.now(timezone.utc).isoformat()
    _save_state(args.state_file, state)
    print(json.dumps({**plan, "event": "range_complete", "state": state}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
