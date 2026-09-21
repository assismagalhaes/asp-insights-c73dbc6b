"""Explicit history-source boundary for ASP MatchMatrix.

The module carries already loaded frames. It never downloads data and makes the
legacy/canonical provenance visible to the model runner.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
from typing import Any

import pandas as pd


REQUIRED_HISTORY_COLUMNS = frozenset(
    {"HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR", "Season", "Liga"}
)
ALLOWED_SOURCES = frozenset({"football_data_legacy", "highlightly_canonical_snapshot"})


@dataclass(frozen=True)
class FootballHistoryBundle:
    current: pd.DataFrame
    previous: pd.DataFrame
    extra: pd.DataFrame
    source: str
    source_max_at: str | None
    provider_calls: int
    canonical_ids: bool


def _copy_and_validate(frame: pd.DataFrame, name: str) -> pd.DataFrame:
    if not isinstance(frame, pd.DataFrame):
        raise TypeError(f"history bundle {name} must be a pandas DataFrame")
    missing = sorted(REQUIRED_HISTORY_COLUMNS - set(frame.columns))
    if missing:
        raise ValueError(f"history bundle {name} missing columns: {missing}")
    result = frame.copy(deep=True)
    if "Date" in result.columns:
        result["Date"] = pd.to_datetime(result["Date"], errors="coerce")
    return result


def build_history_bundle(
    *,
    current: pd.DataFrame,
    previous: pd.DataFrame,
    extra: pd.DataFrame,
    source: str,
    source_max_at: str | None,
    provider_calls: int = 0,
    canonical_ids: bool = False,
) -> FootballHistoryBundle:
    """Build an immutable provenance envelope around in-memory history frames."""
    if source not in ALLOWED_SOURCES:
        raise ValueError(f"unsupported football history source: {source}")
    if not isinstance(provider_calls, int) or provider_calls < 0:
        raise ValueError("provider_calls must be a non-negative integer")
    if source == "highlightly_canonical_snapshot":
        if provider_calls != 0:
            raise ValueError("canonical snapshot history must not call providers")
        if not canonical_ids:
            raise ValueError("canonical snapshot history must preserve canonical IDs")
        if not source_max_at:
            raise ValueError("canonical snapshot history requires source_max_at")
    if source_max_at:
        try:
            datetime.fromisoformat(str(source_max_at).replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("source_max_at must be ISO-8601") from exc
    return FootballHistoryBundle(
        current=_copy_and_validate(current, "current"),
        previous=_copy_and_validate(previous, "previous"),
        extra=_copy_and_validate(extra, "extra"),
        source=source,
        source_max_at=source_max_at,
        provider_calls=provider_calls,
        canonical_ids=canonical_ids,
    )


def history_bundle_manifest(bundle: FootballHistoryBundle) -> dict[str, Any]:
    """Return non-secret source evidence suitable for diagnostics/manifests."""
    return {
        "source": bundle.source,
        "source_max_at": bundle.source_max_at,
        "provider_calls": bundle.provider_calls,
        "canonical_ids": bundle.canonical_ids,
        "current_rows": len(bundle.current),
        "previous_rows": len(bundle.previous),
        "extra_rows": len(bundle.extra),
    }


def freeze_history_bundle_at_cutoff(
    bundle: FootballHistoryBundle,
    *,
    cutoff_at: str,
    kickoff_at: str,
) -> tuple[FootballHistoryBundle, dict[str, Any]]:
    """Freeze history for one target without retaining future outcomes.

    This certifies event time only.  For legacy files, the separate question
    of when the file itself became available remains explicitly uncertified.
    """
    cutoff = pd.to_datetime(cutoff_at, utc=True, errors="coerce")
    kickoff = pd.to_datetime(kickoff_at, utc=True, errors="coerce")
    if pd.isna(cutoff) or pd.isna(kickoff):
        raise ValueError("cutoff_at and kickoff_at must be valid timestamps")
    if cutoff >= kickoff:
        raise ValueError("cutoff_at must be before kickoff_at")

    frozen_frames: dict[str, pd.DataFrame] = {}
    source_dates: list[pd.Timestamp] = []
    for name in ("current", "previous", "extra"):
        frame = getattr(bundle, name)
        if "Date" not in frame.columns:
            raise ValueError(f"history bundle {name} requires Date for cutoff freezing")
        dates = pd.to_datetime(frame["Date"], utc=True, errors="coerce")
        invalid = int(dates.isna().sum())
        if invalid:
            raise ValueError(f"history bundle {name} has {invalid} invalid Date values")
        selected = frame.loc[(dates <= cutoff) & (dates < kickoff)].copy(deep=True)
        selected["Date"] = dates.loc[selected.index].dt.tz_convert(None)
        frozen_frames[name] = selected.reset_index(drop=True)
        source_dates.extend(dates.loc[selected.index].tolist())

    source_max = max(source_dates).isoformat() if source_dates else cutoff.isoformat()
    frozen = build_history_bundle(
        current=frozen_frames["current"],
        previous=frozen_frames["previous"],
        extra=frozen_frames["extra"],
        source=bundle.source,
        source_max_at=source_max,
        provider_calls=0,
        canonical_ids=bundle.canonical_ids,
    )
    serialisable = {
        name: frame.sort_values(list(frame.columns), kind="mergesort").to_dict(orient="records")
        for name, frame in frozen_frames.items()
    }
    fingerprint = hashlib.sha256(
        json.dumps(serialisable, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    ).hexdigest()
    return frozen, {
        **history_bundle_manifest(frozen),
        "cutoff_at": cutoff.isoformat(),
        "kickoff_at": kickoff.isoformat(),
        "history_fingerprint": fingerprint,
        "event_time_certified": True,
        "file_availability_time_certified": bundle.source != "football_data_legacy",
    }
