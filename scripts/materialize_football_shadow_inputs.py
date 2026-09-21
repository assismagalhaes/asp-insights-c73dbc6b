"""Materialize immutable canonical inputs for a football shadow build.

Reads only already persisted Supabase rows and writes sanitized JSON artifacts.
No provider, training, prediction or publication operation is performed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.highlightly_repository import HighlightlyRepository


def stable_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def one(repository: HighlightlyRepository, table: str, row_id: str, columns: str) -> dict[str, Any]:
    rows = repository.select_rows(table, columns=columns, filters={"id": row_id}, limit=2)
    if len(rows) != 1:
        raise RuntimeError(f"expected one {table} row for {row_id}; received {len(rows)}")
    return rows[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-run-id", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    repository = HighlightlyRepository.from_environment()
    rows = repository.select_rows(
        "hl_training_dataset_rows",
        columns=(
            "id,build_run_id,match_id,feature_snapshot_id,split_key,horizon_key,"
            "feature_cutoff_at,kickoff_at,competition_profile,row_fingerprint"
        ),
        filters={"build_run_id": args.build_run_id},
        limit=500,
        order="kickoff_at.asc",
    )
    if not rows:
        raise RuntimeError("build has no dataset rows")

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=False)
    artifacts = []
    for row in rows:
        snapshot_row = one(
            repository,
            "hl_match_feature_snapshots",
            row["feature_snapshot_id"],
            "id,match_id,cutoff_at,kickoff_at,features,lineage,quality,coverage_pct,leakage_status",
        )
        features = dict(snapshot_row["features"])
        features["lineage"] = dict(snapshot_row["lineage"])
        features["quality"] = dict(snapshot_row["quality"])
        features["fingerprint"] = features["lineage"].get("feature_fingerprint")
        match = features.get("match") or {}
        home = one(repository, "sports_teams", match["home_team_id"], "id,name")
        away = one(repository, "sports_teams", match["away_team_id"], "id,name")
        competition = one(
            repository,
            "sports_competitions",
            match["competition_id"],
            "id,name,country_id",
        )
        country = one(repository, "sports_countries", competition["country_id"], "id,name")
        identity = {
            "match_id": match["match_id"],
            "competition_id": match["competition_id"],
            "season_id": match["season_id"],
            "home_team_id": match["home_team_id"],
            "away_team_id": match["away_team_id"],
            "competition_name": competition["name"],
            "country": country["name"],
            "home_name": home["name"],
            "away_name": away["name"],
        }
        artifact = {
            "build_run_id": args.build_run_id,
            "dataset_row": row,
            "identity": identity,
            "snapshot": features,
            "artifact_fingerprint": stable_hash({"identity": identity, "snapshot": features}),
        }
        path = output_dir / f"{row['match_id']}.json"
        path.write_text(json.dumps(artifact, ensure_ascii=False, sort_keys=True, indent=2, default=str), encoding="utf-8")
        artifacts.append({
            "match_id": row["match_id"],
            "path": path.name,
            "split_key": row["split_key"],
            "cutoff_at": row["feature_cutoff_at"],
            "kickoff_at": row["kickoff_at"],
            "artifact_fingerprint": artifact["artifact_fingerprint"],
        })

    manifest = {
        "contract": "football_shadow_input_materialization@1.0.0",
        "build_run_id": args.build_run_id,
        "row_count": len(artifacts),
        "provider_calls": 0,
        "automatic_training": False,
        "automatic_predictions": False,
        "published": False,
        "artifacts": artifacts,
    }
    manifest["manifest_fingerprint"] = stable_hash(manifest)
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2, default=str),
        encoding="utf-8",
    )
    print(json.dumps({
        "ok": True,
        "output_dir": str(output_dir),
        "row_count": len(artifacts),
        "manifest_fingerprint": manifest["manifest_fingerprint"],
        "provider_calls": 0,
        "published": False,
    }, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
