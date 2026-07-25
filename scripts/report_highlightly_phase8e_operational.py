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
    parser.add_argument(
        "--recover-provider",
        action="store_true",
        help="Restore a stale enabled provider. Use only while holding the global collection lock.",
    )
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
    rpc_payload = {
        "p_from": report_from.isoformat(),
        "p_to": report_to.isoformat(),
    }
    result = repository.rpc(
        "get_highlightly_match_lifecycle_operational_report_v2",
        rpc_payload,
    )
    report: dict[str, Any] = (
        dict(result) if isinstance(result, Mapping) else {"payload": result}
    )
    provider = report.get("provider")
    provider_enabled = bool(
        provider.get("enabled") if isinstance(provider, Mapping) else True
    )
    provider_recovery = {
        "attempted": False,
        "was_enabled": provider_enabled,
        "restored_disabled": not provider_enabled,
    }
    recovered = False
    if provider_enabled and args.recover_provider:
        provider_recovery["attempted"] = True
        restored_provider = repository.set_provider_enabled("highlightly", False)
        provider_recovery["restored_disabled"] = not bool(
            restored_provider.get("enabled")
        )
        if provider_recovery["restored_disabled"]:
            refreshed_result = repository.rpc(
                "get_highlightly_match_lifecycle_operational_report_v2",
                rpc_payload,
            )
            report = (
                dict(refreshed_result)
                if isinstance(refreshed_result, Mapping)
                else {"payload": refreshed_result}
            )
            provider = report.get("provider")
            provider_enabled = bool(
                provider.get("enabled") if isinstance(provider, Mapping) else True
            )
            recovered = not provider_enabled

    report["event"] = "highlightly_phase8e_operational_report"
    report["provider_recovery"] = provider_recovery
    report["report_status"] = (
        "attention" if provider_enabled else "recovered" if recovered else "ok"
    )
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
