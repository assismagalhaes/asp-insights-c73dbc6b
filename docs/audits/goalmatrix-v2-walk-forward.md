# GoalMatrix v2 walk-forward

GoalMatrix v2.3 corrects fractional Kelly conversion to bankroll percentage units while preserving all existing exposure caps.

## Input contract (v2.1)

- Recent signal: 10 matches across all venues and leagues, excluding the previous season.
- Venue signal: 20 home-at-home / away-at-away matches across all leagues, allowing the previous season.
- The two signals are independent populations. They are blended directly and must never be subtracted to infer a synthetic previous window.
- Both teams must have exactly 10 collected matches in the recent file and exactly 20 in the venue file. Partial or mismatched samples are rejected.
- Forecast mode uses only `NS` (`NF` is normalized to `NS` when supplied by the source). Backtest mode uses only `FT`; the modes are never mixed operationally.
- The runner rejects a legacy 5-match file in the recent input and records both input hashes and declared profiles in the snapshot.

Every production run writes an immutable `*.snapshot.json` beside the prediction CSV. The snapshot contains input hashes, source schema hash, generation time, kickoff time, model version and one `walk_forward_rows` record per prediction.

## Labeling contract

After events settle, append these fields to the snapshot rows without changing the original prediction fields:

- `outcome`: `1` for a winning selection and `0` for a losing selection.
- `home_goals`: final home score.
- `away_goals`: final away score.

Combine labeled rows into a CSV with at least:

`prediction_at,kickoff,game_id,league,market_type,probability,outcome,home_goals,away_goals`

Predictions with `prediction_at >= kickoff` are rejected as leakage.

## Calibration

Run:

```bash
python modelos/goalmatrix_validation.py labeled_snapshots.csv modelos/goalmatrix_calibration.json
```

O/U and BTTS are calibrated independently. Platt calibration activates only with at least 100 chronological observations and an out-of-sample Brier Score improvement. League overdispersion activates with at least 50 unique settled games and is shrunk toward the global prior in production.
