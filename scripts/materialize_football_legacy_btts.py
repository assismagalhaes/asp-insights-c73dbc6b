"""Replay all frozen Football-Data inputs through the offline BTTS adapter."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "modelos") not in sys.path:
    sys.path.insert(0, str(ROOT / "modelos"))

from football_legacy_btts import infer_legacy_btts


def stable_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def materialize(legacy_dir: Path, canonical_dir: Path, output_dir: Path) -> dict[str, Any]:
    legacy_dir = legacy_dir.resolve()
    canonical_dir = canonical_dir.resolve()
    output_dir = output_dir.resolve()
    legacy_manifest = json.loads((legacy_dir / "manifest.json").read_text(encoding="utf-8"))
    canonical_manifest = json.loads((canonical_dir / "manifest.json").read_text(encoding="utf-8"))
    canonical_by_match = {item["match_id"]: item for item in canonical_manifest["artifacts"]}
    prepared = []
    failures = []
    for item in legacy_manifest["artifacts"]:
        match_id = item["match_id"]
        try:
            canonical_item = canonical_by_match[match_id]
            legacy = json.loads((legacy_dir / item["path"]).read_text(encoding="utf-8"))
            canonical = json.loads((canonical_dir / canonical_item["path"]).read_text(encoding="utf-8"))
            inference = infer_legacy_btts(legacy, canonical)
            payload = {
                "contract": "football_legacy_btts_shadow_artifact@1.0.0",
                "build_run_id": canonical["build_run_id"],
                "match_id": match_id,
                "identity": canonical["identity"],
                "dataset": {
                    key: canonical["dataset_row"].get(key)
                    for key in ("split_key", "horizon_key", "feature_cutoff_at", "kickoff_at", "row_fingerprint")
                },
                "legacy_source_artifact_fingerprint": legacy["artifact_fingerprint"],
                "canonical_source_artifact_fingerprint": canonical["artifact_fingerprint"],
                "event_time_certified": legacy["evidence"]["event_time_certified"],
                "file_availability_time_certified": legacy["evidence"]["file_availability_time_certified"],
                "source_max_at": legacy["evidence"]["source_max_at"],
                "inference": inference,
            }
            payload["artifact_fingerprint"] = stable_hash(payload)
            prepared.append(payload)
        except Exception as error:
            failures.append({
                "match_id": match_id,
                "path": item["path"],
                "error_type": type(error).__name__,
                "error": str(error),
            })

    output_dir.mkdir(parents=True, exist_ok=False)
    artifacts = []
    candidate_count = 0
    missing_quote_count = 0
    for payload in prepared:
        name = f"{payload['match_id']}.json"
        (output_dir / name).write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2, default=str), encoding="utf-8"
        )
        predictions = payload["inference"]["predictions"]
        candidate_count += sum(row["decision"] == "SHADOW_CANDIDATE" for row in predictions)
        missing_quote_count += sum(row["odd_ofertada"] is None for row in predictions)
        artifacts.append({"match_id": payload["match_id"], "path": name, "artifact_fingerprint": payload["artifact_fingerprint"]})

    manifest = {
        "contract": "football_legacy_btts_shadow_materialization@1.0.0",
        "build_run_id": canonical_manifest["build_run_id"],
        "legacy_source_manifest_fingerprint": legacy_manifest["manifest_fingerprint"],
        "canonical_source_manifest_fingerprint": canonical_manifest["manifest_fingerprint"],
        "requested_count": len(legacy_manifest["artifacts"]),
        "success_count": len(artifacts),
        "failure_count": len(failures),
        "prediction_count": len(artifacts) * 2,
        "candidate_count": candidate_count,
        "missing_quote_count": missing_quote_count,
        "provider_calls": 0,
        "published": False,
        "file_availability_time_certified": False,
        "failures": failures,
        "artifacts": artifacts,
    }
    manifest["manifest_fingerprint"] = stable_hash(manifest)
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8"
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-dir", required=True, type=Path)
    parser.add_argument("--canonical-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    manifest = materialize(args.legacy_dir, args.canonical_dir, args.output_dir)
    keys = ("requested_count", "success_count", "failure_count", "prediction_count", "candidate_count", "missing_quote_count", "provider_calls", "published", "manifest_fingerprint")
    print(json.dumps({key: manifest[key] for key in keys}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
