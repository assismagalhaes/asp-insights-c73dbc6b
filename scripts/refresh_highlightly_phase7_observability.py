"""Refresh Phase 7 reconciliation and health snapshots without provider calls."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json

from api.highlightly_repository import HighlightlyRepository


def _row(value: object) -> dict:
    if isinstance(value, list):
        return dict(value[0]) if value else {}
    return dict(value or {})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    parser.add_argument("--observed-on", default=datetime.now(timezone.utc).date().isoformat())
    args = parser.parse_args()

    repository = HighlightlyRepository.from_environment()
    health_rows = repository.select_rows(
        "hl_phase7_window_health_v",
        filters={"scope": args.scope},
        limit=1,
    )
    if not health_rows:
        raise RuntimeError(f"Phase 7 window not found: {args.scope}")
    health = health_rows[0]
    sports = [str(sport) for sport in (health.get("sports") or [])]
    if not sports:
        raise RuntimeError("Phase 7 window has no sports")
    if repository.ingestion_context(sports[0])["provider"].get("enabled"):
        raise RuntimeError("Highlightly provider is enabled; refusing concurrent observability refresh")

    report: dict[str, dict] = {}
    for sport in sports:
        reconciliation = _row(
            repository.rpc(
                "refresh_highlightly_source_reconciliation",
                {
                    "p_window_id": health["window_id"],
                    "p_observed_on": args.observed_on,
                    "p_sport": sport,
                },
            )
        )
        observation = _row(
            repository.rpc(
                "refresh_highlightly_shadow_observation",
                {
                    "p_window_id": health["window_id"],
                    "p_observed_on": args.observed_on,
                    "p_sport": sport,
                    "p_scope": args.scope,
                    "p_matches_expected": int(reconciliation.get("expected_matches") or 0),
                },
            )
        )
        report[sport] = {"reconciliation": reconciliation, "observation": observation}

    print(json.dumps({"scope": args.scope, "observed_on": args.observed_on, "sports": report}, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
