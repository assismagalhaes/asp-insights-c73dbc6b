import sys
from pathlib import Path

import numpy as np
import pandas as pd

MODELOS = Path(__file__).resolve().parents[1] / "modelos"
if str(MODELOS) not in sys.path:
    sys.path.insert(0, str(MODELOS))

import football_legacy_btts as subject


def test_process_jogos_replaces_strict_string_btts_column():
    frame = pd.DataFrame({
        "FTHG": [1, 0], "FTAG": [1, 2], "FTR": ["H", "A"],
        "BTTS": pd.Series(["Yes", "Yes"], dtype="str"),
    })
    result = subject.core.process_jogos(frame, "home")
    assert result["BTTS"].tolist() == ["Yes", "No"]


def test_team_resolution_accepts_one_unambiguous_containment():
    frame = pd.DataFrame({"HomeTeam": ["Celta", "Getafe"], "AwayTeam": ["Getafe", "Celta"]})
    assert subject.core.resolve_team_in_base_liga("Celta de Vigo", frame) == "Celta"


def test_canonical_names_map_to_cross_season_football_data_names():
    assert subject._legacy_team_name("Athletic Club") == "Ath Bilbao"
    assert subject._legacy_team_name("Atlético Madrid") == "Ath Madrid"
    assert subject._legacy_team_name("Manchester United") == "Man United"


def test_legacy_adapter_is_offline_and_uses_shared_shadow_thresholds(monkeypatch):
    monkeypatch.setattr(subject.core, "clean_completed_matches", lambda frame: frame)
    monkeypatch.setattr(subject.core, "configure_reference_date", lambda value: None)
    monkeypatch.setattr(subject.core, "analyze_match", lambda **kwargs: {
        "Prob_BTTS_Yes": 60.0, "OddValor_BTTS_Yes": 1.67, "OddReal_BTTS_Yes": kwargs["odds_bt"]["yes"],
        "Prob_BTTS_No": 40.0, "OddValor_BTTS_No": 2.5, "OddReal_BTTS_No": kwargs["odds_bt"]["no"],
        "Lambda_Home_Final": 1.2, "Lambda_Away_Final": 1.0,
        "Source_Data_Cutoff": "2026-01-01", "Sample_Home": 20, "Sample_Away": 20,
    })
    legacy = {"match_id": "m1", "history": {"current": [], "previous": [], "extra": []}}
    canonical = {
        "identity": {"match_id": "m1", "home_name": "A", "away_name": "B", "competition_name": "La Liga"},
        "dataset_row": {"kickoff_at": "2026-09-21T18:00:00+00:00"},
        "snapshot": {"markets": {"consensus": [
            {"market_family": "both_teams_to_score", "selection_key": "yes", "best_odds": 1.8}
        ]}},
    }
    result = subject.infer_legacy_btts(legacy, canonical)
    assert result["provider_calls"] == 0
    assert result["published"] is False
    assert result["predictions"][0]["decision"] == "SHADOW_CANDIDATE"
    assert result["predictions"][1]["decision"] == "PASS"
    assert result["predictions"][1]["odd_ofertada"] is None
