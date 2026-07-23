"""Restore the Highlightly provider to its disabled at-rest state."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reason", default="systemd-cleanup")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    repository = HighlightlyRepository.from_environment()
    provider = repository.set_provider_enabled("highlightly", False)
    disabled = not bool(provider.get("enabled"))
    print(
        json.dumps(
            {
                "event": "highlightly_provider_cleanup_finished",
                "phase": "8E.1",
                "at": datetime.now(timezone.utc).isoformat(),
                "reason": str(args.reason)[:160],
                "provider_restored_disabled": disabled,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    return 0 if disabled else 1


if __name__ == "__main__":
    raise SystemExit(main())
