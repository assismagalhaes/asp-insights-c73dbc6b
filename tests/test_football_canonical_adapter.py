from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest


MODELOS = Path(__file__).resolve().parents[1] / "modelos"
if str(MODELOS) not in sys.path:
    sys.path.insert(0, str(MODELOS))

from football_canonical_adapter import canonical_snapshot_to_matchmatrix


MATCH_ID = "11111111-1111-4111-8111-111111111111"
HOME_ID = "22222222-2222-4222-8222-222222222222"
AWAY_ID = "33333333-3333-4333-8333-333333333333"
COMPETITION_ID = "44444444-4444-4444-8444-444444444444"
SEASON_ID = "55555555-5555-4555-8555-555555555555"


def identity():
    return {
        "match_id": MATCH_ID,
        "competition_id": COMPETITION_ID,
        "season_id": SEASON_ID,
        "home_team_id": HOME_ID,
        "away_team_id": AWAY_ID,
        "competition_name": "Premier League",
        "country": "England",
        "home_name": "Home FC",
        "away_name": "Away FC",
    }


def snapshot():
    history_id = "66666666-6666-4666-8666-666666666666"
    quotes = [
        ("full_time_result", "home", None, 2.10, "bet365"),
        ("full_time_result", "home", None, 2.20, "unibet"),
        ("full_time_result", "draw", None, 3.30, "bet365"),
        ("full_time_result", "away", None, 3.50, "bet365"),
        ("total_goals", "over", 2.5, 1.90, "bet365"),
        ("total_goals", "under", 2.5, 2.00, "bet365"),
        ("both_teams_to_score", "yes", None, 1.80, "bet365"),
        ("both_teams_to_score", "no", None, 2.00, "bet365"),
        ("asian_handicap", "home", -0.5, 1.95, "bet365"),
        ("asian_handicap", "away", 0.5, 1.95, "bet365"),
    ]
    quote_rows = [
        {
            "market_family": family,
            "selection_key": selection,
            "selection_name": selection,
            "line_value": line,
            "line_key": "" if line is None else str(line),
            "decimal_odds": odd,
            "bookmaker_key": bookmaker,
        }
        for family, selection, line, odd, bookmaker in quotes
    ]
    consensus = [
        {
            "market_family": family,
            "selection_key": selection,
            "line_value": line,
            "median_odds": odd - 0.05,
            "best_odds": odd,
        }
        for family, selection, line, odd, _ in quotes
        if not (family == "full_time_result" and selection == "home" and odd == 2.10)
    ]
    window = {"match_ids": [history_id], "sample": 5}
    return {
        "schema_version": "highlightly_football_prematch@2.0.0",
        "fingerprint": "a" * 64,
        "match": {
            "match_id": MATCH_ID,
            "competition_id": COMPETITION_ID,
            "season_id": SEASON_ID,
            "home_team_id": HOME_ID,
            "away_team_id": AWAY_ID,
            "kickoff_at": "2026-09-20T15:00:00+00:00",
        },
        "cutoff": {"cutoff_at": "2026-09-19T15:00:00+00:00", "horizon_key": "t24h"},
        "lineage": {
            "source_max_at": "2026-09-19T12:00:00+00:00",
            "provider_calls": False,
            "target_match_forbidden": True,
        },
        "quality": {"match_state": "READY", "codes": []},
        "home": {"current_season": window, "previous_season": window, "recent_overall": window, "recent_venue": window},
        "away": {"current_season": window, "previous_season": window, "recent_overall": window, "recent_venue": window},
        "h2h": window,
        "league_prior": window,
        "markets": {"quotes": quote_rows, "consensus": consensus},
    }


def test_maps_snapshot_in_memory_and_preserves_canonical_ids():
    result = canonical_snapshot_to_matchmatrix(snapshot(), identity())
    wide = result["wide_row"]
    assert wide["match_id"] == MATCH_ID
    assert wide["home_team_id"] == HOME_ID
    assert wide["away_team_id"] == AWAY_ID
    assert wide["odds_1X2_Full_Time_1"] == 2.20
    assert wide["odds_1X2_Full_Time_1_BOOKMAKER_MELHOR"] == "unibet"
    assert wide["odds_OverUnder_Full_Time_2_5_Over"] == 1.90
    assert wide["odds_Both_teams_to_score_Full_Time_YES"] == 1.80
    assert wide["odds_Asian_handicap_Full_Time_Linha1_HANDICAP"] == -0.5
    assert result["manifest"]["provider_calls"] == 0
    assert result["manifest"]["automatic_predictions"] is False


def test_is_deterministic_and_does_not_mutate_input():
    source = snapshot()
    original = copy.deepcopy(source)
    first = canonical_snapshot_to_matchmatrix(source, identity())
    second = canonical_snapshot_to_matchmatrix(source, identity())
    assert first["manifest"]["adapter_output_fingerprint"] == second["manifest"]["adapter_output_fingerprint"]
    assert source == original


@pytest.mark.parametrize(
    "mutation,error",
    [
        (lambda value: value["quality"].update(match_state="DEGRADED"), "READY"),
        (lambda value: value["lineage"].update(provider_calls=True), "stored-data-only"),
        (lambda value: value["cutoff"].update(cutoff_at="2026-09-20T16:00:00+00:00"), "temporal invariant"),
        (lambda value: value["home"]["recent_overall"].update(match_ids=[MATCH_ID]), "leaked"),
    ],
)
def test_rejects_unsafe_snapshots(mutation, error):
    source = snapshot()
    mutation(source)
    with pytest.raises(ValueError, match=error):
        canonical_snapshot_to_matchmatrix(source, identity())


def test_rejects_identity_drift():
    wrong = identity()
    wrong["home_team_id"] = "77777777-7777-4777-8777-777777777777"
    with pytest.raises(ValueError, match="identity home_team_id"):
        canonical_snapshot_to_matchmatrix(snapshot(), wrong)
