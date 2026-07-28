"""Materialize Phase 8F point-in-time features without provider calls."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


HORIZONS = ("t24h", "t6h", "t60m")


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="window_from", type=_parse_timestamp, required=True)
    parser.add_argument("--to", dest="window_to", type=_parse_timestamp, required=True)
    parser.add_argument("--horizon", choices=HORIZONS, default="t24h")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--confirm-materialize", action="store_true")
    args = parser.parse_args(argv)
    if args.window_from >= args.window_to:
        parser.error("--from must be before --to")
    if not 1 <= args.limit <= 5_000:
        parser.error("--limit must be between 1 and 5000")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    if context["provider"].get("enabled"):
        raise RuntimeError("Highlightly provider must be disabled for feature materialization")

    plan = {
        "mode": "execute" if args.confirm_materialize else "dry-run",
        "event": "phase8f_feature_materialization",
        "sport": "football",
        "feature_set": "highlightly_football_prematch",
        "version": "1.2.0",
        "window_from": args.window_from.isoformat(),
        "window_to": args.window_to.isoformat(),
        "horizon": args.horizon,
        "limit": args.limit,
        "provider_calls": 0,
        "labels_generated": 0,
        "automatic_predictions": False,
    }
    if not args.confirm_materialize:
        plan["current_report"] = repository.rpc(
            "get_highlightly_feature_store_report_v6",
            {"p_sport": "football", "p_days": 30},
        )
        print(json.dumps(plan, ensure_ascii=False, separators=(",", ":"), default=str))
        return 0

    plan["result"] = repository.rpc(
        "materialize_highlightly_football_features_v3",
        {
            "p_from": args.window_from.isoformat(),
            "p_to": args.window_to.isoformat(),
            "p_horizon_key": args.horizon,
            "p_limit": args.limit,
        },
    )
    plan["report"] = repository.rpc(
        "get_highlightly_feature_store_report_v6",
        {"p_sport": "football", "p_days": 30},
    )
    print(json.dumps(plan, ensure_ascii=False, separators=(",", ":"), default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
