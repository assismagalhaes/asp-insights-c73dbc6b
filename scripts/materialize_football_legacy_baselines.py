"""Freeze the Football-Data legacy baseline for canonical shadow inputs.

Acquisition happens once. Per-match replay artifacts are then produced without
network access and explicitly retain the uncertified file-availability flag.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "modelos") not in sys.path:
    sys.path.insert(0, str(ROOT / "modelos"))

from football_history_source import freeze_history_bundle_at_cutoff
import prognosticos_football_real as legacy_model


LEAGUE_MAP = {"Premier League": "ENG - Premier League", "La Liga": "SPA - La Liga"}


def stable_hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def frame_records(frame):
    return json.loads(frame.to_json(orient="records", date_format="iso"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    canonical_dir = Path(args.canonical_dir).resolve()
    canonical_manifest = json.loads((canonical_dir / "manifest.json").read_text(encoding="utf-8"))
    inputs = [json.loads((canonical_dir / item["path"]).read_text(encoding="utf-8")) for item in canonical_manifest["artifacts"]]
    leagues = sorted({LEAGUE_MAP[item["identity"]["competition_name"]] for item in inputs})

    legacy_model.configure_reference_date(max(item["dataset_row"]["kickoff_at"] for item in inputs))
    acquired = legacy_model._load_legacy_history_bundle(leagues)
    acquisition_calls = len(leagues) * 2

    prepared = []
    for item in inputs:
        row = item["dataset_row"]
        frozen, evidence = freeze_history_bundle_at_cutoff(
            acquired, cutoff_at=row["feature_cutoff_at"], kickoff_at=row["kickoff_at"]
        )
        payload = {
            "contract": "football_legacy_shadow_input@1.0.0",
            "build_run_id": item["build_run_id"],
            "match_id": item["identity"]["match_id"],
            "identity": item["identity"],
            "evidence": evidence,
            "replay_provider_calls": 0,
            "published": False,
            "history": {
                "current": frame_records(frozen.current),
                "previous": frame_records(frozen.previous),
                "extra": frame_records(frozen.extra),
            },
        }
        payload["artifact_fingerprint"] = stable_hash(payload)
        prepared.append(payload)

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=False)
    artifacts = []
    for payload in prepared:
        name = f"{payload['match_id']}.json"
        (output_dir / name).write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
        artifacts.append({"match_id": payload["match_id"], "path": name, "artifact_fingerprint": payload["artifact_fingerprint"]})
    manifest = {
        "contract": "football_legacy_shadow_materialization@1.0.0",
        "canonical_manifest_fingerprint": canonical_manifest["manifest_fingerprint"],
        "row_count": len(artifacts),
        "acquisition_provider_calls": acquisition_calls,
        "replay_provider_calls": 0,
        "file_availability_time_certified": False,
        "published": False,
        "artifacts": artifacts,
    }
    manifest["manifest_fingerprint"] = stable_hash(manifest)
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
    print(json.dumps({key: manifest[key] for key in ("row_count", "acquisition_provider_calls", "replay_provider_calls", "file_availability_time_certified", "published", "manifest_fingerprint")}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
