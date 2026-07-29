"""Materialize audited Phase 8G.2 Football score labels from stored data."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--confirm-materialize", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.days <= 3_650:
        parser.error("--days must be between 1 and 3650")
    if not 1 <= args.limit <= 200:
        parser.error("--limit must be between 1 and 200")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    if context["provider"].get("enabled"):
        raise RuntimeError(
            "Highlightly provider must be disabled for label materialization"
        )

    plan = {
        "event": "phase8g2_score_label_materialization",
        "mode": "execute" if args.confirm_materialize else "dry-run",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sport": "football",
        "label_set": "highlightly_football_postmatch",
        "label_set_version": "1.0.0",
        "label_version": "highlightly_football_postmatch.score.1.0.0",
        "days": args.days,
        "limit": args.limit,
        "provider_enabled": False,
        "provider_calls": 0,
        "score_families_only": True,
        "automatic_training": False,
        "automatic_predictions": False,
    }

    if not args.confirm_materialize:
        plan["preview"] = repository.rpc(
            "get_highlightly_label_settlement_preview_v2",
            {
                "p_sport": "football",
                "p_days": args.days,
                "p_limit": args.limit,
            },
        )
        plan["report"] = repository.rpc(
            "get_highlightly_label_materialization_report_v1",
            {
                "p_sport": "football",
                "p_days": args.days,
            },
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

    plan["result"] = repository.rpc(
        "materialize_highlightly_football_score_labels_v1",
        {
            "p_days": args.days,
            "p_limit": args.limit,
        },
    )
    plan["report"] = repository.rpc(
        "get_highlightly_label_materialization_report_v1",
        {
            "p_sport": "football",
            "p_days": args.days,
        },
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
