"""Read the seven-day future-window gate without changing data or quota."""

from __future__ import annotations

import argparse
import json

from api.highlightly_repository import HighlightlyRepository


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()

    repository = HighlightlyRepository.from_environment()
    rows = repository.select_rows("hl_highlightly_future_gate_v", limit=1)
    if not rows:
        print(json.dumps({"error": "future_gate_not_found"}, separators=(",", ":")))
        return 2
    gate = rows[0]
    provider_enabled = bool(repository.ingestion_context("football")["provider"].get("enabled"))
    report = {**gate, "provider_disabled_at_rest": not provider_enabled}
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
    if provider_enabled:
        return 1
    if args.require_ready and gate.get("gate_status") != "ready":
        return 1
    return 0 if gate.get("gate_status") not in {"blocked", "below_sla"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
