"""Backfill stored T-24h features only for valid labeled Football matches."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--confirm-backfill", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= 200:
        parser.error("--limit must be between 1 and 200")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    if context["provider"].get("enabled"):
        raise RuntimeError(
            "Highlightly provider must be disabled for feature backfill"
        )

    plan = {
        "event": "phase8g31_labeled_feature_backfill",
        "mode": "execute" if args.confirm_backfill else "dry-run",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sport": "football",
        "feature_set": "highlightly_football_prematch@1.2.0",
        "label_version": "highlightly_football_postmatch.score.1.0.0",
        "horizon": "t24h",
        "limit": args.limit,
        "provider_enabled": False,
        "provider_calls": 0,
        "stored_data_only": True,
        "labels_generated": 0,
        "automatic_training": False,
        "automatic_predictions": False,
    }

    if args.confirm_backfill:
        plan["result"] = repository.rpc(
            "backfill_highlightly_football_labeled_features_v1",
            {"p_limit": args.limit},
        )
    else:
        plan["preview"] = repository.rpc(
            "get_highlightly_labeled_feature_backfill_preview_v1",
            {"p_limit": args.limit},
        )

    print(
        json.dumps(
            plan,
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
