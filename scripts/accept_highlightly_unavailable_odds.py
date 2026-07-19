"""Accept historical football odds issues caused only by the 1.00 sentinel.

Dry-run is the default. This never changes runs, raw objects, or canonical odds.
"""

from __future__ import annotations

import argparse
import json
from typing import Any, Mapping

from api.highlightly_repository import HighlightlyRepository


ENDPOINT = "football.FootballOddsController_getOddsV2"


def is_unavailable_sentinel(issue: Mapping[str, Any]) -> bool:
    details = issue.get("details") if isinstance(issue.get("details"), Mapping) else {}
    context = details.get("context") if isinstance(details.get("context"), Mapping) else {}
    try:
        return float(context.get("odd")) == 1.0
    except (TypeError, ValueError):
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-accept", action="store_true")
    args = parser.parse_args()

    repository = HighlightlyRepository.from_environment()
    issues = repository.select_rows(
        "hl_data_quality_issues",
        columns="id,endpoint_key,issue_code,severity,resolution_status,details",
        filters={
            "endpoint_key": ENDPOINT,
            "issue_code": "ODDS_QUOTE_INVALID",
            "resolution_status": "open",
        },
        limit=1000,
        order="created_at.asc",
    )
    candidates = [issue for issue in issues if is_unavailable_sentinel(issue)]
    updated = 0
    if args.confirm_accept:
        result = repository.rpc("accept_highlightly_unavailable_odds_issues", {})
        updated = int(result or 0)

    print(
        json.dumps(
            {
                "mode": "execute" if args.confirm_accept else "dry-run",
                "open_invalid_odds_scanned": len(issues),
                "sentinel_candidates": len(candidates),
                "updated": updated,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
