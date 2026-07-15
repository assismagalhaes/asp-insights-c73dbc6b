from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

import pandas as pd


MINIMUM_WALK_FORWARD_GAMES = 100
MINIMUM_MAE_IMPROVEMENT = 0.15


def build_margin_calibration_payload(
    frame: pd.DataFrame,
    minimum_games: int = MINIMUM_WALK_FORWARD_GAMES,
) -> dict[str, Any]:
    required = {
        'game_date', 'home', 'away', 'snapshot_at_utc', 'pregame_verified',
        'score_margin_pre_strength', 'strength_margin_reference', 'actual_margin',
    }
    missing = sorted(required.difference(frame.columns))
    if missing:
        return identity_payload('missing_required_columns', 0, minimum_games, {'missing_columns': missing})

    clean = frame.copy()
    verified = clean['pregame_verified'].astype(str).str.strip().str.lower().isin({'1', 'true', 'yes', 'sim'})
    clean = clean[verified].copy()
    clean['score_margin_pre_strength'] = pd.to_numeric(clean['score_margin_pre_strength'], errors='coerce')
    clean['strength_margin_reference'] = pd.to_numeric(clean['strength_margin_reference'], errors='coerce')
    clean['actual_margin'] = pd.to_numeric(clean['actual_margin'], errors='coerce')
    clean['game_date_parsed'] = pd.to_datetime(clean['game_date'], errors='coerce', dayfirst=True)
    clean['snapshot_parsed'] = pd.to_datetime(clean['snapshot_at_utc'], errors='coerce', utc=True)
    clean = clean.dropna(subset=['score_margin_pre_strength', 'strength_margin_reference', 'actual_margin', 'game_date_parsed', 'snapshot_parsed'])
    clean = clean.sort_values(['game_date_parsed', 'snapshot_parsed'])
    clean = clean.drop_duplicates(subset=['game_date_parsed', 'home', 'away'], keep='first')
    sample_size = len(clean)
    if sample_size < minimum_games:
        return identity_payload('insufficient_walk_forward_sample', sample_size, minimum_games)

    split = max(1, min(sample_size - 1, int(sample_size * 0.70)))
    training = clean.iloc[:split]
    validation = clean.iloc[split:]
    strength_weight = select_strength_weight(training)
    x = blended_margin(training, strength_weight)
    y = training['actual_margin'].astype(float)
    variance = float(((x - x.mean()) ** 2).sum())
    if variance <= 1e-9:
        return identity_payload('degenerate_training_margin', sample_size, minimum_games)
    slope = float(((x - x.mean()) * (y - y.mean())).sum() / variance)
    intercept = float(y.mean() - slope * x.mean())
    if not (math.isfinite(intercept) and math.isfinite(slope) and abs(intercept) <= 8.0 and 0.25 <= slope <= 2.0):
        return identity_payload('invalid_calibration_coefficients', sample_size, minimum_games)

    validation_raw_margin = validation['score_margin_pre_strength'].astype(float)
    validation_blended_margin = blended_margin(validation, strength_weight)
    raw_error = (validation['actual_margin'] - validation_raw_margin).abs()
    calibrated_margin = intercept + slope * validation_blended_margin
    calibrated_error = (validation['actual_margin'] - calibrated_margin).abs()
    raw_mae = float(raw_error.mean())
    calibrated_mae = float(calibrated_error.mean())
    improved = calibrated_mae + MINIMUM_MAE_IMPROVEMENT <= raw_mae
    return {
        'active': improved,
        'status': 'active_oos_calibration' if improved else 'rejected_no_oos_improvement',
        'sample_size': sample_size,
        'training_size': len(training),
        'validation_size': len(validation),
        'minimum_sample_size': minimum_games,
        'intercept': intercept if improved else 0.0,
        'slope': slope if improved else 1.0,
        'strength_weight': strength_weight if improved else 0.0,
        'candidate_intercept': intercept,
        'candidate_slope': slope,
        'candidate_strength_weight': strength_weight,
        'validation_mae_raw': raw_mae,
        'validation_mae_calibrated': calibrated_mae,
    }


def identity_payload(status: str, sample_size: int, minimum_games: int, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        'active': False,
        'status': status,
        'sample_size': sample_size,
        'minimum_sample_size': minimum_games,
        'intercept': 0.0,
        'slope': 1.0,
        'strength_weight': 0.0,
        'validation_mae_raw': None,
        'validation_mae_calibrated': None,
        **(extra or {}),
    }


def blended_margin(frame: pd.DataFrame, weight: float) -> pd.Series:
    score = frame['score_margin_pre_strength'].astype(float)
    strength = frame['strength_margin_reference'].astype(float)
    return score + float(weight) * (strength - score)


def select_strength_weight(training: pd.DataFrame) -> float:
    actual = training['actual_margin'].astype(float)
    candidates = [index / 40.0 for index in range(21)]
    return min(
        candidates,
        key=lambda weight: float((actual - blended_margin(training, weight)).abs().mean()),
    )


def main() -> int:
    if len(sys.argv) not in {2, 3}:
        print('Uso: python wnba_margin_validation.py SNAPSHOTS_COM_RESULTADOS.csv [OUTPUT.json]')
        return 2
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2]) if len(sys.argv) == 3 else Path(__file__).with_name('wnba_margin_calibration.json')
    payload = build_margin_calibration_payload(pd.read_csv(input_path))
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'output': str(output_path), **payload}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
