"""Print the bounded Phase 8E.1 operational report without provider calls."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
from typing import Any, Iterable, Mapping

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--require-provider-disabled", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.hours <= 168:
        parser.error("--hours must be between 1 and 168")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    report_to = datetime.now(timezone.utc)
    report_from = report_to - timedelta(hours=args.hours)
    repository = HighlightlyRepository.from_environment()
    result = repository.rpc(
        "get_highlightly_match_lifecycle_operational_report",
        {
            "p_from": report_from.isoformat(),
            "p_to": report_to.isoformat(),
        },
    )
    report: dict[str, Any] = (
        dict(result) if isinstance(result, Mapping) else {"payload": result}
    )
    provider = report.get("provider")
    provider_enabled = bool(
        provider.get("enabled") if isinstance(provider, Mapping) else True
    )
    report["event"] = "highlightly_phase8e_operational_report"
    report["report_status"] = "attention" if provider_enabled else "ok"
    print(
        json.dumps(
            report,
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
    )
    return 1 if args.require_provider_disabled and provider_enabled else 0


if __name__ == "__main__":
    raise SystemExit(main())
