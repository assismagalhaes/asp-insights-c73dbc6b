"""Accept only the known quarantined WNBA standings corruption issues."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from typing import Any

from api.highlightly_repository import HighlightlyRepository


ISSUE_CODE = "BASKETBALL_STANDINGS_CORRUPTED"
ENDPOINT = "basketball.BasketballStandingsController_getStandings"


def _scope_candidates(repository: HighlightlyRepository, scope: str) -> list[dict[str, Any]]:
    issues = repository.select_rows(
        "hl_data_quality_issues",
        columns="id,run_id,issue_code,severity,resolution_status,endpoint_key,details",
        filters={
            "sport": "basketball",
            "issue_code": ISSUE_CODE,
            "severity": "critical",
            "resolution_status": "open",
            "endpoint_key": ENDPOINT,
        },
        limit=1_000,
    )
    selected: list[dict[str, Any]] = []
    for issue in issues:
        context = (issue.get("details") or {}).get("context") or {}
        if not (
            str(context.get("leagueId")) == "11847"
            and int(context.get("rows") or 0) == 30
            and int(context.get("distinctTeams") or 0) == 1
            and context.get("duplicateWithinGroup") is True
        ):
            continue
        runs = repository.select_rows(
            "hl_ingestion_runs",
            columns="id,job_id",
            filters={"id": issue["run_id"]},
            limit=1,
        )
        if not runs:
            continue
        jobs = repository.select_rows(
            "hl_ingestion_jobs",
            columns="id,shadow_scope",
            filters={"id": runs[0]["job_id"]},
            limit=1,
        )
        if jobs and jobs[0].get("shadow_scope") == scope:
            selected.append(issue)
    return selected


def _as_row(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        return dict(value[0]) if value else {}
    return dict(value or {})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    parser.add_argument("--confirm-accept", action="store_true")
    args = parser.parse_args()

    repository = HighlightlyRepository.from_environment()
    provider = repository.ingestion_context("basketball")["provider"]
    if provider.get("enabled"):
        raise RuntimeError("Highlightly provider must be disabled before issue acceptance")

    candidates = _scope_candidates(repository, args.scope)
    report: dict[str, Any] = {
        "scope": args.scope,
        "mode": "execute" if args.confirm_accept else "dry-run",
        "eligible": len(candidates),
        "issue_code": ISSUE_CODE,
        "league_id": "11847",
        "provider_disabled_at_rest": True,
    }
    if not args.confirm_accept:
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
        return 0

    accepted = int(
        repository.rpc(
            "accept_highlightly_quarantined_wnba_standings_issues",
            {"p_scope": args.scope},
        )
        or 0
    )
    if accepted != len(candidates):
        raise RuntimeError(f"Expected to accept {len(candidates)} issues, accepted {accepted}")

    windows = repository.select_rows(
        "hl_shadow_windows",
        columns="id,scope",
        filters={"scope": args.scope},
        limit=1,
    )
    refreshed: dict[str, Any] = {}
    if windows:
        observations = repository.select_rows(
            "hl_shadow_observations",
            columns="matches_expected",
            filters={"window_id": windows[0]["id"], "sport": "basketball"},
            order="observed_on.desc",
            limit=1,
        )
        refreshed = _as_row(
            repository.rpc(
                "refresh_highlightly_shadow_observation",
                {
                    "p_window_id": windows[0]["id"],
                    "p_observed_on": datetime.now(timezone.utc).date().isoformat(),
                    "p_sport": "basketball",
                    "p_scope": args.scope,
                    "p_matches_expected": int(
                        observations[0].get("matches_expected") or 0
                    )
                    if observations
                    else 0,
                },
            )
        )

    remaining = _scope_candidates(repository, args.scope)
    report.update(
        {
            "accepted": accepted,
            "remaining": len(remaining),
            "refreshed_open_critical_issues": refreshed.get("open_critical_issues"),
            "provider_disabled_after": not bool(
                repository.ingestion_context("basketball")["provider"].get("enabled")
            ),
        }
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
    return 0 if not remaining and report["provider_disabled_after"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
