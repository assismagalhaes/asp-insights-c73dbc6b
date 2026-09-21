import json
from pathlib import Path

from scripts import materialize_football_legacy_btts as subject


def test_batch_records_one_success_and_one_failure(tmp_path: Path, monkeypatch):
    legacy_dir = tmp_path / "legacy"
    canonical_dir = tmp_path / "canonical"
    legacy_dir.mkdir()
    canonical_dir.mkdir()
    legacy_items = []
    canonical_items = []
    for match_id in ("ok", "bad"):
        legacy = {
            "match_id": match_id, "artifact_fingerprint": f"legacy-{match_id}",
            "evidence": {"event_time_certified": True, "file_availability_time_certified": False, "source_max_at": "2026-01-01"},
        }
        canonical = {
            "build_run_id": "build", "artifact_fingerprint": f"canonical-{match_id}",
            "identity": {"match_id": match_id},
            "dataset_row": {"split_key": "test", "horizon_key": "24h", "feature_cutoff_at": "2026-01-01", "kickoff_at": "2026-01-02", "row_fingerprint": match_id},
        }
        (legacy_dir / f"{match_id}.json").write_text(json.dumps(legacy), encoding="utf-8")
        (canonical_dir / f"{match_id}.json").write_text(json.dumps(canonical), encoding="utf-8")
        legacy_items.append({"match_id": match_id, "path": f"{match_id}.json"})
        canonical_items.append({"match_id": match_id, "path": f"{match_id}.json"})
    (legacy_dir / "manifest.json").write_text(json.dumps({"manifest_fingerprint": "lfp", "artifacts": legacy_items}), encoding="utf-8")
    (canonical_dir / "manifest.json").write_text(json.dumps({"build_run_id": "build", "manifest_fingerprint": "cfp", "artifacts": canonical_items}), encoding="utf-8")

    def fake_infer(legacy, canonical):
        if legacy["match_id"] == "bad":
            raise ValueError("insufficient history")
        return {"provider_calls": 0, "published": False, "predictions": [
            {"decision": "PASS", "odd_ofertada": None},
            {"decision": "SHADOW_CANDIDATE", "odd_ofertada": 1.8},
        ]}

    monkeypatch.setattr(subject, "infer_legacy_btts", fake_infer)
    result = subject.materialize(legacy_dir, canonical_dir, tmp_path / "output")
    assert result["requested_count"] == 2
    assert result["success_count"] == 1
    assert result["failure_count"] == 1
    assert result["candidate_count"] == 1
    assert result["provider_calls"] == 0
    assert result["published"] is False
    assert result["failures"][0]["match_id"] == "bad"
