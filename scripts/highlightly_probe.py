"""Run a small, quota-conscious Highlightly compatibility probe."""

from __future__ import annotations

import argparse
from datetime import date
import json
import os
from pathlib import Path
import sys
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.highlightly_client import HighlightlyClient, HighlightlyError


DEFAULT_SPORTS = ("football", "basketball", "nba", "baseball")


def _summarize(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        data = payload.get("data")
        return {
            "shape": "object",
            "items": len(data) if isinstance(data, list) else None,
            "pagination": payload.get("pagination"),
            "plan": payload.get("plan"),
        }
    if isinstance(payload, list):
        return {"shape": "array", "items": len(payload)}
    return {"shape": type(payload).__name__}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sports", nargs="+", default=list(DEFAULT_SPORTS))
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--include-odds", action="store_true", help="Spend one extra request per sport on /odds")
    parser.add_argument("--output", type=Path, help="Write the redacted JSON result to this path")
    args = parser.parse_args()

    api_key = os.getenv("HIGHLIGHTLY_API_KEY", "")
    if not api_key:
        parser.error("set HIGHLIGHTLY_API_KEY in the environment")

    client = HighlightlyClient(api_key)
    results: list[dict[str, Any]] = []
    for sport in args.sports:
        probes = [("matches", {"date": args.date, "limit": 5})]
        if args.include_odds:
            probes.append(("odds", {"date": args.date, "limit": 5}))
        for resource, params in probes:
            item: dict[str, Any] = {"sport": sport, "resource": resource, "params": params}
            try:
                response = client.get(f"/{sport}/{resource}", params)
                item.update(
                    status=response.status,
                    rate_limit=response.rate_limit,
                    rate_remaining=response.rate_remaining,
                    response=_summarize(response.data),
                )
            except HighlightlyError as exc:
                item.update(status=exc.status, error=str(exc), response=exc.body)
            results.append(item)

    rendered = json.dumps({"probed_at_date": args.date, "results": results}, indent=2, ensure_ascii=False)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
