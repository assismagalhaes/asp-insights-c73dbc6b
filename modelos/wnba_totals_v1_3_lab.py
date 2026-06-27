from __future__ import annotations

import math
import random
from dataclasses import dataclass


DEFAULT_WNBA_TOTALS_V1_3_WEIGHTS = {"hist": 0.35, "sim": 0.35, "vig": 0.30}
DEFAULT_WNBA_TOTALS_SIMULATIONS = 10_000


@dataclass(frozen=True)
class WnbaExpectedPoints:
    home_expected: float
    away_expected: float
    total_expected: float
    home_sd: float
    away_sd: float
    total_sd: float


def normal_cdf(value: float, mean: float, sd: float) -> float:
    if sd <= 0:
        raise ValueError("sd must be positive")
    z = (value - mean) / (sd * math.sqrt(2.0))
    return 0.5 * (1.0 + math.erf(z))


def normal_total_probability(total_mean: float, total_sd: float, line: float, side: str) -> float:
    normalized_side = str(side or "").lower().strip()
    under = normal_cdf(line, total_mean, total_sd)
    if normalized_side == "under":
        return under
    if normalized_side == "over":
        return 1.0 - under
    raise ValueError("side must be 'over' or 'under'")


def simulate_total_probability(
    home_mean: float,
    away_mean: float,
    home_sd: float,
    away_sd: float,
    line: float,
    side: str,
    simulations: int = DEFAULT_WNBA_TOTALS_SIMULATIONS,
    seed: int | str | None = None,
) -> dict[str, float | int]:
    if simulations <= 0:
        raise ValueError("simulations must be positive")
    normalized_side = str(side or "").lower().strip()
    if normalized_side not in {"over", "under"}:
        raise ValueError("side must be 'over' or 'under'")
    if home_sd <= 0 or away_sd <= 0:
        raise ValueError("standard deviations must be positive")

    rng = random.Random(seed)
    wins = 0
    pushes = 0
    total_sum = 0.0
    for _ in range(simulations):
        home_points = max(0.0, rng.normalvariate(home_mean, home_sd))
        away_points = max(0.0, rng.normalvariate(away_mean, away_sd))
        total_points = home_points + away_points
        total_sum += total_points
        if math.isclose(total_points, line, abs_tol=1e-9):
            pushes += 1
            continue
        if normalized_side == "over" and total_points > line:
            wins += 1
        elif normalized_side == "under" and total_points < line:
            wins += 1

    decisions = simulations - pushes
    probability = wins / decisions if decisions else 0.5
    return {
        "probability": min(1.0, max(0.0, probability)),
        "simulations": simulations,
        "wins": wins,
        "pushes": pushes,
        "decisions": decisions,
        "average_total": total_sum / simulations,
    }


def poisson_total_probability(lambda_total: float, line: float, side: str) -> float:
    if lambda_total < 0:
        raise ValueError("lambda_total cannot be negative")
    normalized_side = str(side or "").lower().strip()
    floor_line = math.floor(float(line))
    under = poisson_cdf(lambda_total, floor_line)
    if normalized_side == "under":
        return under
    if normalized_side == "over":
        return 1.0 - under
    raise ValueError("side must be 'over' or 'under'")


def poisson_cdf(lambda_value: float, k: int) -> float:
    if k < 0:
        return 0.0
    if lambda_value == 0:
        return 1.0
    probability = math.exp(-lambda_value)
    total = probability
    for i in range(1, k + 1):
        probability *= lambda_value / i
        total += probability
    return min(1.0, max(0.0, total))


def calculate_expected_points_baseball_style(
    home_scored: float,
    home_allowed: float,
    away_scored: float,
    away_allowed: float,
    home_scored_sd: float,
    home_allowed_sd: float,
    away_scored_sd: float,
    away_allowed_sd: float,
    offense_weight: float = 0.55,
    defense_weight: float = 0.45,
    min_total_sd: float = 12.0,
) -> WnbaExpectedPoints:
    if not math.isclose(offense_weight + defense_weight, 1.0, abs_tol=1e-9):
        raise ValueError("offense_weight + defense_weight must equal 1.0")
    home_expected = max(0.0, home_scored * offense_weight + away_allowed * defense_weight)
    away_expected = max(0.0, away_scored * offense_weight + home_allowed * defense_weight)
    home_sd = math.sqrt((home_scored_sd * offense_weight) ** 2 + (away_allowed_sd * defense_weight) ** 2)
    away_sd = math.sqrt((away_scored_sd * offense_weight) ** 2 + (home_allowed_sd * defense_weight) ** 2)
    total_sd = max(min_total_sd, math.sqrt(home_sd**2 + away_sd**2))
    return WnbaExpectedPoints(
        home_expected=home_expected,
        away_expected=away_expected,
        total_expected=home_expected + away_expected,
        home_sd=home_sd,
        away_sd=away_sd,
        total_sd=total_sd,
    )


def calibrate_expected_points_to_market(
    expected: WnbaExpectedPoints,
    market_anchor_line: float,
    market_weight: float = 0.40,
) -> WnbaExpectedPoints:
    if not 0 <= market_weight <= 1:
        raise ValueError("market_weight must be between 0 and 1")
    calibrated_total = expected.total_expected * (1.0 - market_weight) + market_anchor_line * market_weight
    delta = calibrated_total - expected.total_expected
    home_expected = max(0.0, expected.home_expected + delta / 2.0)
    away_expected = max(0.0, expected.away_expected + delta / 2.0)
    return WnbaExpectedPoints(
        home_expected=home_expected,
        away_expected=away_expected,
        total_expected=home_expected + away_expected,
        home_sd=expected.home_sd,
        away_sd=expected.away_sd,
        total_sd=expected.total_sd,
    )


def blend_probability(prob_hist: float, prob_sim: float, prob_market: float, weights: dict[str, float] | None = None) -> float:
    used_weights = weights or DEFAULT_WNBA_TOTALS_V1_3_WEIGHTS
    total_weight = sum(float(value) for value in used_weights.values())
    if total_weight <= 0:
        raise ValueError("weights must have positive total")
    normalized = {key: float(value) / total_weight for key, value in used_weights.items()}
    probability = (
        prob_hist * normalized.get("hist", 0.0)
        + prob_sim * normalized.get("sim", 0.0)
        + prob_market * normalized.get("vig", 0.0)
    )
    return min(1.0, max(0.0, probability))


def fair_odd(probability: float) -> float:
    if probability <= 0:
        return 0.0
    return 1.0 / probability


def edge_decimal(probability: float, odd: float) -> float:
    return odd * probability - 1.0
