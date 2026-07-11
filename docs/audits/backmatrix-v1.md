# ASP BackMatrix v1

## Objective

Identify qualified home or away favorite candidates from PackBall pre-match statistics, then require an executable bookmaker odd in Critical Validation before publication and bankroll allocation.

## Input contract

- Recent file: exactly 10 matches per team, all venues and leagues, excluding the previous season.
- Structural file: exactly 20 home-at-home / away-at-away matches per team, all leagues, allowing the previous season.
- Forecast mode accepts `NS` (`NF` is normalized to `NS`); diagnostic backtest mode accepts `FT`.
- The 83-column order, input hashes, generation timestamp and filenames are persisted per run.
- PackBall statistics remain frozen after kickoff. The imported odds can be averages from one to five bookmakers, while the bookmaker count is unavailable per match.
- PackBall favorite codes are: `1` home favorite, `2` away favorite, `3` super home favorite, `4` super away favorite and `5` slight favorite. For code `5`, the side is derived from the lower valid odd. Empty values mean no PackBall favorite signal and are rejected.

## Probability model

The final favorite probability combines:

- 60% three-way no-vig market probability, requiring valid home/draw/away odds and overround no greater than 18%;
- 25% bivariate Poisson-Gamma simulation using attack/defense goal averages, league total, home share and PackBall expected goals;
- 15% empirical score using wins, opponent defeats, points per game, scoring first and converting the lead, shot accuracy and attack strength.

Recent form receives 35-45% and the 20-match venue profile receives 55-65%. Component disagreement above 15 percentage points is haircutted toward market; 22 points marks a strong conflict.

## Candidate controls

- Super favorite: odd from 1.05 to 1.30, minimum probability 80% and base edge 3%.
- Standard favorite: odd from 1.30 to 2.00, minimum probability 57% and base edge 4%.
- Slight favorite: odd from 2.00 to 2.80, minimum probability 45% and base edge 5%.
- Each base edge is increased when CV or component agreement is weaker.
- CV scored-goal floor of 40% per team and 47.5% on average.
- At least 0.20 decimal-odd separation from the opposing team.
- Missing PackBall signal, invalid paired odds and a side disagreement are rejected.
- Passing probability and CV creates a `CANDIDATO_BACK`, even when the PackBall reference edge is negative.

## Validation and publication

- PackBall average odds are stored as market reference, not as an executable offer.
- Critical Validation requires an explicitly entered executable odd.
- The adjusted edge must meet the candidate-specific minimum recorded by the runner.
- Fractional Kelly is recalculated from the executable odd at 10%, capped at 1.00u per game; strong market conflict is capped at 0.25u.
- A candidate with no executable odd, insufficient adjusted edge or Kelly below 0.25u cannot be confirmed or published.

## Backtest limitation

Historical `FT` rows are valid for retrospective discrimination tests because PackBall statistics remain frozen. ROI calculated from PackBall average odds is still theoretical because the average may combine one to five bookmakers and is not guaranteed to be executable at one bookmaker.

On the July 4-10 supplied files, 999 matches crossed the exact 10/20 windows. Probability and CV qualified 30 candidates: 23 won (76.7%), for a theoretical flat-stake result of +3.87u at the PackBall average odds. No candidate met the original reference-edge gate, which motivated the two-stage executable-odd workflow.

Code `5` slight favorites won 24 of 43 settled non-draw matches (55.8%) at a median favorite odd of 2.255 in the supplied export. This supports retaining a separate conservative candidate band.

After labeling genuine pre-kickoff snapshots, run:

```bash
python modelos/backmatrix_validation.py labeled_backmatrix_snapshots.csv modelos/backmatrix_calibration.json
```

Platt calibration activates only with at least 100 chronological walk-forward predictions and an improved out-of-sample Brier Score.
