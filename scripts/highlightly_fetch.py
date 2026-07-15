"""Fetch one Highlightly endpoint for manual contract inspection.

The API key comes from HIGHLIGHTLY_API_KEY and is never written to output.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.highlightly_client import HighlightlyClient, HighlightlyError


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Endpoint path, for example /football/matches")
    parser.add_argument("--param", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    api_key = os.getenv("HIGHLIGHTLY_API_KEY", "")
    if not api_key:
        parser.error("set HIGHLIGHTLY_API_KEY in the environment")
    params = {}
    for pair in args.param:
        if "=" not in pair:
            parser.error(f"invalid --param {pair!r}; expected KEY=VALUE")
        key, value = pair.split("=", 1)
        params[key] = value

    try:
        response = HighlightlyClient(api_key).get(args.path, params)
        result = {
            "request": {"path": args.path, "params": params},
            "status": response.status,
            "rate_limit": response.rate_limit,
            "rate_remaining": response.rate_remaining,
            "data": response.data,
        }
    except HighlightlyError as exc:
        result = {"request": {"path": args.path, "params": params}, "status": exc.status, "error": str(exc), "data": exc.body}

    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0 if result["status"] == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
