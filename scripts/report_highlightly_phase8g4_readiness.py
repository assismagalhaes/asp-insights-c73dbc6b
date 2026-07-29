"""Report deterministic Football training readiness without training."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    args = parser.parse_args(argv)
    if not 1 <= args.days <= 3_650:
        parser.error("--days must be between 1 and 3650")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    if context["provider"].get("enabled"):
        raise RuntimeError(
            "Highlightly provider must be disabled for readiness reporting"
        )

    report = repository.rpc(
        "get_highlightly_training_readiness_report_v1",
        {"p_sport": "football", "p_days": args.days},
    )
    result = {
        "event": "phase8g4_training_readiness",
        "mode": "read-only",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sport": "football",
        "window_days": args.days,
        "provider_enabled": False,
        "provider_calls": 0,
        "database_writes": 0,
        "stored_data_only": True,
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
