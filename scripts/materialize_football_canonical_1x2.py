"""Materialize deterministic canonical 1X2 shadow predictions."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "modelos") not in sys.path:
    sys.path.insert(0, str(ROOT / "modelos"))

from football_canonical_1x2 import infer_canonical_1x2


def stable_hash(value: Any) -> str:
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def materialize(canonical_dir: Path, output_dir: Path) -> dict[str, Any]:
    canonical_dir = canonical_dir.resolve()
    output_dir = output_dir.resolve()
    source_manifest = json.loads(
        (canonical_dir / "manifest.json").read_text(encoding="utf-8")
    )
    prepared = []
    for item in source_manifest["artifacts"]:
        source = json.loads(
            (canonical_dir / item["path"]).read_text(encoding="utf-8")
        )
        if source.get("artifact_fingerprint") != item.get("artifact_fingerprint"):
            raise RuntimeError(f"source fingerprint mismatch: {item['path']}")
        inference = infer_canonical_1x2(source["snapshot"])
        payload = {
            "contract": "football_canonical_1x2_shadow_artifact@1.0.0",
            "build_run_id": source["build_run_id"],
            "match_id": source["identity"]["match_id"],
            "identity": source["identity"],
            "dataset": {
                key: source["dataset_row"].get(key)
                for key in (
                    "split_key", "horizon_key", "feature_cutoff_at",
                    "kickoff_at", "row_fingerprint",
                )
            },
            "source_artifact_fingerprint": source["artifact_fingerprint"],
            "inference": inference,
        }
        payload["artifact_fingerprint"] = stable_hash(payload)
        prepared.append(payload)

    output_dir.mkdir(parents=True, exist_ok=False)
    artifacts = []
    candidate_count = 0
    missing_quote_count = 0
    for payload in prepared:
        name = f"{payload['match_id']}.json"
        (output_dir / name).write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2),
            encoding="utf-8",
        )
        predictions = payload["inference"]["predictions"]
        candidate_count += sum(
            row["decision"] == "SHADOW_CANDIDATE" for row in predictions
        )
        missing_quote_count += sum(
            row["odd_ofertada"] is None for row in predictions
        )
        artifacts.append({
            "match_id": payload["match_id"], "path": name,
            "artifact_fingerprint": payload["artifact_fingerprint"],
        })
    manifest = {
        "contract": "football_canonical_1x2_shadow_materialization@1.0.0",
        "build_run_id": source_manifest["build_run_id"],
        "source_manifest_fingerprint": source_manifest["manifest_fingerprint"],
        "row_count": len(artifacts),
        "prediction_count": len(artifacts) * 3,
        "candidate_count": candidate_count,
        "missing_quote_count": missing_quote_count,
        "provider_calls": 0, "published": False,
        "artifacts": artifacts,
    }
    manifest["manifest_fingerprint"] = stable_hash(manifest)
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2),
        encoding="utf-8",
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    manifest = materialize(args.canonical_dir, args.output_dir)
    keys = (
        "row_count", "prediction_count", "candidate_count",
        "missing_quote_count", "provider_calls", "published",
        "manifest_fingerprint",
    )
    print(json.dumps({key: manifest[key] for key in keys}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
