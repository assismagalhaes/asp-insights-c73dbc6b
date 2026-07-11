from __future__ import annotations

import json
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
    design = np.column_stack([np.ones(len(x)), x])
    beta = np.array([0.0, 1.0], dtype=float)
    for _ in range(100):
        predicted = 1.0 / (1.0 + np.exp(-np.clip(design @ beta, -30.0, 30.0)))
        weights = np.clip(predicted * (1.0 - predicted), 1e-6, None)
        gradient = design.T @ (outcomes.astype(float) - predicted)
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
    return 1.0 / (1.0 + np.exp(-np.clip(intercept + slope * _logit(probabilities), -30.0, 30.0)))


def brier_score(probabilities: np.ndarray, outcomes: np.ndarray) -> float:
    return float(np.mean((probabilities.astype(float) - outcomes.astype(float)) ** 2))


def validate_snapshot_table(frame: pd.DataFrame) -> pd.DataFrame:
    required = {"prediction_at", "kickoff", "league", "market_type", "probability", "outcome"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"BACKMATRIX_WALK_FORWARD_MISSING_COLUMNS:{','.join(missing)}")
    clean = frame.copy()
    clean["prediction_at"] = pd.to_datetime(clean["prediction_at"], utc=True, errors="coerce")
    clean["kickoff"] = pd.to_datetime(clean["kickoff"], utc=True, errors="coerce")
    clean["probability"] = pd.to_numeric(clean["probability"], errors="coerce")
    clean["outcome"] = pd.to_numeric(clean["outcome"], errors="coerce")
    clean = clean.dropna(subset=["prediction_at", "kickoff", "probability", "outcome"])
    if (clean["prediction_at"] >= clean["kickoff"]).any():
        raise ValueError("BACKMATRIX_WALK_FORWARD_LEAKAGE:prediction_not_before_kickoff")
    clean = clean[clean["probability"].between(0.0, 1.0) & clean["outcome"].isin([0, 1])]
    return clean.sort_values("kickoff").reset_index(drop=True)


def build_calibration_payload(frame: pd.DataFrame) -> dict:
    clean = validate_snapshot_table(frame)
    rows = clean[clean["market_type"].astype(str).str.lower().eq("moneyline")]
    base = {
        "active": False,
        "out_of_sample": True,
        "sample_size": len(rows),
        "intercept": 0.0,
        "slope": 1.0,
        "status": "insufficient_walk_forward_sample",
    }
    if len(rows) < MIN_CALIBRATION_SAMPLE:
        return {"markets": {"moneyline": base}}
    split = max(70, int(len(rows) * 0.70))
    if len(rows) - split < 30:
        return {"markets": {"moneyline": base}}
    train, validation = rows.iloc[:split], rows.iloc[split:]
    intercept, slope = fit_platt(train["probability"].to_numpy(), train["outcome"].to_numpy())
    raw = validation["probability"].to_numpy(dtype=float)
    outcomes = validation["outcome"].to_numpy(dtype=float)
    calibrated = apply_platt(raw, intercept, slope)
    raw_brier = brier_score(raw, outcomes)
    calibrated_brier = brier_score(calibrated, outcomes)
    improved = calibrated_brier + 1e-6 < raw_brier
    return {"markets": {"moneyline": {
        **base,
        "active": improved,
        "intercept": intercept,
        "slope": slope,
        "status": "active_oos_improvement" if improved else "inactive_no_oos_improvement",
        "train_size": len(train),
        "validation_size": len(validation),
        "raw_brier": raw_brier,
        "calibrated_brier": calibrated_brier,
    }}}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python backmatrix_validation.py LABELED_SNAPSHOTS.csv OUTPUT.json")
    payload = build_calibration_payload(pd.read_csv(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "output": sys.argv[2], "markets": payload["markets"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
