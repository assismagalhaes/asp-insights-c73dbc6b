"""Refresh the football canary rollups without making provider calls."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=14)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.days < 1 or args.days > 30:
        raise SystemExit("days must be between 1 and 30")

    at = datetime.now(timezone.utc)
    repository = HighlightlyRepository.from_environment()
    interval = {
        "p_observed_on": at.date().isoformat(),
        "p_from": at.isoformat(),
        "p_to": (at + timedelta(hours=24)).isoformat(),
    }
    league_rows = repository.rpc("refresh_highlightly_odds_league_coverage", interval)
    market_rows = repository.rpc("refresh_highlightly_football_market_coverage", interval)
    gate = repository.rpc(
        "get_highlightly_football_canary_gate_v1", {"p_days": args.days}
    )
    provider_disabled = not bool(
        repository.ingestion_context("football")["provider"].get("enabled")
    )
    print(
        json.dumps(
            {
                "event": "highlightly_football_monitor_refreshed",
                "at": at.isoformat(),
                "provider_calls": 0,
                "league_rows": league_rows,
                "market_rows": market_rows,
                "provider_disabled_at_rest": provider_disabled,
                "gate": gate,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
