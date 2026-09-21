import json
from pathlib import Path

from scripts.materialize_football_canonical_btts import materialize, stable_hash


def metric(sample, mean, btts):
    return {
        "sample": sample,
        "goals_for": {"mean": mean, "sum": mean * sample, "variance": 0.2},
        "goals_against": {"mean": mean, "sum": mean * sample, "variance": 0.2},
        "btts_yes": btts,
    }


def test_materialization_is_offline_non_publishing_and_fingerprinted(tmp_path: Path):
    canonical = tmp_path / "canonical"
    canonical.mkdir()
    team = {
        "current_season": metric(10, 1.2, 5),
        "previous_season": metric(20, 1.3, 11),
        "recent_overall": metric(5, 1.4, 3),
    }
    artifact = {
        "build_run_id": "build-1",
        "dataset_row": {"split_key": "test", "horizon_key": "24h", "feature_cutoff_at": "2026-01-01", "kickoff_at": "2026-01-02", "row_fingerprint": "row-fp"},
        "identity": {"match_id": "match-1", "home_name": "A", "away_name": "B"},
        "snapshot": {
            "home": team,
            "away": team,
            "league_prior": {"average_home_goals": 1.4, "average_away_goals": 1.1, "sample": 100},
            "markets": {"consensus": []},
        },
        "artifact_fingerprint": "source-fp",
    }
    (canonical / "match-1.json").write_text(json.dumps(artifact), encoding="utf-8")
    manifest = {"build_run_id": "build-1", "manifest_fingerprint": "manifest-fp", "artifacts": [{"path": "match-1.json", "artifact_fingerprint": "source-fp"}]}
    (canonical / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    result = materialize(canonical, tmp_path / "output")
    output = json.loads((tmp_path / "output" / "match-1.json").read_text(encoding="utf-8"))
    assert result["row_count"] == 1
    assert result["prediction_count"] == 2
    assert result["missing_quote_count"] == 2
    assert result["provider_calls"] == 0
    assert result["published"] is False
    assert output["artifact_fingerprint"] == stable_hash({k: v for k, v in output.items() if k != "artifact_fingerprint"})
