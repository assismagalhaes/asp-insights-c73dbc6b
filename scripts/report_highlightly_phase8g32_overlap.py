"""Report why valid Football labels do not overlap exact T-24h features."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=200)
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
            "Highlightly provider must be disabled for overlap diagnostics"
        )

    report = repository.rpc(
        "get_highlightly_labeled_feature_overlap_diagnostics_v2",
        {"p_limit": args.limit},
    )
    result = {
        "event": "phase8g32_labeled_feature_overlap_diagnostics",
        "mode": "read-only",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider_enabled": False,
        "provider_calls": 0,
        "database_writes": 0,
        "stored_data_only": True,
        "labels_generated": 0,
        "automatic_training": False,
        "automatic_predictions": False,
        "report": report,
    }
    print(
        json.dumps(
            result,
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
