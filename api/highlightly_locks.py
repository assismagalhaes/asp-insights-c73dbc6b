"""Shared lock-state helpers for Highlightly queue runners."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def running_lock_blocks_start(
    row: Mapping[str, Any], *, now: datetime | None = None
) -> bool:
    """Return True only when a running job still owns a valid queue lease.

    Missing or malformed lock metadata is treated conservatively as active. An
    expired lease is safe to leave in ``running`` because the canonical claim
    RPC atomically reclaims it before any provider request is made.
    """

    if row.get("status") != "running":
        return False
    expires_at = _parse_timestamp(row.get("lock_expires_at"))
    if expires_at is None:
        return True
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return expires_at >= current
