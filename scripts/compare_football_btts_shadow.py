"""Pair and summarize frozen legacy/canonical BTTS shadow outputs."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "modelos") not in sys.path:
    sys.path.insert(0, str(ROOT / "modelos"))

from football_shadow_comparison import ShadowRunArtifact, compare_shadow_artifacts


def stable_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compare_all(legacy_dir: Path, canonical_dir: Path, canonical_input_dir: Path, output_dir: Path) -> dict[str, Any]:
    legacy_dir = legacy_dir.resolve()
    canonical_dir = canonical_dir.resolve()
    canonical_input_dir = canonical_input_dir.resolve()
    output_dir = output_dir.resolve()
    lm = json.loads((legacy_dir / "manifest.json").read_text(encoding="utf-8"))
    cm = json.loads((canonical_dir / "manifest.json").read_text(encoding="utf-8"))
    legacy_by_match = {x["match_id"]: x for x in lm["artifacts"]}
    canonical_input_manifest = json.loads((canonical_input_dir / "manifest.json").read_text(encoding="utf-8"))
    input_by_match = {x["match_id"]: x for x in canonical_input_manifest["artifacts"]}
    prepared = []
    probability_deltas = []
    decision_disagreements = 0
    for item in cm["artifacts"]:
        match_id = item["match_id"]
        canonical = json.loads((canonical_dir / item["path"]).read_text(encoding="utf-8"))
        legacy_item = legacy_by_match[match_id]
        legacy = json.loads((legacy_dir / legacy_item["path"]).read_text(encoding="utf-8"))
        input_item = input_by_match[match_id]
        canonical_input = json.loads((canonical_input_dir / input_item["path"]).read_text(encoding="utf-8"))
        cutoff = canonical["dataset"]["feature_cutoff_at"]
        kickoff = canonical["dataset"]["kickoff_at"]
        lineage = canonical_input["snapshot"].get("lineage") or {}
        canonical_source_max = lineage.get("source_max_at") or cutoff
        left = ShadowRunArtifact(
            side="legacy", match_id=match_id, kickoff_at=kickoff, cutoff_at=cutoff,
            source_max_at=legacy["source_max_at"],
            input_manifest={
                "fingerprint": legacy["legacy_source_artifact_fingerprint"],
                "event_time_certified": legacy["event_time_certified"],
                "file_availability_time_certified": legacy["file_availability_time_certified"],
            },
            predictions=pd.DataFrame(legacy["inference"]["predictions"]),
        )
        right = ShadowRunArtifact(
            side="canonical", match_id=match_id, kickoff_at=kickoff, cutoff_at=cutoff,
            source_max_at=canonical_source_max,
            input_manifest={"fingerprint": canonical["source_artifact_fingerprint"], "lineage": lineage},
            predictions=pd.DataFrame(canonical["inference"]["predictions"]),
        )
        comparison = compare_shadow_artifacts(left, right)
        legacy_preds = {x["pick"]: x for x in legacy["inference"]["predictions"]}
        canonical_preds = {x["pick"]: x for x in canonical["inference"]["predictions"]}
        metrics = {}
        for pick in ("Sim", "Não"):
            lp = legacy_preds[pick]
            cp = canonical_preds[pick]
            delta = round(cp["probabilidade_final"] - lp["probabilidade_final"], 4)
            probability_deltas.append(abs(delta))
            disagrees = lp["decision"] != cp["decision"]
            decision_disagreements += int(disagrees)
            metrics[pick] = {"probability_delta_canonical_minus_legacy": delta, "decision_disagrees": disagrees}
        payload = {
            "match_id": match_id,
            "identity": canonical["identity"],
            "comparison": comparison,
            "metrics": metrics,
            "legacy_file_availability_time_certified": legacy["file_availability_time_certified"],
        }
        payload["artifact_fingerprint"] = stable_hash(payload)
        prepared.append(payload)

    output_dir.mkdir(parents=True, exist_ok=False)
    artifacts = []
    for payload in prepared:
        name = f"{payload['match_id']}.json"
        (output_dir / name).write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
        artifacts.append({"match_id": payload["match_id"], "path": name, "artifact_fingerprint": payload["artifact_fingerprint"]})
    manifest = {
        "contract": "football_btts_shadow_comparison_materialization@1.0.0",
        "build_run_id": cm["build_run_id"],
        "pair_count": len(artifacts),
        "selection_count": len(probability_deltas),
        "mean_absolute_probability_delta_pp": round(sum(probability_deltas) / len(probability_deltas), 4),
        "max_absolute_probability_delta_pp": round(max(probability_deltas), 4),
        "decision_disagreement_count": decision_disagreements,
        "legacy_candidate_count": lm["candidate_count"],
        "canonical_candidate_count": cm["candidate_count"],
        "legacy_file_availability_uncertified_count": sum(not x["legacy_file_availability_time_certified"] for x in prepared),
        "provider_calls": 0,
        "published": False,
        "artifacts": artifacts,
    }
    manifest["manifest_fingerprint"] = stable_hash(manifest)
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-dir", required=True, type=Path)
    parser.add_argument("--canonical-dir", required=True, type=Path)
    parser.add_argument("--canonical-input-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    manifest = compare_all(args.legacy_dir, args.canonical_dir, args.canonical_input_dir, args.output_dir)
    print(json.dumps({key: value for key, value in manifest.items() if key not in {"artifacts"}}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
