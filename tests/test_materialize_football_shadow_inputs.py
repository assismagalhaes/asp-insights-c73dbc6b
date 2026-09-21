import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import materialize_football_shadow_inputs as subject


class Repository:
    def select_rows(self, table, *, columns, filters, limit, order=None):
        if table == "hl_training_dataset_rows":
            return [{
                "id": "row-1", "build_run_id": "build-1", "match_id": "match-1",
                "feature_snapshot_id": "snapshot-1", "split_key": "train", "horizon_key": "t24h",
                "feature_cutoff_at": "2026-09-20T12:00:00Z", "kickoff_at": "2026-09-21T12:00:00Z",
                "competition_profile": "test", "row_fingerprint": "row-hash",
            }]
        values = {
            "hl_match_feature_snapshots": {
                "id": "snapshot-1", "match_id": "match-1",
                "cutoff_at": "2026-09-20T12:00:00Z", "kickoff_at": "2026-09-21T12:00:00Z",
                "features": {"schema_version": "highlightly_football_prematch@2.0.0", "match": {
                    "match_id": "match-1", "competition_id": "competition-1", "season_id": "season-1",
                    "home_team_id": "home-1", "away_team_id": "away-1",
                }},
                "lineage": {"provider_calls": 0, "feature_fingerprint": "feature-hash"},
                "quality": {"match_state": "READY"}, "coverage_pct": 100, "leakage_status": "PASS",
            },
            "sports_teams": {"home-1": {"id": "home-1", "name": "Home"}, "away-1": {"id": "away-1", "name": "Away"}},
            "sports_competitions": {"id": "competition-1", "name": "Premier League", "country_id": "country-1"},
            "sports_countries": {"id": "country-1", "name": "England"},
        }
        value = values[table]
        if table == "sports_teams":
            value = value[filters["id"]]
        return [value]


def test_materializes_stored_snapshot_without_provider_or_publication(tmp_path, monkeypatch):
    monkeypatch.setattr(subject.HighlightlyRepository, "from_environment", lambda: Repository())
    output = tmp_path / "shadow"
    monkeypatch.setattr(sys, "argv", ["materialize", "--build-run-id", "build-1", "--output-dir", str(output)])
    assert subject.main() == 0
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    artifact = json.loads((output / "match-1.json").read_text(encoding="utf-8"))
    assert manifest["row_count"] == 1
    assert manifest["provider_calls"] == 0
    assert manifest["published"] is False
    assert artifact["identity"]["country"] == "England"
    assert artifact["snapshot"]["lineage"]["provider_calls"] == 0
