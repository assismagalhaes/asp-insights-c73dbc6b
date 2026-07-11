# ASP BackMatrix v1

## Objective

Back a clear home or away favorite only when the offered price remains favorable after a three-way no-vig market anchor, an overdispersed goal simulation and independent PackBall performance signals.

## Input contract

- Recent file: exactly 10 matches per team, all venues and leagues, excluding the previous season.
- Structural file: exactly 20 home-at-home / away-at-away matches per team, all leagues, allowing the previous season.
- Forecast mode accepts `NS` (`NF` is normalized to `NS`); diagnostic backtest mode accepts `FT`.
- The 83-column order, input hashes, generation timestamp and filenames are persisted per run.
- PackBall favorite codes observed in the real feed are: `1` home favorite, `2` away favorite, `3` strong home favorite, `4` strong away favorite and `5` no clear favorite.

## Probability model

The final favorite probability combines:

- 60% three-way no-vig market probability, requiring valid home/draw/away odds and overround no greater than 18%;
- 25% bivariate Poisson-Gamma simulation using attack/defense goal averages, league total, home share and PackBall expected goals;
- 15% empirical score using wins, opponent defeats, points per game, scoring first and converting the lead, shot accuracy and attack strength.

Recent form receives 35-45% and the 20-match venue profile receives 55-65%. Component disagreement above 15 percentage points is haircutted toward market; 22 points marks a strong conflict.

## Publication controls

- Favorite decimal odd from 1.30 to 2.00.
- Minimum favorite probability of 57%.
- Base edge of 4%, increased when CV or component agreement is weaker.
- CV scored-goal floor of 40% per team and 47.5% on average.
- At least 0.20 decimal-odd separation from the opposing team.
- PackBall code `5`, invalid paired odds and a side disagreement are rejected.
- Fractional Kelly is 10%, capped at 1.00u per game; strong market conflict is capped at 0.25u and marked as reserve.

## Backtest limitation

Historical `FT` rows from a current export are diagnostic only because their features may have been refreshed after kickoff. Official calibration requires immutable pre-kickoff snapshots. After labeling `outcome`, run:

On the supplied files, 112 settled standard favorites with valid paired odds had a 58.0% win rate. The uncalibrated v1 score improved diagnostic ranking AUC from 0.540 for market no-vig to 0.580, but remained underconfident and did not improve Brier Score (0.2434 versus 0.2430). These figures justify keeping market as the dominant component and prohibit activating calibration from this retrospective export.

After labeling genuine pre-kickoff snapshots, run:

```bash
python modelos/backmatrix_validation.py labeled_backmatrix_snapshots.csv modelos/backmatrix_calibration.json
```

Platt calibration activates only with at least 100 chronological walk-forward predictions and an improved out-of-sample Brier Score.
