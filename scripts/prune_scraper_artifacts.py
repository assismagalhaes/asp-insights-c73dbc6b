"""Bounded retention for legacy scraper artifacts.

Dry-run is the default. Pass --confirm-prune only after consolidated snapshots
have been persisted successfully in Supabase.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


@dataclass(frozen=True)
class Candidate:
    path: Path
    reason: str
    size: int


def _job_created_at(path: Path) -> datetime:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        value = payload.get("finalizado_em") or payload.get("created_at")
        if value:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)


def collect_candidates(
    root: Path,
    now: datetime,
    completed_days: int = 90,
    failed_days: int = 180,
    job_metadata_days: int = 365,
) -> list[Candidate]:
    jobs_dir = root / "jobs"
    candidates: dict[Path, Candidate] = {}
    for job_path in jobs_dir.glob("*.json"):
        try:
            payload = json.loads(job_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        job_id = str(payload.get("job_id") or job_path.stem)
        status = str(payload.get("status") or "").upper()
        completed_at = _job_created_at(job_path)
        artifact_days = failed_days if status in {"ERRO", "ERROR", "FAILED"} else completed_days
        if completed_at <= now - timedelta(days=artifact_days):
            paths = [
                root / "outputs" / "raw" / f"{job_id}.json",
                root / "outputs" / "normalized" / f"{job_id}.json",
            ]
            paths.extend((root / "outputs" / "exports").glob(f"{job_id}_*"))
            for path in paths:
                if path.is_file():
                    candidates[path] = Candidate(path, f"{status or 'UNKNOWN'}>{artifact_days}d", path.stat().st_size)
        if completed_at <= now - timedelta(days=job_metadata_days):
            candidates[job_path] = Candidate(
                job_path,
                f"job_metadata>{job_metadata_days}d",
                job_path.stat().st_size,
            )
    return sorted(candidates.values(), key=lambda item: str(item.path))


def main() -> int:
    parser = argparse.ArgumentParser(description="Prune old scraper artifacts (dry-run by default).")
    parser.add_argument("--root", type=Path, default=Path.home() / "asp-scraper-api")
    parser.add_argument("--completed-days", type=int, default=90)
    parser.add_argument("--failed-days", type=int, default=180)
    parser.add_argument("--job-metadata-days", type=int, default=365)
    parser.add_argument("--max-files", type=int, default=100)
    parser.add_argument("--confirm-prune", action="store_true")
    args = parser.parse_args()
    if min(args.completed_days, args.failed_days, args.job_metadata_days, args.max_files) < 1:
        parser.error("retention periods and --max-files must be positive")
    root = args.root.resolve()
    if root.name != "asp-scraper-api":
        parser.error("--root must resolve to a directory named asp-scraper-api")

    candidates = collect_candidates(
        root,
        datetime.now(timezone.utc),
        args.completed_days,
        args.failed_days,
        args.job_metadata_days,
    )[: args.max_files]
    deleted = 0
    for candidate in candidates:
        action = "DELETE" if args.confirm_prune else "WOULD_DELETE"
        print(json.dumps({"action": action, "path": str(candidate.path), "reason": candidate.reason, "bytes": candidate.size}))
        if args.confirm_prune:
            candidate.path.unlink()
            deleted += 1
    print(json.dumps({"mode": "execute" if args.confirm_prune else "dry-run", "candidates": len(candidates), "deleted": deleted}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
