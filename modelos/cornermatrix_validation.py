from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

try:
    from modelos.goalmatrix_validation import (
        build_league_alpha,
        build_league_baselines,
        build_market_calibration,
        validate_snapshot_table,
    )
except ModuleNotFoundError:
    from goalmatrix_validation import (
        build_league_alpha,
        build_league_baselines,
        build_market_calibration,
        validate_snapshot_table,
    )


MARKETS = ("ou", "mais_cantos", "race_3", "race_5")


def build_calibration_payload(frame: pd.DataFrame) -> dict:
    clean = validate_snapshot_table(frame)
    corner_games = clean.rename(columns={"home_corners": "home_goals", "away_corners": "away_goals"})
    return {
        "version": 1,
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "markets": {market: build_market_calibration(clean, market) for market in MARKETS},
        "league_alpha": build_league_alpha(corner_games),
        "league_baselines": build_league_baselines(corner_games),
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python cornermatrix_validation.py LABELED_SNAPSHOTS.csv OUTPUT.json")
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    payload = build_calibration_payload(pd.read_csv(source))
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "output": str(target), "markets": payload["markets"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
