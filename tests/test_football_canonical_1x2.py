import sys
from pathlib import Path

MODELOS = Path(__file__).resolve().parents[1] / "modelos"
if str(MODELOS) not in sys.path:
    sys.path.insert(0, str(MODELOS))

from football_canonical_1x2 import infer_canonical_1x2


def block(sample=10, gf=15, ga=10, wins=5, draws=3, losses=2):
    return {
        "sample": sample, "goals_for": {"mean": gf / sample},
        "goals_against": {"mean": ga / sample}, "btts_yes": 5,
        "wins": wins, "draws": draws, "losses": losses,
    }


def snapshot():
    team = {
        "current_season": block(), "previous_season": block(sample=20, gf=30, ga=20, wins=10, draws=6, losses=4),
        "recent_overall": block(sample=5, gf=8, ga=5, wins=3, draws=1, losses=1),
    }
    return {
        "home": team, "away": team,
        "league_prior": {"average_home_goals": 1.5, "average_away_goals": 1.1, "sample": 50},
        "markets": {"consensus": [
            {"market_family": "full_time_result", "selection_key": "home", "best_odds": 1.9},
            {"market_family": "full_time_result", "selection_key": "draw", "best_odds": 3.2},
            {"market_family": "full_time_result", "selection_key": "away", "best_odds": 1.8},
        ]},
    }


def test_1x2_is_deterministic_complementary_and_shadow_only():
    first = infer_canonical_1x2(snapshot())
    second = infer_canonical_1x2(snapshot())

    assert first == second
    assert first["provider_calls"] == 0
    assert first["published"] is False
    assert len(first["predictions"]) == 3
    assert round(sum(x["probabilidade_final"] for x in first["predictions"]), 3) == 100.0
    assert {x["selection_key"] for x in first["predictions"]} == {"home", "draw", "away"}


def test_missing_market_quote_passes_instead_of_synthesizing_price():
    data = snapshot()
    data["markets"]["consensus"] = []
    result = infer_canonical_1x2(data)

    assert all(x["odd_ofertada"] is None for x in result["predictions"])
    assert all(x["decision"] == "PASS" for x in result["predictions"])
