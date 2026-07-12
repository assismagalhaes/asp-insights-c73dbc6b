# ASP CornerMatrix v2 audit

## Input contract

- Recent signal: 10 matches across all venues/leagues, excluding the previous season.
- Venue signal: 20 home-at-home / away-at-away matches across all leagues, allowing the previous season.
- Both teams must have exactly 10/10 or 20/20 collected matches in the corresponding file.
- Forecast mode accepts `NS` (`NF` is normalized to `NS`); backtest mode accepts only `FT`.
- Schema order, SHA-256 hashes, generation time and source filenames are persisted per run.

## Mathematical model

- Recent and structural averages are blended with dynamic 10/20 weights. Recent form is bounded at 30–45%; venue structure receives 55–70%.
- PackBall CV is treated as a consistency score: 0–1 columns are normalized to 0–100 and mixed scales are rejected. O/U uses 60% total-corner consistency + 40% scored-corner consistency; directional markets use 30% + 70%.
- Team corner rates use league-total priors, fixed home share until a valid OOS league baseline exists, attack/defense strength shrinkage and bounded lambdas.
- Full-time corners use a bivariate Poisson-Gamma mixture. League overdispersion activates only from settled OOS samples and is shrunk to the global alpha prior.
- Race-to-3/5 keeps the beta closed form: the shared Gamma factor scales both rates equally and therefore cancels from the first-arrival ordering probability.
- More Corners is conditioned on non-tie outcomes because the imported two-way market treats a tie as push.

## Probability and risk controls

- O/U, More Corners and Race require valid paired odds before no-vig calculation.
- Historical, simulation and no-vig components are exported separately.
- Probability weights are 35/50/15 for O/U and 30/55/15 for directional markets (history/simulation/no-vig).
- Component spread above 15 pp receives a symmetric haircut toward market; spread at or above 22 pp is marked `CONFLITO_FORTE_COM_MERCADO`.
- Initial minimum edges are 5% for O/U and 6% for More Corners/Race.
- O/U requires an individual CV floor of 45% for each team and an average CV of at least 50%; directional markets retain their per-team floors.
- O/U exports at most one principal line and two correlated alternatives on the same side; directional markets export one selection per market.
- Stakes use conservative fractional Kelly converted to bankroll percentage units, with per-pick, per-market and per-game caps.

## Executable-odd workflow (v2.4)

- PackBall odds can average one to five bookmakers and are stored as reference market odds.
- Passing probability, CV, paired-odds and corner-cost controls creates a `CANDIDATO_CORNER` with stake zero, even when reference edge is insufficient.
- Critical Validation requires an executable odd for the exact side and line.
- Operational price status is explicit: `AGUARDANDO_ODD_EXECUTAVEL`, `ODD_APROVADA` or `SEM_VALOR`.
- Adjusted edge and 12.5% fractional Kelly are recalculated only from that executable odd.
- Confirmation and publication remain blocked below 5% adjusted edge for O/U or 6% for More Corners/Race.
- CornerMatrix stake is capped at 0.75u while OOS calibration is insufficient, 0.50u from 12 pp component spread and 0.25u under strong conflict.
- Component conflict, market conflict and paired-odds validity are exported as separate diagnostics.
- Reference, validation and closing prices are stored in `prognostico_odds_historico`; `prognosticos_clv` exposes the latest validation-to-close CLV.
- The limit of one principal line plus two correlated alternatives remains active before validation.

## Walk-forward

Each prediction CSV receives an adjacent immutable snapshot. After results settle, label `outcome`, `home_corners` and `away_corners`, then run:

```bash
python modelos/cornermatrix_validation.py labeled_corner_snapshots.csv modelos/cornermatrix_calibration.json
```

Platt calibration is fitted separately for O/U, More Corners, Race 3 and Race 5. O/U also receives side-and-line keys (`ou_over_8_5`, `ou_under_8_5`, and equivalents), with fallback to the aggregate O/U calibration. It activates only with at least 100 chronological observations and improved validation Brier Score. League alpha and baseline require at least 50 unique settled games.
