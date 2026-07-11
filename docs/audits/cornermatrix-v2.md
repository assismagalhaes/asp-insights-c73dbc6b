# ASP CornerMatrix v2 audit

## Input contract

- PackBall external CSV files remain at 5 and 20 matches.
- Both teams must have exactly 5/5 or 20/20 collected matches in the corresponding file.
- Forecast mode accepts `NS` (`NF` is normalized to `NS`); backtest mode accepts only `FT`.
- Schema order, SHA-256 hashes, generation time and source filenames are persisted per run.

## Mathematical model

- Recent and structural averages are blended with dynamic 5/20 weights based on the PackBall consistency index and form divergence.
- Team corner rates use league-total priors, fixed home share until a valid OOS league baseline exists, attack/defense strength shrinkage and bounded lambdas.
- Full-time corners use a bivariate Poisson-Gamma mixture. League overdispersion activates only from settled OOS samples and is shrunk to the global alpha prior.
- Race-to-3/5 keeps the beta closed form: the shared Gamma factor scales both rates equally and therefore cancels from the first-arrival ordering probability.
- More Corners is conditioned on non-tie outcomes because the imported two-way market treats a tie as push.

## Probability and risk controls

- O/U, More Corners and Race require valid paired odds before no-vig calculation.
- Historical, simulation and no-vig components are exported separately.
- Component spread above 15 pp receives a symmetric haircut toward market; spread at or above 22 pp is marked `CONFLITO_FORTE_COM_MERCADO`.
- Initial minimum edges are 5% for O/U and 6% for More Corners/Race.
- O/U exports at most one principal line and two correlated alternatives on the same side; directional markets export one selection per market.
- Stakes use conservative fractional Kelly with per-pick, per-market and per-game caps.

## Walk-forward

Each prediction CSV receives an adjacent immutable snapshot. After results settle, label `outcome`, `home_corners` and `away_corners`, then run:

```bash
python modelos/cornermatrix_validation.py labeled_corner_snapshots.csv modelos/cornermatrix_calibration.json
```

Platt calibration is fitted separately for O/U, More Corners, Race 3 and Race 5. It activates only with at least 100 chronological observations and improved validation Brier Score. League alpha and baseline require at least 50 unique settled games.
