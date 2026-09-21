from __future__ import annotations

import sys
import importlib.util
import importlib.machinery
import types
from pathlib import Path

import pandas as pd
import pytest


MODELOS = Path(__file__).resolve().parents[1] / "modelos"
if str(MODELOS) not in sys.path:
    sys.path.insert(0, str(MODELOS))

if importlib.util.find_spec("requests") is None:
    requests_stub = types.ModuleType("requests")
    requests_stub.__spec__ = importlib.machinery.ModuleSpec("requests", loader=None)
    requests_stub.Session = object
    sys.modules["requests"] = requests_stub

if importlib.util.find_spec("scipy") is None:
    scipy_stub = types.ModuleType("scipy")
    stats_stub = types.ModuleType("scipy.stats")
    scipy_stub.__spec__ = importlib.machinery.ModuleSpec("scipy", loader=None)
    stats_stub.__spec__ = importlib.machinery.ModuleSpec("scipy.stats", loader=None)
    stats_stub.poisson = object()
    stats_stub.nbinom = object()
    scipy_stub.stats = stats_stub
    sys.modules["scipy"] = scipy_stub
    sys.modules["scipy.stats"] = stats_stub

import prognosticos_football_real as model
from football_history_source import (
    build_history_bundle,
    freeze_history_bundle_at_cutoff,
    history_bundle_manifest,
)


COLUMNS = ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR", "Season", "Liga"]


def frame():
    return pd.DataFrame(
        [["2026-09-01", "Home", "Away", 2, 1, "H", "2026-27", "ENG - Premier League"]],
        columns=COLUMNS,
    )


def canonical_bundle():
    return build_history_bundle(
        current=frame(),
        previous=frame(),
        extra=pd.DataFrame(columns=COLUMNS),
        source="highlightly_canonical_snapshot",
        source_max_at="2026-09-10T12:00:00+00:00",
        provider_calls=0,
        canonical_ids=True,
    )


def test_supplied_canonical_bundle_skips_legacy_acquisition(monkeypatch):
    def forbidden(_):
        raise AssertionError("legacy acquisition must not run")

    monkeypatch.setattr(model, "_load_legacy_history_bundle", forbidden)
    resolved = model._resolve_history_bundle(["ENG - Premier League"], canonical_bundle())
    assert resolved.source == "highlightly_canonical_snapshot"
    assert resolved.provider_calls == 0
    assert history_bundle_manifest(resolved)["current_rows"] == 1


def test_no_supplied_bundle_uses_explicit_legacy_baseline(monkeypatch):
    legacy = build_history_bundle(
        current=frame(), previous=frame(), extra=pd.DataFrame(columns=COLUMNS),
        source="football_data_legacy", source_max_at=None,
    )
    monkeypatch.setattr(model, "_load_legacy_history_bundle", lambda leagues: legacy)
    assert model._resolve_history_bundle(["ENG - Premier League"], None).source == "football_data_legacy"


def test_bundle_copies_caller_frames():
    original = frame()
    bundle = build_history_bundle(
        current=original, previous=frame(), extra=pd.DataFrame(columns=COLUMNS),
        source="highlightly_canonical_snapshot",
        source_max_at="2026-09-10T12:00:00+00:00", canonical_ids=True,
    )
    bundle.current.loc[0, "FTHG"] = 99
    assert original.loc[0, "FTHG"] == 2


def test_canonical_bundle_rejects_provider_calls():
    with pytest.raises(ValueError, match="must not call providers"):
        build_history_bundle(
            current=frame(), previous=frame(), extra=pd.DataFrame(columns=COLUMNS),
            source="highlightly_canonical_snapshot",
            source_max_at="2026-09-10T12:00:00+00:00",
            provider_calls=1, canonical_ids=True,
        )


def test_rejects_missing_contract_columns():
    with pytest.raises(ValueError, match="missing columns"):
        build_history_bundle(
            current=pd.DataFrame({"HomeTeam": ["Home"]}),
            previous=frame(), extra=pd.DataFrame(columns=COLUMNS),
            source="football_data_legacy", source_max_at=None,
        )


def test_freeze_legacy_history_removes_future_outcomes_and_hashes_input():
    rows = pd.concat([
        frame(),
        frame().assign(Date="2026-09-22", HomeTeam="Future"),
    ], ignore_index=True)
    legacy = build_history_bundle(
        current=rows,
        previous=frame(),
        extra=pd.DataFrame(columns=COLUMNS),
        source="football_data_legacy",
        source_max_at=None,
    )
    first, manifest = freeze_history_bundle_at_cutoff(
        legacy,
        cutoff_at="2026-09-20T12:00:00Z",
        kickoff_at="2026-09-21T12:00:00Z",
    )
    second, repeated = freeze_history_bundle_at_cutoff(
        legacy,
        cutoff_at="2026-09-20T12:00:00Z",
        kickoff_at="2026-09-21T12:00:00Z",
    )
    assert len(first.current) == 1
    assert len(second.current) == 1
    assert manifest["history_fingerprint"] == repeated["history_fingerprint"]
    assert manifest["event_time_certified"] is True
    assert manifest["file_availability_time_certified"] is False


def test_freeze_rejects_missing_or_invalid_dates():
    bad = build_history_bundle(
        current=frame().assign(Date="not-a-date"),
        previous=frame(), extra=pd.DataFrame(columns=COLUMNS),
        source="football_data_legacy", source_max_at=None,
    )
    with pytest.raises(ValueError, match="invalid Date"):
        freeze_history_bundle_at_cutoff(
            bad,
            cutoff_at="2026-09-20T12:00:00Z",
            kickoff_at="2026-09-21T12:00:00Z",
        )
