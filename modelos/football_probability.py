import json
import math
import os
from pathlib import Path
from typing import Iterable, Mapping


EPSILON = 1e-12


def clamp_probability(value: float) -> float:
    return min(max(float(value), EPSILON), 1.0 - EPSILON)


def normalize_probabilities(values: Mapping[str, float], scale: float = 100.0) -> dict[str, float]:
    cleaned = {key: max(0.0, float(value)) for key, value in values.items()}
    total = sum(cleaned.values())
    if total <= 0:
        if not cleaned:
            return {}
        equal = scale / len(cleaned)
        return {key: equal for key in cleaned}
    return {key: value / total * scale for key, value in cleaned.items()}


def shrink_mean(observed: float, sample: int, prior: float, prior_strength: float = 10.0) -> float:
    sample = max(0, int(sample))
    strength = max(0.0, float(prior_strength))
    denominator = sample + strength
    if denominator <= 0:
        return float(prior)
    return ((sample * float(observed)) + (strength * float(prior))) / denominator


def blend_model_history(
    model: Mapping[str, float],
    history: Mapping[str, float] | None,
    sample: int,
    max_history_weight: float = 0.25,
    reliability_k: float = 20.0,
) -> dict[str, float]:
    model_norm = normalize_probabilities(model)
    if not history:
        return model_norm

    history_norm = normalize_probabilities(history)
    if set(model_norm) != set(history_norm):
        raise ValueError("Modelo e historico devem possuir as mesmas categorias.")

    reliability = max(0, int(sample)) / (max(0, int(sample)) + max(float(reliability_k), EPSILON))
    history_weight = min(max(float(max_history_weight), 0.0), 1.0) * reliability
    model_weight = 1.0 - history_weight
    blended = {
        key: model_norm[key] * model_weight + history_norm[key] * history_weight
        for key in model_norm
    }
    return normalize_probabilities(blended)


def load_calibration_config(path: str | Path | None = None) -> dict:
    raw_path = path or os.environ.get("FOOTBALL_CALIBRATION_PATH", "")
    if not raw_path:
        return {}
    config_path = Path(raw_path)
    if not config_path.exists():
        return {}
    try:
        value = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def calibrate_binary(probability: float, config: Mapping[str, float] | None = None) -> float:
    if not config:
        return clamp_probability(probability)
    slope = float(config.get("slope", 1.0))
    intercept = float(config.get("intercept", 0.0))
    p = clamp_probability(probability)
    logit = math.log(p / (1.0 - p))
    calibrated_logit = intercept + slope * logit
    if calibrated_logit >= 0:
        z = math.exp(-calibrated_logit)
        return 1.0 / (1.0 + z)
    z = math.exp(calibrated_logit)
    return z / (1.0 + z)


def calibrate_multiclass(
    probabilities: Mapping[str, float],
    config: Mapping[str, float] | None = None,
    scale: float = 100.0,
) -> dict[str, float]:
    normalized = normalize_probabilities(probabilities, scale=1.0)
    if config and ("slope" in config or "intercept" in config):
        calibrated = {key: calibrate_binary(value, config) for key, value in normalized.items()}
        return normalize_probabilities(calibrated, scale=scale)
    temperature = max(float((config or {}).get("temperature", 1.0)), 0.05)
    powered = {key: clamp_probability(value) ** (1.0 / temperature) for key, value in normalized.items()}
    return normalize_probabilities(powered, scale=scale)


def dixon_coles_multiplier(home_goals: int, away_goals: int, lambda_home: float, lambda_away: float, rho: float) -> float:
    rho = float(rho)
    if home_goals == 0 and away_goals == 0:
        return max(EPSILON, 1.0 - lambda_home * lambda_away * rho)
    if home_goals == 0 and away_goals == 1:
        return max(EPSILON, 1.0 + lambda_home * rho)
    if home_goals == 1 and away_goals == 0:
        return max(EPSILON, 1.0 + lambda_away * rho)
    if home_goals == 1 and away_goals == 1:
        return max(EPSILON, 1.0 - rho)
    return 1.0


def asian_handicap_legs(line: float) -> tuple[float, ...]:
    line = float(line)
    quarter_units = round(line * 4)
    if abs(line * 4 - quarter_units) > 1e-9:
        raise ValueError("Handicap asiatico deve usar incrementos de 0.25.")
    if quarter_units % 2 == 0:
        return (line,)
    lower = math.floor(line * 2) / 2.0
    upper = math.ceil(line * 2) / 2.0
    return (lower, upper)


def asian_handicap_outcome_weights(goal_diff: float, line: float) -> dict[str, float]:
    outcomes = {"win": 0.0, "push": 0.0, "loss": 0.0}
    legs = asian_handicap_legs(line)
    stake = 1.0 / len(legs)
    for leg in legs:
        adjusted = float(goal_diff) + leg
        if adjusted > 1e-12:
            outcomes["win"] += stake
        elif adjusted < -1e-12:
            outcomes["loss"] += stake
        else:
            outcomes["push"] += stake
    return outcomes


def asian_handicap_settlement(
    score_probabilities: Iterable[tuple[float, float]],
    line: float,
) -> dict[str, float]:
    settlement = {"win": 0.0, "push": 0.0, "loss": 0.0}
    total = 0.0
    for goal_diff, probability in score_probabilities:
        probability = max(0.0, float(probability))
        total += probability
        weights = asian_handicap_outcome_weights(goal_diff, line)
        for outcome in settlement:
            settlement[outcome] += probability * weights[outcome]
    if total <= 0:
        return settlement
    return {outcome: value / total for outcome, value in settlement.items()}


def asian_fair_odd(prob_win: float, prob_loss: float) -> float:
    prob_win = max(0.0, float(prob_win))
    prob_loss = max(0.0, float(prob_loss))
    if prob_win <= 0:
        return math.inf
    return 1.0 + (prob_loss / prob_win)


def asian_equivalent_probability(prob_win: float, prob_loss: float) -> float:
    decisive = max(0.0, float(prob_win)) + max(0.0, float(prob_loss))
    if decisive <= 0:
        return 0.5
    return max(0.0, float(prob_win)) / decisive


def asian_expected_value(prob_win: float, prob_loss: float, offered_odd: float) -> float:
    return float(prob_win) * (float(offered_odd) - 1.0) - float(prob_loss)
