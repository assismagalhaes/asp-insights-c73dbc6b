import sys
from pathlib import Path

MODELOS = Path(__file__).resolve().parents[1] / "modelos"
if str(MODELOS) not in sys.path:
    sys.path.insert(0, str(MODELOS))

from football_canonical_btts import infer_canonical_btts


def block(sample=10, gf=1.5, ga=1.0, btts=5):
    return {"sample": sample, "goals_for": gf, "goals_against": ga, "btts_yes": btts}


def canonical_block(sample=10, gf=1.5, ga=1.0, btts=5):
    return {
        "sample": sample,
        "goals_for": {"mean": gf, "sum": gf * sample, "variance": 0.5},
        "goals_against": {"mean": ga, "sum": ga * sample, "variance": 0.5},
        "btts_yes": btts,
    }


def snapshot():
    team = {
        "current_season": block(), "previous_season": block(),
        "recent_overall": block(sample=5),
    }
    return {
        "home": team, "away": team,
        "league_prior": {"average_home_goals": 1.5, "average_away_goals": 1.2, "sample": 100},
        "markets": {"consensus": [
            {"market_family": "both_teams_to_score", "selection_key": "yes", "best_odds": 1.8},
            {"market_family": "both_teams_to_score", "selection_key": "no", "best_odds": 2.1},
        ]},
    }


def test_canonical_btts_is_deterministic_non_publishing_and_normalized():
    first = infer_canonical_btts(snapshot())
    second = infer_canonical_btts(snapshot())
    assert first == second
    assert first["provider_calls"] == 0
    assert first["published"] is False
    assert abs(sum(row["probabilidade_final"] for row in first["predictions"]) - 100.0) < 1e-6


def test_missing_quote_passes_without_invalidating_other_side():
    data = snapshot()
    data["markets"]["consensus"] = data["markets"]["consensus"][:1]
    result = infer_canonical_btts(data)
    assert len(result["predictions"]) == 2
    assert result["predictions"][1]["decision"] == "PASS"
    assert result["predictions"][1]["odd_ofertada"] is None


def test_real_canonical_metric_shape_uses_means_and_btts_rates():
    data = snapshot()
    team = {
        "current_season": canonical_block(sample=10, btts=6),
        "previous_season": canonical_block(sample=20, btts=10),
        "recent_overall": canonical_block(sample=5, btts=3),
    }
    data["home"] = team
    data["away"] = team
    result = infer_canonical_btts(data)
    assert result["inputs"]["home"]["sample"] == 30
    assert 0.0 <= result["history_btts_yes"] <= 100.0
    assert abs(sum(row["probabilidade_final"] for row in result["predictions"]) - 100.0) < 1e-6
