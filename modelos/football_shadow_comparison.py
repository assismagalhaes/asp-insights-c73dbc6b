"""Deterministic, non-publishing comparison for MatchMatrix shadow runs.

The module does not acquire data or run a provider.  It compares two already
materialized executions only after proving that both describe the same match
and the same point-in-time cutoff.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
from typing import Any, Mapping

import pandas as pd


SHADOW_COMPARISON_VERSION = "football_matchmatrix_shadow_comparison@1.0.0"
OUTPUT_FIELDS = (
    "probabilidade_final",
    "odd_valor",
    "odd_ofertada",
    "edge",
    "decision",
)


def _timestamp(value: str, field: str) -> pd.Timestamp:
    parsed = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(parsed):
        raise ValueError(f"{field} must be a valid timezone-aware timestamp")
    return parsed


def _stable_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalise_line(value: Any) -> str:
    if value is None or pd.isna(value) or str(value).strip() == "":
        return ""
    try:
        return f"{float(value):.2f}"
    except (TypeError, ValueError):
        return str(value).strip().lower()


def _prediction_key(row: Mapping[str, Any]) -> tuple[str, str, str]:
    market = str(row.get("mercado", "")).strip().lower()
    pick = str(row.get("pick") or row.get("opcao_1x2") or "").strip().lower()
    return market, pick, _normalise_line(row.get("linha"))


@dataclass(frozen=True)
class ShadowRunArtifact:
    side: str
    match_id: str
    kickoff_at: str
    cutoff_at: str
    source_max_at: str
    input_manifest: Mapping[str, Any]
    predictions: pd.DataFrame
    provider_calls: int = 0
    published: bool = False


def _validate_artifact(artifact: ShadowRunArtifact) -> None:
    if artifact.side not in {"legacy", "canonical"}:
        raise ValueError("shadow side must be legacy or canonical")
    if not artifact.match_id:
        raise ValueError("match_id is required")
    kickoff = _timestamp(artifact.kickoff_at, "kickoff_at")
    cutoff = _timestamp(artifact.cutoff_at, "cutoff_at")
    source_max = _timestamp(artifact.source_max_at, "source_max_at")
    if cutoff >= kickoff:
        raise ValueError("cutoff_at must be before kickoff_at")
    if source_max > cutoff:
        raise ValueError(f"{artifact.side} source_max_at exceeds cutoff_at")
    if artifact.provider_calls != 0:
        raise ValueError("shadow comparison must not call providers")
    if artifact.published:
        raise ValueError("shadow comparison must not publish predictions")
    if not isinstance(artifact.predictions, pd.DataFrame):
        raise TypeError("predictions must be a pandas DataFrame")


def compare_shadow_artifacts(
    legacy: ShadowRunArtifact,
    canonical: ShadowRunArtifact,
) -> dict[str, Any]:
    """Compare two immutable results at identical identity and cutoff."""
    _validate_artifact(legacy)
    _validate_artifact(canonical)
    identity_fields = ("kickoff_at", "cutoff_at")
    mismatches = [
        field for field in identity_fields
        if _timestamp(getattr(legacy, field), field)
        != _timestamp(getattr(canonical, field), field)
    ]
    if legacy.match_id != canonical.match_id:
        mismatches.insert(0, "match_id")
    if mismatches:
        raise ValueError(f"shadow identity mismatch: {sorted(set(mismatches))}")

    def index_predictions(frame: pd.DataFrame) -> dict[tuple[str, str, str], dict[str, Any]]:
        indexed: dict[tuple[str, str, str], dict[str, Any]] = {}
        for row in frame.to_dict(orient="records"):
            key = _prediction_key(row)
            if key in indexed:
                raise ValueError(f"duplicate prediction key: {key}")
            indexed[key] = row
        return indexed

    left = index_predictions(legacy.predictions)
    right = index_predictions(canonical.predictions)
    differences = []
    for key in sorted(set(left) | set(right)):
        legacy_row = left.get(key)
        canonical_row = right.get(key)
        changed = {}
        for field in OUTPUT_FIELDS:
            old = None if legacy_row is None else legacy_row.get(field)
            new = None if canonical_row is None else canonical_row.get(field)
            if pd.isna(old):
                old = None
            if pd.isna(new):
                new = None
            if old != new:
                changed[field] = {"legacy": old, "canonical": new}
        if legacy_row is None or canonical_row is None or changed:
            differences.append({
                "market": key[0], "pick": key[1], "line": key[2],
                "presence": {
                    "legacy": legacy_row is not None,
                    "canonical": canonical_row is not None,
                },
                "changed_fields": changed,
            })

    legacy_input_hash = _stable_hash(legacy.input_manifest)
    canonical_input_hash = _stable_hash(canonical.input_manifest)
    return {
        "comparison_version": SHADOW_COMPARISON_VERSION,
        "mode": "shadow",
        "match_id": canonical.match_id,
        "kickoff_at": canonical.kickoff_at,
        "cutoff_at": canonical.cutoff_at,
        "published": False,
        "provider_calls": 0,
        "input": {
            "legacy_hash": legacy_input_hash,
            "canonical_hash": canonical_input_hash,
            "equal": legacy_input_hash == canonical_input_hash,
        },
        "output": {
            "legacy_count": len(left),
            "canonical_count": len(right),
            "difference_count": len(differences),
            "equal": not differences,
            "differences": differences,
        },
    }
