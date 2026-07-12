from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
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
OU_LINES = (7.5, 8.5, 9.5, 10.5, 11.5)


def _build_subset_calibration(frame: pd.DataFrame, key: str, mask: pd.Series) -> dict:
    subset = frame.loc[mask].copy()
    subset["market_type"] = key
    return build_market_calibration(subset, key)


def build_corner_market_calibrations(frame: pd.DataFrame) -> dict:
    markets = {market: build_market_calibration(frame, market) for market in MARKETS}
    market_type = frame["market_type"].astype(str).str.lower()
    picks = frame.get("pick", pd.Series("", index=frame.index)).astype(str).str.lower()
    lines = pd.to_numeric(frame.get("line", pd.Series(index=frame.index, dtype=float)), errors="coerce")
    for line in OU_LINES:
        line_key = str(line).replace(".", "_")
        line_mask = (market_type == "ou") & np.isclose(lines, line, equal_nan=False)
        markets[f"ou_over_{line_key}"] = _build_subset_calibration(
            frame, f"ou_over_{line_key}", line_mask & picks.str.contains("over", regex=False)
        )
        markets[f"ou_under_{line_key}"] = _build_subset_calibration(
            frame, f"ou_under_{line_key}", line_mask & picks.str.contains("under", regex=False)
        )
    return markets


def build_calibration_payload(frame: pd.DataFrame) -> dict:
    clean = validate_snapshot_table(frame)
    corner_games = clean.rename(columns={"home_corners": "home_goals", "away_corners": "away_goals"})
    return {
        "version": 1,
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "markets": build_corner_market_calibrations(clean),
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
