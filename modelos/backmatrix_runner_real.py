from __future__ import annotations

import contextlib
import csv
import hashlib
import json
import logging
import math
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


MODEL_NAME = "ASP BackMatrix"
MODEL_VERSION = "v1.2"
PACKBALL_FILE_10 = "PackBall Custom ASP_BackMatrix_10 {date}.csv"
PACKBALL_FILE_20 = "PackBall Custom ASP_BackMatrix_20 {date}.csv"

RUN_MODE = "prognostico"
STATUSES_BY_MODE = {"prognostico": ("NS",), "backtest": ("FT",)}
STATUSES = STATUSES_BY_MODE[RUN_MODE]

RECENT_WEIGHT_BASE = 0.40
RECENT_WEIGHT_MIN = 0.35
RECENT_WEIGHT_MAX = 0.45
LEAGUE_HOME_SHARE = 0.54
LAMBDA_TOTAL_DEFAULT = 2.65
LAMBDA_TOTAL_RANGE = (0.50, 8.00)
LAMBDA_TEAM_RANGE = (0.05, 6.00)
OVERDISPERSION_ALPHA = 0.10
N_SIMS = 30_000

WEIGHT_MARKET = 0.60
WEIGHT_POISSON = 0.25
WEIGHT_EMPIRICAL = 0.15
DISAGREEMENT_THRESHOLD_PP = 15.0
STRONG_CONFLICT_THRESHOLD_PP = 22.0
HAIRCUT_STRENGTH = 0.25
HAIRCUT_MAX_PP = 6.0

MIN_ODD = 1.30
MAX_ODD = 2.00
MIN_PROBABILITY = 57.0
MIN_EDGE = 4.0
SUPER_MIN_ODD = 1.05
SUPER_MAX_ODD = 1.30
SUPER_MIN_PROBABILITY = 80.0
SUPER_MIN_EDGE = 3.0
LIGHT_MIN_ODD = 2.00
LIGHT_MAX_ODD = 2.80
LIGHT_MIN_PROBABILITY = 45.0
LIGHT_MIN_EDGE = 5.0
MIN_CV_INDIVIDUAL = 40.0
MIN_CV_AVERAGE = 47.5
MAX_MARKET_OVERROUND = 0.18
MIN_FAVORITE_ODDS_GAP = 0.20

KELLY_FRACTION = 0.10
MAX_PICK_UNITS = 1.00
CONFLICT_MAX_UNITS = 0.25

CALIBRATION_PATH = Path(os.getenv("BACKMATRIX_CALIBRATION_PATH", Path(__file__).with_name("backmatrix_calibration.json")))
RUN_PROVENANCE: dict[str, object] = {}

PREDICTION_COLUMNS = [
    "data", "hora", "esporte", "liga", "jogo", "mandante", "visitante", "mercado", "pick",
    "odd_ofertada", "odd_valor", "probabilidade_final", "edge", "stake", "modelo_versao",
    "market_type", "selection_side", "selection_role", "market_conflict_status", "favorite_class",
    "prob_market_no_vig", "prob_poisson", "prob_empirical", "prob_raw", "prob_pre_calibration",
    "calibration_status", "haircut_pp", "component_spread_pp", "cv_home", "cv_away", "cv_average",
    "required_edge", "edge_referencial", "odd_minima_publicacao", "requires_executable_odd",
    "odd_mercado_base", "odd_mediana", "observacoes", "dados_tecnicos", "contexto_adicional", "contexto_modelo", "odd",
    "probabilidade", "parecer_validacao",
]

SOURCE_HEADERS = [
    "Country ", "Short", "League ", "Hour", "Status", "Home Team", "Result Home",
    "Result Visitor", "Visitor Team", "Odds", "Odds.1", "Odds.2", "Casa", "Fora",
    "Casa.1", "Fora.1", "Casa.2", "Fora.2", "Casa.3", "Fora.3", "Casa.4", "Fora.4",
    "Casa.5", "Fora.5", "Casa.6", "Fora.6", "Casa.7", "Fora.7", "Casa.8", "Fora.8",
    "Casa.9", "Fora.9", "Casa.10", "Fora.10", "Casa.11", "Fora.11", "Casa.12",
    "Fora.12", "Casa.13", "Fora.13", "Casa.14", "Fora.14", "Casa.15", "Fora.15",
    "Casa.16", "Fora.16", "Global", "Casa.17", "Fora.17", "Casa.18", "Fora.18",
    "Casa.19", "Fora.19", "Casa.20", "Fora.20", "Casa.21", "Fora.21", "Global.1",
    "Casa.22", "Fora.22", "Casa.23", "Fora.23", "Global.2", "Casa.24", "Fora.24",
    "Casa.25", "Fora.25", "Casa.26", "Fora.26", "Casa.27", "Fora.27", "Casa.28",
    "Fora.28", "Casa.29", "Fora.29", "Casa.30", "Fora.30", "Casa.31", "Fora.31",
    "Casa.32", "Fora.32", "Casa.33", "Fora.33",
]

NORMALIZED_COLUMNS = [
    "Pais", "Sigla", "Liga", "Data/Hora", "Status", "Time Casa", "Resultado Casa",
    "Resultado Visitante", "Time Visitante", "Odd Casa", "Odd Empate", "Odd Visitante",
    "Vitoria Casa", "Vitoria Visitante", "Empate Casa", "Empate Visitante", "Derrota Casa",
    "Derrota Visitante", "Vitoria 1T Casa", "Vitoria 1T Visitante", "Empate 1T Casa",
    "Empate 1T Visitante", "Derrota 1T Casa", "Derrota 1T Visitante", "Vitoria 2T Casa",
    "Vitoria 2T Visitante", "Empate 2T Casa", "Empate 2T Visitante", "Derrota 2T Casa",
    "Derrota 2T Visitante", "Marcou Primeiro Casa", "Marcou Primeiro Visitante", "Sem Gols Casa",
    "Sem Gols Visitante", "Over 0.5 Casa", "Over 0.5 Visitante", "Over 1.5 Casa",
    "Over 1.5 Visitante", "Over 2.5 Casa", "Over 2.5 Visitante", "BTTS Casa", "BTTS Visitante",
    "Media Marcados Casa", "Media Marcados Visitante", "Media Sofridos Casa",
    "Media Sofridos Visitante", "Media Gols Liga", "Sofreu Primeiro Casa",
    "Sofreu Primeiro Visitante", "Marcou Gols Casa", "Marcou Gols Visitante", "Sofreu Gols Casa",
    "Sofreu Gols Visitante", "AH -0.5 Casa", "AH -0.5 Visitante", "AH -1.5 Casa",
    "AH -1.5 Visitante", "Expectativa Gols", "Forca Ataque Casa", "Forca Ataque Visitante",
    "Forca Defesa Casa", "Forca Defesa Visitante", "Favoritismo PackBall", "PPG Casa",
    "PPG Visitante", "Primeiro e Vence Casa", "Primeiro e Vence Visitante",
    "Sofre Primeiro e Vence Casa", "Sofre Primeiro e Vence Visitante", "Clean Sheet Casa",
    "Clean Sheet Visitante", "Sem Marcar Casa", "Sem Marcar Visitante", "CV Marcados Casa",
    "CV Marcados Visitante", "Classificacao Casa", "Classificacao Visitante", "Jogos Casa",
    "Jogos Visitante", "Precisao Chutes Casa", "Precisao Chutes Visitante", "Chutes Casa",
    "Chutes Visitante",
]

PERCENT_COLUMNS = NORMALIZED_COLUMNS[12:42] + NORMALIZED_COLUMNS[47:57] + NORMALIZED_COLUMNS[58:62] + NORMALIZED_COLUMNS[65:75] + NORMALIZED_COLUMNS[79:81]
NUMERIC_COLUMNS = ["Resultado Casa", "Resultado Visitante"] + NORMALIZED_COLUMNS[9:]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S")


def sniff_sep(path: Path) -> str:
    with path.open("r", encoding="utf-8", errors="ignore") as fh:
        sample = fh.read(4096)
    try:
        return csv.Sniffer().sniff(sample, delimiters=[";", ",", "\t"]).delimiter
    except csv.Error:
        return ";"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def schema_sha256(columns) -> str:
    payload = json.dumps([str(column) for column in columns], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_source_schema(frame: pd.DataFrame, label: str) -> None:
    actual = [str(column) for column in frame.columns]
    if actual != SOURCE_HEADERS:
        raise ValueError(f"BACKMATRIX_SCHEMA_DRIFT:{label}: expected={len(SOURCE_HEADERS)} actual={len(actual)}")


def normalize_columns(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    normalized.columns = NORMALIZED_COLUMNS
    return normalized


def _numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(
        series.astype(str).str.strip().str.replace("%", "", regex=False).str.replace(",", ".", regex=False),
        errors="coerce",
    )


def coerce_numeric(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    for column in NUMERIC_COLUMNS:
        if column in frame:
            frame[column] = _numeric(frame[column])
    for column in PERCENT_COLUMNS:
        invalid = frame[column].notna() & ~frame[column].between(0.0, 100.0)
        frame.loc[invalid, column] = np.nan
    frame["Status"] = frame["Status"].astype(str).str.strip().str.upper().replace({"NF": "NS", "FT_PEN": "FT", "AET": "FT"})
    frame["Time Casa"] = frame["Time Casa"].astype(str).str.strip()
    frame["Time Visitante"] = frame["Time Visitante"].astype(str).str.strip()
    frame["Data/Hora"] = pd.to_datetime(frame["Data/Hora"], errors="coerce", dayfirst=True)
    return frame


def load_source(path: Path, label: str) -> pd.DataFrame:
    frame = pd.read_csv(path, sep=sniff_sep(path), encoding="utf-8-sig", engine="python")
    validate_source_schema(frame, label)
    frame = coerce_numeric(normalize_columns(frame))
    logging.info("%s lido: %s -> %s", label, path.name, frame.shape)
    return frame


def validate_window_profile(frame: pd.DataFrame, expected: int, label: str) -> None:
    counts = pd.concat([frame["Jogos Casa"], frame["Jogos Visitante"]]).dropna()
    if counts.empty or not (counts == expected).any():
        raise ValueError(f"BACKMATRIX_WINDOW_MISMATCH:{label}:expected={expected}")


def filter_by_status_and_games(frame: pd.DataFrame, statuses: tuple[str, ...], expected: int) -> pd.DataFrame:
    return frame.loc[
        frame["Status"].isin(statuses)
        & frame["Jogos Casa"].eq(expected)
        & frame["Jogos Visitante"].eq(expected)
    ].copy()


def merge_windows(recent: pd.DataFrame, venue: pd.DataFrame) -> pd.DataFrame:
    keys = ["Liga", "Data/Hora", "Time Casa", "Time Visitante"]
    merged = recent.merge(venue, on=keys, how="inner", suffixes=("_10", "_20"), validate="one_to_one")
    return merged


def build_dynamic_weights(merged: pd.DataFrame) -> pd.DataFrame:
    merged = merged.copy()
    cv_game = (
        merged["CV Marcados Casa_20"].fillna(50.0)
        + merged["CV Marcados Visitante_20"].fillna(50.0)
    ) / 2.0
    deltas = []
    for name in ("Vitoria Casa", "Vitoria Visitante", "PPG Casa", "PPG Visitante"):
        scale = 100.0 if name.startswith("Vitoria") else 3.0
        deltas.append((merged[f"{name}_10"] - merged[f"{name}_20"]).abs() / scale)
    divergence = (sum(deltas) / len(deltas)).fillna(0.0)
    recent_boost = divergence.clip(0.0, 0.25) * 0.20
    consistency_adjustment = ((50.0 - cv_game) / 100.0).clip(-0.03, 0.03)
    merged["_w10"] = (RECENT_WEIGHT_BASE + recent_boost + consistency_adjustment).clip(RECENT_WEIGHT_MIN, RECENT_WEIGHT_MAX)
    merged["_w20"] = 1.0 - merged["_w10"]
    merged["_cv_home"] = merged["CV Marcados Casa_20"]
    merged["_cv_away"] = merged["CV Marcados Visitante_20"]
    merged["_cv_average"] = (merged["_cv_home"] + merged["_cv_away"]) / 2.0
    return merged


def blend(merged: pd.DataFrame, name: str) -> pd.Series:
    return merged[f"{name}_10"] * merged["_w10"] + merged[f"{name}_20"] * merged["_w20"]


def blend_optional(merged: pd.DataFrame, name: str) -> pd.Series:
    recent = merged[f"{name}_10"].astype(float)
    venue = merged[f"{name}_20"].astype(float)
    numerator = recent.fillna(0.0) * merged["_w10"] + venue.fillna(0.0) * merged["_w20"]
    denominator = recent.notna().astype(float) * merged["_w10"] + venue.notna().astype(float) * merged["_w20"]
    return numerator.div(denominator.replace(0.0, np.nan))


def calculate_no_vig_probabilities(base: pd.DataFrame) -> pd.DataFrame:
    base = base.copy()
    odds = base[["Odd Casa", "Odd Empate", "Odd Visitante"]].astype(float)
    valid = odds.notna().all(axis=1) & odds.gt(1.0).all(axis=1)
    inverse = 1.0 / odds.where(valid)
    overround = inverse.sum(axis=1) - 1.0
    valid &= overround.between(0.0, MAX_MARKET_OVERROUND)
    denominator = inverse.sum(axis=1)
    base["NoVig Casa"] = (inverse["Odd Casa"] / denominator * 100.0).where(valid)
    base["NoVig Empate"] = (inverse["Odd Empate"] / denominator * 100.0).where(valid)
    base["NoVig Visitante"] = (inverse["Odd Visitante"] / denominator * 100.0).where(valid)
    base["Overround"] = overround.where(valid)
    base["Odds Pareadas"] = valid
    return base


def build_lambdas(base: pd.DataFrame) -> pd.DataFrame:
    base = base.copy()
    league_total = base["Media Gols Liga"].fillna(LAMBDA_TOTAL_DEFAULT).clip(*LAMBDA_TOTAL_RANGE)
    baseline_home = league_total * LEAGUE_HOME_SHARE
    baseline_away = league_total * (1.0 - LEAGUE_HOME_SHARE)

    raw_home = np.sqrt(
        base["Media Marcados Casa"].clip(lower=0.05)
        * base["Media Sofridos Visitante"].clip(lower=0.05)
    ).fillna(baseline_home)
    raw_away = np.sqrt(
        base["Media Marcados Visitante"].clip(lower=0.05)
        * base["Media Sofridos Casa"].clip(lower=0.05)
    ).fillna(baseline_away)
    gamma_home = (0.35 + 0.55 * base["CV Casa"].fillna(50.0).div(100.0)).clip(0.35, 0.90)
    gamma_away = (0.35 + 0.55 * base["CV Visitante"].fillna(50.0).div(100.0)).clip(0.35, 0.90)
    lambda_home = baseline_home + gamma_home * (raw_home - baseline_home)
    lambda_away = baseline_away + gamma_away * (raw_away - baseline_away)

    expected_total = base["Expectativa Gols"].where(base["Expectativa Gols"].between(*LAMBDA_TOTAL_RANGE))
    current_total = (lambda_home + lambda_away).replace(0.0, np.nan)
    target_total = current_total * 0.80 + expected_total.fillna(current_total) * 0.20
    scale = target_total.div(current_total).clip(0.75, 1.25).fillna(1.0)
    base["Lambda Casa"] = (lambda_home * scale).clip(*LAMBDA_TEAM_RANGE)
    base["Lambda Visitante"] = (lambda_away * scale).clip(*LAMBDA_TEAM_RANGE)
    base["Lambda Total"] = base["Lambda Casa"] + base["Lambda Visitante"]
    return base


def simulate_outcome_probabilities(base: pd.DataFrame) -> pd.DataFrame:
    base = base.copy()
    home_prob, draw_prob, away_prob = [], [], []
    for _, row in base.iterrows():
        key = f"{row.get('Data/Hora')}|{row.get('Time Casa')}|{row.get('Time Visitante')}"
        seed = int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        shape = 1.0 / OVERDISPERSION_ALPHA
        common = rng.gamma(shape=shape, scale=OVERDISPERSION_ALPHA, size=N_SIMS)
        home = rng.poisson(float(row["Lambda Casa"]) * common)
        away = rng.poisson(float(row["Lambda Visitante"]) * common)
        home_prob.append(float(np.mean(home > away) * 100.0))
        draw_prob.append(float(np.mean(home == away) * 100.0))
        away_prob.append(float(np.mean(away > home) * 100.0))
    base["Poisson Casa"] = home_prob
    base["Poisson Empate"] = draw_prob
    base["Poisson Visitante"] = away_prob
    return base


def _bounded(series: pd.Series, low: float = 0.0, high: float = 100.0, fallback: float = 50.0) -> pd.Series:
    return series.astype(float).clip(low, high).fillna(fallback)


def build_empirical_probabilities(base: pd.DataFrame) -> pd.DataFrame:
    base = base.copy()
    ppg_home = _bounded(base["PPG Casa"] / 3.0 * 100.0)
    ppg_away = _bounded(base["PPG Visitante"] / 3.0 * 100.0)
    first_win_home = _bounded(base["Marcou Primeiro Casa"] * base["Primeiro e Vence Casa"] / 100.0)
    first_win_away = _bounded(base["Marcou Primeiro Visitante"] * base["Primeiro e Vence Visitante"] / 100.0)

    shot_home = (_bounded(base["Precisao Chutes Casa"]) * 0.65 + _bounded(base["Forca Ataque Casa"]) * 0.35)
    shot_away = (_bounded(base["Precisao Chutes Visitante"]) * 0.65 + _bounded(base["Forca Ataque Visitante"]) * 0.35)

    raw_home = (
        0.30 * _bounded(base["Vitoria Casa"])
        + 0.20 * _bounded(base["Derrota Visitante"])
        + 0.25 * ppg_home
        + 0.15 * first_win_home
        + 0.10 * shot_home
    )
    raw_away = (
        0.30 * _bounded(base["Vitoria Visitante"])
        + 0.20 * _bounded(base["Derrota Casa"])
        + 0.25 * ppg_away
        + 0.15 * first_win_away
        + 0.10 * shot_away
    )
    raw_draw = 0.60 * ((_bounded(base["Empate Casa"]) + _bounded(base["Empate Visitante"])) / 2.0) + 8.0
    denominator = (raw_home + raw_draw + raw_away).replace(0.0, np.nan)
    base["Empirica Casa"] = raw_home / denominator * 100.0
    base["Empirica Empate"] = raw_draw / denominator * 100.0
    base["Empirica Visitante"] = raw_away / denominator * 100.0
    return base


def _apply_disagreement_control(model: pd.Series, market: pd.Series, components: list[pd.Series]) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    stack = np.vstack([component.to_numpy(dtype=float) for component in components])
    spread = pd.Series(np.nanmax(stack, axis=0) - np.nanmin(stack, axis=0), index=model.index)
    excess = (spread - DISAGREEMENT_THRESHOLD_PP).clip(lower=0.0)
    haircut = (excess * HAIRCUT_STRENGTH).clip(upper=HAIRCUT_MAX_PP)
    adjusted = model + np.sign(market - model) * haircut
    conflict = spread >= STRONG_CONFLICT_THRESHOLD_PP
    return adjusted.clip(0.5, 99.5), haircut, spread, conflict


def finalize_probabilities(base: pd.DataFrame) -> pd.DataFrame:
    base = base.copy()
    for side in ("Casa", "Empate", "Visitante"):
        market = base[f"NoVig {side}"]
        poisson = base[f"Poisson {side}"]
        empirical = base[f"Empirica {side}"]
        raw = WEIGHT_MARKET * market + WEIGHT_POISSON * poisson + WEIGHT_EMPIRICAL * empirical
        adjusted, haircut, spread, conflict = _apply_disagreement_control(raw, market, [market, poisson, empirical])
        base[f"Prob Raw {side}"] = raw
        base[f"Prob Final {side}"] = adjusted
        base[f"Haircut {side}"] = haircut
        base[f"Spread {side}"] = spread
        base[f"Conflict {side}"] = conflict
    total = base[["Prob Final Casa", "Prob Final Empate", "Prob Final Visitante"]].sum(axis=1)
    for side in ("Casa", "Empate", "Visitante"):
        base[f"Prob Final {side}"] = base[f"Prob Final {side}"] / total * 100.0
    return base


def favorite_side_from_code(value, home_odd=None, away_odd=None) -> str | None:
    try:
        code = int(float(value))
    except (TypeError, ValueError):
        return None
    if code in {1, 3}:
        return "Casa"
    if code in {2, 4}:
        return "Visitante"
    if code == 5:
        try:
            home_odd = float(home_odd)
            away_odd = float(away_odd)
        except (TypeError, ValueError):
            return None
        if not (np.isfinite(home_odd) and np.isfinite(away_odd)) or home_odd == away_odd:
            return None
        return "Casa" if home_odd < away_odd else "Visitante"
    return None


def favorite_class_from_code(value, home_odd=None, away_odd=None) -> str:
    try:
        code = int(float(value))
    except (TypeError, ValueError):
        return "SEM_SINAL_PACKBALL"
    favorite_class = {
        1: "FAVORITO_CASA",
        2: "FAVORITO_VISITANTE",
        3: "SUPERFAVORITO_CASA",
        4: "SUPERFAVORITO_VISITANTE",
    }.get(code)
    if favorite_class:
        return favorite_class
    if code == 5:
        side = favorite_side_from_code(code, home_odd, away_odd)
        return f"LEVE_FAVORITO_{side.upper()}" if side else "LEVE_FAVORITO_SEM_LADO"
    return "CODIGO_DESCONHECIDO"


def favorite_publication_policy(favorite_class: str) -> tuple[float, float, float, float] | None:
    if favorite_class.startswith("SUPERFAVORITO_"):
        return SUPER_MIN_ODD, SUPER_MAX_ODD, SUPER_MIN_PROBABILITY, SUPER_MIN_EDGE
    if favorite_class.startswith("FAVORITO_"):
        return MIN_ODD, MAX_ODD, MIN_PROBABILITY, MIN_EDGE
    if favorite_class.startswith("LEVE_FAVORITO_") and favorite_class != "LEVE_FAVORITO_SEM_LADO":
        return LIGHT_MIN_ODD, LIGHT_MAX_ODD, LIGHT_MIN_PROBABILITY, LIGHT_MIN_EDGE
    return None


def calibrate_moneyline_probability(probability_pct: float) -> tuple[float, str]:
    try:
        payload = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
        config = payload.get("markets", {}).get("moneyline", {})
    except Exception:
        return float(probability_pct), "identity_missing_calibration"
    status = str(config.get("status") or "identity_insufficient_oos_sample")
    if not bool(config.get("active")) or int(config.get("sample_size") or 0) < 100:
        return float(probability_pct), status
    probability = np.clip(float(probability_pct) / 100.0, 1e-6, 1.0 - 1e-6)
    logit = math.log(probability / (1.0 - probability))
    linear = float(config.get("intercept", 0.0)) + float(config.get("slope", 1.0)) * logit
    calibrated = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, linear))))
    return calibrated * 100.0, status


def kelly_stake_units(probability_pct: float, odd: float, *, conflict: bool = False) -> float:
    probability = float(probability_pct) / 100.0
    decimal_odd = float(odd)
    if not (0.0 < probability < 1.0) or decimal_odd <= 1.0:
        return 0.0
    b = decimal_odd - 1.0
    full_kelly = max(0.0, (b * probability - (1.0 - probability)) / b)
    units = min(MAX_PICK_UNITS, full_kelly * KELLY_FRACTION * 100.0)
    if conflict:
        units = min(units, CONFLICT_MAX_UNITS)
    return math.floor(units * 4.0 + 1e-9) / 4.0


def _fmt(value, digits: int = 2) -> str:
    try:
        value = float(value)
        if not np.isfinite(value):
            return "-"
        return f"{value:.{digits}f}"
    except (TypeError, ValueError):
        return "-"


def _build_prediction(row: pd.Series) -> dict | None:
    if not bool(row.get("Odds Pareadas")):
        return None
    home_odd = float(row["Odd Casa"])
    away_odd = float(row["Odd Visitante"])
    if home_odd == away_odd:
        return None
    side = "Casa" if home_odd < away_odd else "Visitante"
    opponent_side = "Visitante" if side == "Casa" else "Casa"
    odd = float(row[f"Odd {side}"])
    opponent_odd = float(row[f"Odd {opponent_side}"])
    if opponent_odd - odd < MIN_FAVORITE_ODDS_GAP:
        return None

    packball_value = row.get("Favoritismo PackBall")
    packball_class = favorite_class_from_code(packball_value, home_odd, away_odd)
    packball_side = favorite_side_from_code(packball_value, home_odd, away_odd)
    policy = favorite_publication_policy(packball_class)
    if policy is None or packball_side is None:
        return None
    if packball_side != side:
        return None
    min_odd, max_odd, min_probability, base_edge = policy
    if not (min_odd <= odd <= max_odd):
        return None

    cv_home = float(row.get("CV Casa"))
    cv_away = float(row.get("CV Visitante"))
    cv_average = (cv_home + cv_away) / 2.0
    if not (np.isfinite(cv_home) and np.isfinite(cv_away)):
        return None
    if min(cv_home, cv_away) < MIN_CV_INDIVIDUAL or cv_average < MIN_CV_AVERAGE:
        return None

    probability_pre_calibration = float(row[f"Prob Final {side}"])
    probability, calibration_status = calibrate_moneyline_probability(probability_pre_calibration)
    if probability < min_probability:
        return None
    edge = (odd * probability / 100.0 - 1.0) * 100.0
    spread = float(row[f"Spread {side}"])
    required_edge = base_edge + min(2.0, max(0.0, 55.0 - cv_average) * 0.08 + max(0.0, spread - 15.0) * 0.05)
    conflict = bool(row[f"Conflict {side}"])
    minimum_executable_odd = (1.0 + required_edge / 100.0) / (probability / 100.0)

    pick = str(row["Time Casa"] if side == "Casa" else row["Time Visitante"])
    data_hora = row.get("Data/Hora")
    data = data_hora.strftime("%d/%m/%Y") if pd.notna(data_hora) else ""
    hora = data_hora.strftime("%H:%M") if pd.notna(data_hora) else ""
    role = "CANDIDATO_BACK"
    observations = (
        f"Favorito: {pick} ({side}) | Classe PackBall: {packball_class} | "
        f"No-vig: {_fmt(row[f'NoVig {side}'])}% | Poisson-Gamma: {_fmt(row[f'Poisson {side}'])}% | "
        f"Empírica: {_fmt(row[f'Empirica {side}'])}% | Probabilidade final: {_fmt(probability)}% | "
        f"CV casa/visitante/média: {_fmt(cv_home)}/{_fmt(cv_away)}/{_fmt(cv_average)} | "
        f"Edge referencial: {_fmt(edge)}% | Edge exigido: {_fmt(required_edge)}% | "
        f"Odd minima publicacao: {_fmt(minimum_executable_odd, 3)} | Spread componentes: {_fmt(spread)} p.p."
    )
    technical = "\n".join([
        f"Confronto: {row['Time Casa']} vs {row['Time Visitante']}",
        f"Liga: {row['Pais']} - {row['Liga']}",
        f"Data/Hora: {data} {hora}",
        f"Favorito operacional: {pick} ({side})",
        "Status operacional: CANDIDATO_BACK - exige odd executavel na Validacao Critica.",
        "Odds PackBall sao referencia media de 1 a 5 casas; quantidade de casas nao esta disponivel por partida.",
        f"Odds 1/X/2: {_fmt(row['Odd Casa'])} / {_fmt(row['Odd Empate'])} / {_fmt(row['Odd Visitante'])}",
        f"Overround: {_fmt(float(row['Overround']) * 100.0)}%",
        f"Lambda casa/visitante: {_fmt(row['Lambda Casa'], 3)} / {_fmt(row['Lambda Visitante'], 3)}",
        f"Probabilidades mercado H/D/A: {_fmt(row['NoVig Casa'])}% / {_fmt(row['NoVig Empate'])}% / {_fmt(row['NoVig Visitante'])}%",
        f"Probabilidades Poisson H/D/A: {_fmt(row['Poisson Casa'])}% / {_fmt(row['Poisson Empate'])}% / {_fmt(row['Poisson Visitante'])}%",
        f"Probabilidades empíricas H/D/A: {_fmt(row['Empirica Casa'])}% / {_fmt(row['Empirica Empate'])}% / {_fmt(row['Empirica Visitante'])}%",
        f"Pesos mercado/Poisson/empírico: {WEIGHT_MARKET:.2f}/{WEIGHT_POISSON:.2f}/{WEIGHT_EMPIRICAL:.2f}",
        f"Pesos temporal 10/20: {_fmt(row['w10'], 3)}/{_fmt(row['w20'], 3)}",
        observations,
    ])
    return {
        "data": data,
        "hora": hora,
        "esporte": "Futebol",
        "liga": f"{row['Pais']} - {row['Liga']}",
        "jogo": f"{row['Time Casa']} vs {row['Time Visitante']}",
        "mandante": row["Time Casa"],
        "visitante": row["Time Visitante"],
        "mercado": MODEL_NAME,
        "pick": pick,
        "linha": "",
        "odd_ofertada": round(odd, 2),
        "odd_valor": round(100.0 / probability, 2),
        "probabilidade_final": round(probability, 2),
        "edge": round(edge, 2),
        "stake": 0.0,
        "modelo_versao": MODEL_VERSION,
        "market_type": "MONEYLINE",
        "selection_side": "HOME" if side == "Casa" else "AWAY",
        "selection_role": role,
        "market_conflict_status": "CONFLITO_FORTE_COM_MERCADO" if conflict else "ALINHADO",
        "favorite_class": packball_class,
        "prob_market_no_vig": round(float(row[f"NoVig {side}"]), 2),
        "prob_poisson": round(float(row[f"Poisson {side}"]), 2),
        "prob_empirical": round(float(row[f"Empirica {side}"]), 2),
        "prob_raw": round(float(row[f"Prob Raw {side}"]), 2),
        "prob_pre_calibration": round(probability_pre_calibration, 2),
        "calibration_status": calibration_status,
        "haircut_pp": round(float(row[f"Haircut {side}"]), 2),
        "component_spread_pp": round(spread, 2),
        "cv_home": round(cv_home, 2),
        "cv_away": round(cv_away, 2),
        "cv_average": round(cv_average, 2),
        "required_edge": round(required_edge, 2),
        "edge_referencial": round(edge, 2),
        "odd_minima_publicacao": round(minimum_executable_odd, 3),
        "requires_executable_odd": True,
        "odd_mercado_base": round(odd, 2),
        "odd_mediana": None,
        "observacoes": observations,
        "dados_tecnicos": technical,
        "contexto_adicional": technical,
        "contexto_modelo": technical,
        "odd": round(odd, 2),
        "probabilidade": round(probability, 2),
        "parecer_validacao": "AGUARDAR_ODD_EXECUTAVEL",
    }


def build_base(merged: pd.DataFrame) -> pd.DataFrame:
    merged = build_dynamic_weights(merged)
    base = pd.DataFrame({
        "Pais": merged["Pais_10"],
        "Sigla": merged["Sigla_10"],
        "Liga": merged["Liga_10"],
        "Data/Hora": merged["Data/Hora"],
        "Status": merged["Status_10"],
        "Time Casa": merged["Time Casa"],
        "Time Visitante": merged["Time Visitante"],
        "Resultado Casa": merged["Resultado Casa_10"],
        "Resultado Visitante": merged["Resultado Visitante_10"],
        "Odd Casa": merged["Odd Casa_10"],
        "Odd Empate": merged["Odd Empate_10"],
        "Odd Visitante": merged["Odd Visitante_10"],
        "Favoritismo PackBall": merged["Favoritismo PackBall_10"].fillna(merged["Favoritismo PackBall_20"]),
        "CV Casa": merged["_cv_home"],
        "CV Visitante": merged["_cv_away"],
        "CV Media": merged["_cv_average"],
        "w10": merged["_w10"],
        "w20": merged["_w20"],
    })
    blend_names = [
        "Vitoria Casa", "Vitoria Visitante", "Empate Casa", "Empate Visitante", "Derrota Casa",
        "Derrota Visitante", "Marcou Primeiro Casa", "Marcou Primeiro Visitante", "Media Marcados Casa",
        "Media Marcados Visitante", "Media Sofridos Casa", "Media Sofridos Visitante", "Media Gols Liga",
        "Expectativa Gols", "Forca Ataque Casa", "Forca Ataque Visitante", "Forca Defesa Casa",
        "Forca Defesa Visitante", "PPG Casa", "PPG Visitante", "Primeiro e Vence Casa",
        "Primeiro e Vence Visitante", "Clean Sheet Casa", "Clean Sheet Visitante", "Sem Marcar Casa",
        "Sem Marcar Visitante", "Precisao Chutes Casa", "Precisao Chutes Visitante", "Chutes Casa",
        "Chutes Visitante", "Classificacao Casa", "Classificacao Visitante",
    ]
    for name in blend_names:
        base[name] = blend_optional(merged, name)
    base = calculate_no_vig_probabilities(base)
    base = build_lambdas(base)
    base = simulate_outcome_probabilities(base)
    base = build_empirical_probabilities(base)
    return finalize_probabilities(base)


def build_predictions(base: pd.DataFrame) -> pd.DataFrame:
    rows = [prediction for _, row in base.iterrows() if (prediction := _build_prediction(row)) is not None]
    if not rows:
        return pd.DataFrame(columns=PREDICTION_COLUMNS)
    return pd.DataFrame(rows, columns=PREDICTION_COLUMNS).sort_values(["data", "hora", "liga", "jogo"]).reset_index(drop=True)


def build_diagnostic_funnel(base: pd.DataFrame) -> tuple[dict, str]:
    counts = {
        "confrontos": len(base),
        "odds_pareadas": 0,
        "favorito_packball_valido": 0,
        "faixa_odd_e_gap": 0,
        "cv_aprovado": 0,
        "probabilidade_aprovada": 0,
        "edge_aprovado": 0,
        "candidatos_back": 0,
    }
    candidates = []
    for _, row in base.iterrows():
        if not bool(row.get("Odds Pareadas")):
            continue
        counts["odds_pareadas"] += 1
        side = "Casa" if float(row["Odd Casa"]) < float(row["Odd Visitante"]) else "Visitante"
        opponent = "Visitante" if side == "Casa" else "Casa"
        packball_value = row.get("Favoritismo PackBall")
        packball_side = favorite_side_from_code(packball_value, row["Odd Casa"], row["Odd Visitante"])
        packball_class = favorite_class_from_code(packball_value, row["Odd Casa"], row["Odd Visitante"])
        policy = favorite_publication_policy(packball_class)
        if policy is None or packball_side != side:
            continue
        counts["favorito_packball_valido"] += 1
        odd = float(row[f"Odd {side}"])
        min_odd, max_odd, min_probability, base_edge = policy
        if not (min_odd <= odd <= max_odd) or float(row[f"Odd {opponent}"]) - odd < MIN_FAVORITE_ODDS_GAP:
            continue
        counts["faixa_odd_e_gap"] += 1
        cv_home, cv_away = float(row["CV Casa"]), float(row["CV Visitante"])
        cv_average = (cv_home + cv_away) / 2.0
        if min(cv_home, cv_away) < MIN_CV_INDIVIDUAL or cv_average < MIN_CV_AVERAGE:
            continue
        counts["cv_aprovado"] += 1
        probability, _ = calibrate_moneyline_probability(float(row[f"Prob Final {side}"]))
        edge = odd * probability - 100.0
        spread = float(row[f"Spread {side}"])
        required_edge = base_edge + min(2.0, max(0.0, 55.0 - cv_average) * 0.08 + max(0.0, spread - 15.0) * 0.05)
        candidates.append({
            "jogo": f"{row['Time Casa']} vs {row['Time Visitante']}",
            "lado": side,
            "classe_packball": packball_class,
            "odd": round(odd, 2),
            "probabilidade": round(probability, 2),
            "edge": round(edge, 2),
            "edge_exigido": round(required_edge, 2),
            "cv_medio": round(cv_average, 2),
        })
        if probability < min_probability:
            continue
        counts["probabilidade_aprovada"] += 1
        counts["candidatos_back"] += 1
        if edge < required_edge:
            continue
        counts["edge_aprovado"] += 1
    candidates.sort(key=lambda item: item["edge"], reverse=True)
    diagnostic = {**counts, "top_candidatos_antes_prob_edge": candidates[:8]}
    lines = [
        "Funil BackMatrix:",
        " | ".join(f"{key}={value}" for key, value in counts.items()),
    ]
    if candidates:
        lines.append("Melhores candidatos antes dos cortes finais:")
        for item in candidates[:8]:
            lines.append(
                f"- {item['jogo']} | {item['lado']} | {item['classe_packball']} | odd {item['odd']:.2f} | "
                f"prob {item['probabilidade']:.2f}% | edge {item['edge']:.2f}% "
                f"(mín. {item['edge_exigido']:.2f}%) | CV médio {item['cv_medio']:.2f}%"
            )
    return diagnostic, "\n".join(lines)


def build_walk_forward_rows(records: list[dict]) -> list[dict]:
    generated_at = RUN_PROVENANCE.get("generated_at")
    rows = []
    for record in records:
        kickoff = pd.to_datetime(f"{record.get('data')} {record.get('hora')}", dayfirst=True, errors="coerce")
        if pd.notna(kickoff):
            kickoff = kickoff.tz_localize(ZoneInfo("America/Sao_Paulo")).isoformat()
        rows.append({
            "prediction_at": generated_at,
            "kickoff": kickoff,
            "model_version": MODEL_VERSION,
            "league": record.get("liga"),
            "market_type": "moneyline",
            "game": record.get("jogo"),
            "selection": record.get("pick"),
            "probability": float(record.get("probabilidade_final")) / 100.0,
            "odd": record.get("odd_ofertada"),
            "outcome": None,
        })
    return rows


def _clean_json(value):
    if isinstance(value, dict):
        return {key: _clean_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clean_json(item) for item in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, (np.integer, np.floating)):
        return _clean_json(value.item())
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return value


def _records(frame: pd.DataFrame) -> list[dict]:
    return [_clean_json(record) for record in frame.to_dict(orient="records")]


def run_model(csv10: Path, csv20: Path, output_path: Path, prediction_date: str, run_mode: str) -> dict:
    if run_mode not in STATUSES_BY_MODE:
        raise ValueError(f"RUN_MODE_INVALIDO:{run_mode}")
    recent = load_source(csv10, "10j")
    venue = load_source(csv20, "20j")
    validate_window_profile(recent, 10, "recent10")
    validate_window_profile(venue, 20, "venue20")
    statuses = STATUSES_BY_MODE[run_mode]
    recent_filtered = filter_by_status_and_games(recent, statuses, 10)
    venue_filtered = filter_by_status_and_games(venue, statuses, 20)
    merged = merge_windows(recent_filtered, venue_filtered)
    logging.info("RUN_MODE=%s | 10j=%s | 20j=%s | merged=%s", run_mode, len(recent_filtered), len(venue_filtered), len(merged))

    base = build_base(merged) if not merged.empty else pd.DataFrame()
    predictions = build_predictions(base) if not base.empty else pd.DataFrame()
    diagnostic, diagnostic_text = build_diagnostic_funnel(base) if not base.empty else ({"confrontos": 0}, "Funil BackMatrix vazio.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    predictions.to_csv(output_path, index=False, encoding="utf-8-sig")
    records = _records(predictions)
    snapshot_path = output_path.with_suffix(".snapshot.json")
    snapshot = {
        **RUN_PROVENANCE,
        "predictions": records,
        "walk_forward_rows": build_walk_forward_rows(records),
    }
    snapshot_path.write_text(json.dumps(_clean_json(snapshot), ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "ok": True,
        "modelo": MODEL_NAME,
        "arquivo_saida": str(output_path),
        "arquivo_contexto": None,
        "arquivo_snapshot": str(snapshot_path),
        "provenance": RUN_PROVENANCE,
        "total_confrontos_cruzados": len(merged),
        "total_prognosticos": len(records),
        "diagnostico_funil": diagnostic,
        "contexto_modelo": f"{MODEL_NAME} {MODEL_VERSION} | confrontos={len(merged)} | prognosticos={len(records)}\n{diagnostic_text}",
        "dados_tecnicos": "\n\n".join(str(record.get("dados_tecnicos") or "") for record in records[:20]) or diagnostic_text,
        "prognosticos": records,
    }


def run_cli() -> None:
    if len(sys.argv) < 5:
        print(json.dumps({"ok": False, "erro": "Uso: runner CSV_10 CSV_20 OUTPUT [DD-MM-YYYY] [prognostico|backtest]"}, ensure_ascii=False))
        return
    csv10, csv20, output_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    prediction_date = sys.argv[4]
    run_mode = sys.argv[5].strip().lower() if len(sys.argv) >= 6 else "prognostico"
    if not csv10.exists() or not csv20.exists():
        print(json.dumps({"ok": False, "erro": "Arquivos BackMatrix não encontrados."}, ensure_ascii=False))
        return
    preview = pd.read_csv(csv10, sep=sniff_sep(csv10), encoding="utf-8-sig", nrows=1)
    RUN_PROVENANCE.clear()
    RUN_PROVENANCE.update({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "PackBall external CSV import",
        "market_odds_profile": "average odds from 1 to 5 bookmakers; bookmaker count unavailable per match",
        "source_file_10": csv10.name,
        "source_file_20": csv20.name,
        "sha256_10": file_sha256(csv10),
        "sha256_20": file_sha256(csv20),
        "schema_hash": schema_sha256(preview.columns),
        "model_version": MODEL_VERSION,
        "prediction_date": prediction_date,
        "run_mode": run_mode,
        "kickoff_timezone": "America/Sao_Paulo",
        "recent_profile": "10 jogos, todos os mandos e ligas, sem temporada anterior",
        "venue_profile": "20 jogos, mandante em casa e visitante fora, todas as ligas, com temporada anterior",
    })
    try:
        payload = run_model(csv10, csv20, output_path, prediction_date, run_mode)
    except Exception as exc:
        logging.exception("Falha no BackMatrix")
        payload = {"ok": False, "erro": str(exc)}
    print(json.dumps(_clean_json(payload), ensure_ascii=False))


if __name__ == "__main__":
    run_cli()
