from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

MIN_CALIBRATION_SAMPLE = 100


def _logit(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values.astype(float), 1e-6, 1.0 - 1e-6)
    return np.log(clipped / (1.0 - clipped))


def fit_platt(probabilities: np.ndarray, outcomes: np.ndarray) -> tuple[float, float]:
    x = _logit(probabilities)
    y = outcomes.astype(float)
    design = np.column_stack([np.ones(len(x)), x])
    beta = np.array([0.0, 1.0], dtype=float)
    for _ in range(100):
        linear = np.clip(design @ beta, -30.0, 30.0)
        predicted = 1.0 / (1.0 + np.exp(-linear))
        weights = np.clip(predicted * (1.0 - predicted), 1e-6, None)
        gradient = design.T @ (y - predicted)
        hessian = design.T @ (weights[:, None] * design)
        try:
            step = np.linalg.solve(hessian + np.eye(2) * 1e-6, gradient)
        except np.linalg.LinAlgError:
            break
        beta += step
        if float(np.max(np.abs(step))) < 1e-8:
            break
    return float(beta[0]), float(beta[1])


def apply_platt(probabilities: np.ndarray, intercept: float, slope: float) -> np.ndarray:
    linear = np.clip(intercept + slope * _logit(probabilities), -30.0, 30.0)
    return 1.0 / (1.0 + np.exp(-linear))


def brier_score(probabilities: np.ndarray, outcomes: np.ndarray) -> float:
    return float(np.mean((probabilities.astype(float) - outcomes.astype(float)) ** 2))


def validate_snapshot_table(frame: pd.DataFrame) -> pd.DataFrame:
    required = {"prediction_at", "kickoff", "league", "market_type", "probability", "outcome"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"GOALMATRIX_WALK_FORWARD_MISSING_COLUMNS:{','.join(missing)}")
    clean = frame.copy()
    clean["prediction_at"] = pd.to_datetime(clean["prediction_at"], utc=True, errors="coerce")
    clean["kickoff"] = pd.to_datetime(clean["kickoff"], utc=True, errors="coerce")
    clean["probability"] = pd.to_numeric(clean["probability"], errors="coerce")
    clean["outcome"] = pd.to_numeric(clean["outcome"], errors="coerce")
    clean = clean.dropna(subset=["prediction_at", "kickoff", "probability", "outcome"])
    if (clean["prediction_at"] >= clean["kickoff"]).any():
        raise ValueError("GOALMATRIX_WALK_FORWARD_LEAKAGE:prediction_not_before_kickoff")
    clean = clean[clean["probability"].between(0.0, 1.0) & clean["outcome"].isin([0, 1])]
    return clean.sort_values("kickoff").reset_index(drop=True)


def build_market_calibration(frame: pd.DataFrame, market: str) -> dict:
    rows = frame[frame["market_type"].astype(str).str.lower() == market].copy()
    sample_size = len(rows)
    base = {
        "active": False,
        "out_of_sample": True,
        "sample_size": sample_size,
        "intercept": 0.0,
        "slope": 1.0,
        "status": "insufficient_walk_forward_sample",
    }
    if sample_size < MIN_CALIBRATION_SAMPLE:
        return base
    split = max(50, int(sample_size * 0.70))
    if sample_size - split < 30:
        return base
    train = rows.iloc[:split]
    validation = rows.iloc[split:]
    intercept, slope = fit_platt(train["probability"].to_numpy(), train["outcome"].to_numpy())
    raw = validation["probability"].to_numpy(dtype=float)
    outcomes = validation["outcome"].to_numpy(dtype=float)
    calibrated = apply_platt(raw, intercept, slope)
    raw_brier = brier_score(raw, outcomes)
    calibrated_brier = brier_score(calibrated, outcomes)
    improved = calibrated_brier + 1e-6 < raw_brier
    return {
        **base,
        "active": improved,
        "intercept": intercept,
        "slope": slope,
        "status": "active_oos_improvement" if improved else "inactive_no_oos_improvement",
        "train_size": len(train),
        "validation_size": len(validation),
        "raw_brier": raw_brier,
        "calibrated_brier": calibrated_brier,
    }


def build_league_alpha(frame: pd.DataFrame) -> dict:
    required = {"home_goals", "away_goals"}
    if not required.issubset(frame.columns):
        return {}
    games = frame.copy()
    games["home_goals"] = pd.to_numeric(games["home_goals"], errors="coerce")
    games["away_goals"] = pd.to_numeric(games["away_goals"], errors="coerce")
    identity = "game_id" if "game_id" in games.columns else "kickoff"
    games = games.dropna(subset=["home_goals", "away_goals"]).drop_duplicates(["league", identity])
    output = {}
    for league, group in games.groupby("league"):
        totals = (group["home_goals"] + group["away_goals"]).astype(float)
        n = len(totals)
        mean = float(totals.mean()) if n else 0.0
        variance = float(totals.var(ddof=1)) if n > 1 else mean
        alpha = max(0.0, (variance - mean) / (mean * mean)) if mean > 0 else 0.10
        output[str(league)] = {
            "active": n >= 50,
            "out_of_sample": True,
            "sample_size": n,
            "alpha": float(np.clip(alpha, 0.0, 0.50)),
            "status": "league_moments_oos" if n >= 50 else "insufficient_league_sample",
        }
    return output


def build_league_baselines(frame: pd.DataFrame) -> dict:
    required = {"home_goals", "away_goals"}
    if not required.issubset(frame.columns):
        return {}
    games = frame.copy()
    games["home_goals"] = pd.to_numeric(games["home_goals"], errors="coerce")
    games["away_goals"] = pd.to_numeric(games["away_goals"], errors="coerce")
    identity = "game_id" if "game_id" in games.columns else "kickoff"
    games = games.dropna(subset=["home_goals", "away_goals"]).drop_duplicates(["league", identity])
    output = {}
    for league, group in games.groupby("league"):
        home = group["home_goals"].astype(float)
        away = group["away_goals"].astype(float)
        totals = home + away
        n = len(group)
        total_goals = float(totals.sum())
        output[str(league)] = {
            "active": n >= 50,
            "out_of_sample": True,
            "sample_size": n,
            "total_mean": float(totals.mean()) if n else 2.60,
            "home_share": float(home.sum() / total_goals) if total_goals > 0 else 0.55,
            "status": "league_baseline_oos" if n >= 50 else "insufficient_league_sample",
        }
    return output


def build_calibration_payload(frame: pd.DataFrame) -> dict:
    clean = validate_snapshot_table(frame)
    return {
        "markets": {
            "ou": build_market_calibration(clean, "ou"),
            "btts": build_market_calibration(clean, "btts"),
        },
        "league_alpha": build_league_alpha(clean),
        "league_baselines": build_league_baselines(clean),
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python goalmatrix_validation.py LABELED_SNAPSHOTS.csv OUTPUT.json")
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    payload = build_calibration_payload(pd.read_csv(source))
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "output": str(target), "markets": payload["markets"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
