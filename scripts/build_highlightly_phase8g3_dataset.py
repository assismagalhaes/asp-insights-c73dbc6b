"""Preview or build the audited Phase 8G.3 Football training dataset."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--confirm-build", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.days <= 3_650:
        parser.error("--days must be between 1 and 3650")
    if not 1 <= args.limit <= 5_000:
        parser.error("--limit must be between 1 and 5000")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    if context["provider"].get("enabled"):
        raise RuntimeError(
            "Highlightly provider must be disabled for dataset builds"
        )

    window_to = datetime.now(timezone.utc)
    window_from = window_to - timedelta(days=args.days)
    rpc_args = {
        "p_from": window_from.isoformat(),
        "p_to": window_to.isoformat(),
        "p_limit": args.limit,
    }
    plan = {
        "event": "phase8g3_training_dataset",
        "mode": "execute" if args.confirm_build else "dry-run",
        "generated_at": window_to.isoformat(),
        "sport": "football",
        "dataset_spec": "highlightly_football_prematch_score",
        "dataset_version": "1.0.0",
        "feature_set": "highlightly_football_prematch@1.2.0",
        "label_version": "highlightly_football_postmatch.score.1.0.0",
        "horizon": "t24h",
        "days": args.days,
        "limit": args.limit,
        "provider_enabled": False,
        "provider_calls": 0,
        "automatic_training": False,
        "automatic_predictions": False,
    }

    if not args.confirm_build:
        plan["preview"] = repository.rpc(
            "get_highlightly_training_dataset_preview_v1",
            rpc_args,
        )
    else:
        plan["result"] = repository.rpc(
            "build_highlightly_football_training_dataset_v1",
            rpc_args,
        )

    plan["report"] = repository.rpc(
        "get_highlightly_training_dataset_report_v1",
        {"p_sport": "football", "p_days": args.days},
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
