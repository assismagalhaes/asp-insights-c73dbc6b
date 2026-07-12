# GoalMatrix v2 walk-forward

GoalMatrix v2.3 corrects fractional Kelly conversion to bankroll percentage units while preserving all existing exposure caps.

GoalMatrix v2.4 adds market-specific consistency gates. O/U uses 60% total-goal consistency and 40% scored-goal consistency, requiring 45% per team and 50% on average. BTTS uses 30% total-goal consistency and 70% scored-goal consistency, requiring 50% per team and 55% on average. The BTTS probability floor is 54%, while its 5% minimum edge remains unchanged.

GoalMatrix v2.5 separates PackBall reference odds from executable bookmaker odds. PackBall odds can average one to five bookmakers and remain useful for paired no-vig context, but no longer assign stake or block a probability/CV-qualified candidate by reference edge. Qualified rows become `CANDIDATO_GOAL` with stake zero. Critical Validation requires an executable odd for the exact side and line, then recalculates edge and 12.5% fractional Kelly. O/U still requires 4% adjusted edge and BTTS requires 5% before confirmation or publication.

GoalMatrix v2.6 adds relative price-feasibility classes (`ODD_APROVADA`, `AGUARDAR_ODD`, `ODD_POUCO_PROVAVEL`, and `SEM_PRECO`) so the Pre-AI shortlist prioritizes candidates whose minimum executable odd is realistically close to the PackBall reference. An entered executable odd below the market edge floor becomes a hard block. Fractional Kelly remains unchanged, but GoalMatrix stake is capped at 0.50u while OOS calibration is insufficient or component spread is between 15 and 20 percentage points; strong market conflict remains capped at 0.25u.

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
