import sys
import json
import math
import os
import re
import importlib.util
import contextlib
import io
import unicodedata
from pathlib import Path

import pandas as pd

from football_adapter import converter_csv_longo_para_wide


BASE_DIR = Path(os.environ.get("ASP_SCRAPER_BASE_DIR", "/home/ubuntu/asp-scraper-api"))
MODELOS_DIR = BASE_DIR / "modelos"
REAL_MODEL_PATH = MODELOS_DIR / "prognosticos_football_real.py"

MODEL_VERSION = "FOOTBALL_V1_1"
FOOTBALL_STAT_AUDIT_VERSION = "FOOTBALL_V1_1_B"
HANDICAP_ENABLED_FOOTBALL_V1_1 = True
HANDICAP_ASIAN_ENABLED_FOOTBALL_V1_1 = True
HANDICAP_EUROPEAN_ENABLED_FOOTBALL_V1_1 = False
HANDICAP_QUARTER_LINES_ENABLED_FOOTBALL_V1_1 = False
HANDICAP_AMBIGUOUS_BLOCKED_FOOTBALL_V1_1 = True
MIN_ODD_FOOTBALL_V1_1 = 1.25
MAX_ODD_FOOTBALL_V1_1 = 2.00
OVERCONFIDENCE_CUTOFF_PCT = 70.0
MIN_EDGE_FOOTBALL_V1_1 = 0.03
LOW_SAMPLE_MIN_EDGE_FOOTBALL_V1_1 = 0.05
PRIOR_PROBABILITY = 0.50
PRIOR_STRENGTH = 10.0
SHRINKAGE_K_FOOTBALL_V1_1 = 10.0
SCORE_MATRIX_TAIL_LIMIT = 0.005
SCORE_MATRIX_MIN_MAX_GOALS = 10
SCORE_MATRIX_MAX_CAP = 15
FOOTBALL_NBD_ENABLED_V1_1 = False
N_SIMULATIONS_FOOTBALL_V1_1 = 0

LAST_V1_1_DISCARDED = pd.DataFrame()


def _to_float(value, default=None):
    try:
        if pd.isna(value):
            return default
        if isinstance(value, str):
            value = value.strip().replace(",", ".")
            if not value:
                return default
        result = float(value)
        if math.isnan(result) or math.isinf(result):
            return default
        return result
    except Exception:
        return default


def _norm_text(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip().lower()


def _comparable_context_text(value) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _valid_odd(value) -> bool:
    odd = _to_float(value)
    return odd is not None and odd > 1.0


def implied_probability(odd: float) -> float:
    odd = _to_float(odd)
    if odd is None or odd <= 1.0:
        raise ValueError(f"Odd invalida para probabilidade implicita: {odd}")
    return 1.0 / odd


def no_vig_probability_pair(odd_a: float, odd_b: float) -> tuple[float, float]:
    pa = implied_probability(odd_a)
    pb = implied_probability(odd_b)
    total = pa + pb
    if total <= 0:
        raise ValueError("Par no-vig invalido.")
    return pa / total, pb / total


def no_vig_probability_three(odd_a: float, odd_b: float, odd_c: float) -> tuple[float, float, float]:
    pa = implied_probability(odd_a)
    pb = implied_probability(odd_b)
    pc = implied_probability(odd_c)
    total = pa + pb + pc
    if total <= 0:
        raise ValueError("Mercado 1X2 no-vig invalido.")
    return pa / total, pb / total, pc / total


def apply_shrinkage(prob_observed: float, n: int, prior: float = PRIOR_PROBABILITY, prior_strength: float = PRIOR_STRENGTH) -> float:
    prob_observed = _to_float(prob_observed)
    if prob_observed is None or not 0 <= prob_observed <= 1:
        raise ValueError("prob_observed deve estar entre 0 e 1.")
    if n < 0:
        raise ValueError("n nao pode ser negativo.")
    return ((prob_observed * n) + (prior * prior_strength)) / (n + prior_strength)


def shrink_value(observed: float, sample: int, prior: float, k: float = SHRINKAGE_K_FOOTBALL_V1_1) -> float:
    observed = _to_float(observed)
    prior = _to_float(prior)
    if observed is None or prior is None:
        raise ValueError("Valores invalidos para shrinkage.")
    if sample < 0:
        raise ValueError("sample nao pode ser negativo.")
    return ((sample * observed) + (k * prior)) / (sample + k)


def poisson_pmf(lambda_value: float, max_goals: int) -> list[float]:
    lambda_value = _to_float(lambda_value)
    if lambda_value is None or lambda_value < 0:
        raise ValueError("lambda invalido para Poisson.")
    if max_goals < 0:
        raise ValueError("max_goals invalido.")
    return [
        math.exp(-lambda_value) * (lambda_value ** goals) / math.factorial(goals)
        for goals in range(max_goals + 1)
    ]


def dynamic_score_matrix_max_goals(lambda_home: float, lambda_away: float, tail_limit: float = SCORE_MATRIX_TAIL_LIMIT) -> int:
    max_goals = SCORE_MATRIX_MIN_MAX_GOALS
    while max_goals < SCORE_MATRIX_MAX_CAP:
        home_mass = sum(poisson_pmf(lambda_home, max_goals))
        away_mass = sum(poisson_pmf(lambda_away, max_goals))
        tail_mass = 1.0 - (home_mass * away_mass)
        if tail_mass <= tail_limit:
            return max_goals
        max_goals += 1
    return max_goals


def build_score_matrix(lambda_home: float, lambda_away: float, max_goals: int | None = None) -> dict:
    if max_goals is None:
        max_goals = dynamic_score_matrix_max_goals(lambda_home, lambda_away)

    home_pmf = poisson_pmf(lambda_home, max_goals)
    away_pmf = poisson_pmf(lambda_away, max_goals)
    matrix = []
    for home_goals, ph in enumerate(home_pmf):
        row = []
        for away_goals, pa in enumerate(away_pmf):
            row.append(ph * pa)
        matrix.append(row)

    covered_mass = sum(sum(row) for row in matrix)
    tail_mass = max(0.0, 1.0 - covered_mass)
    normalized = False
    if covered_mass > 0 and abs(covered_mass - 1.0) > 1e-12:
        matrix = [[cell / covered_mass for cell in row] for row in matrix]
        normalized = True

    return {
        "matrix": matrix,
        "max_goals": max_goals,
        "covered_mass": covered_mass,
        "tail_mass": tail_mass,
        "normalized": normalized,
        "probability_sum": sum(sum(row) for row in matrix),
    }


def score_matrix_probabilities(score_matrix: dict, line: float = 2.5) -> dict:
    matrix = score_matrix["matrix"]
    home = draw = away = over = under = btts_yes = 0.0

    for home_goals, row in enumerate(matrix):
        for away_goals, prob in enumerate(row):
            total = home_goals + away_goals
            if home_goals > away_goals:
                home += prob
            elif home_goals == away_goals:
                draw += prob
            else:
                away += prob

            if total > line:
                over += prob
            else:
                under += prob

            if home_goals > 0 and away_goals > 0:
                btts_yes += prob

    return {
        "home": home,
        "draw": draw,
        "away": away,
        "over": over,
        "under": under,
        "btts_yes": btts_yes,
        "btts_no": 1.0 - btts_yes,
        "double_chance_1x": home + draw,
        "double_chance_x2": draw + away,
        "double_chance_12": home + away,
    }


def score_matrix_handicap_probability(score_matrix: dict, side: str, line: float) -> dict:
    matrix = score_matrix["matrix"]
    prob_win = prob_push = prob_loss = 0.0

    for home_goals, row in enumerate(matrix):
        for away_goals, prob in enumerate(row):
            goal_diff = home_goals - away_goals if side == "home" else away_goals - home_goals
            outcome = handicap_outcome(goal_diff, line)
            if outcome == "win":
                prob_win += prob
            elif outcome == "push":
                prob_push += prob
            else:
                prob_loss += prob

    return {
        "prob_win": prob_win,
        "prob_push": prob_push,
        "prob_loss": prob_loss,
    }


def _line_to_float(value):
    if value is None:
        return None
    match = re.search(r"[-+]?\d+(?:[.,]\d+)?", str(value))
    if not match:
        return None
    return _to_float(match.group(0))


def _is_supported_half_line(line: float | None) -> bool:
    if line is None:
        return False
    doubled = line * 2
    return abs(doubled - round(doubled)) < 1e-9


def _is_half_handicap_line(line: float | None) -> bool:
    if line is None:
        return False
    return abs(line - math.trunc(line) - 0.5) < 1e-9 or abs(line - math.trunc(line) + 0.5) < 1e-9


def _is_integer_line(line: float | None) -> bool:
    if line is None:
        return False
    return abs(line - round(line)) < 1e-9


def _is_quarter_line(line: float | None) -> bool:
    if line is None:
        return False
    quarter = abs(line * 4 - round(line * 4)) < 1e-9
    half_or_integer = abs(line * 2 - round(line * 2)) < 1e-9
    return quarter and not half_or_integer


def handicap_outcome(goal_diff: int | float, handicap: float) -> str:
    adjusted = float(goal_diff) + float(handicap)
    if adjusted > 0:
        return "win"
    if adjusted < 0:
        return "loss"
    return "push"


def calculate_handicap_ev(prob_win: float, prob_push: float, offered_odd: float) -> float:
    prob_win = _to_float(prob_win)
    prob_push = _to_float(prob_push, 0.0)
    offered_odd = _to_float(offered_odd)
    if prob_win is None or offered_odd is None or offered_odd <= 1:
        raise ValueError("Parametros invalidos para EV de handicap.")
    if prob_push is None:
        prob_push = 0.0
    if prob_win < 0 or prob_push < 0 or prob_win + prob_push > 1:
        raise ValueError("Probabilidades invalidas para EV de handicap.")
    prob_loss = 1.0 - prob_win - prob_push
    return prob_win * (offered_odd - 1.0) - prob_loss


def _line_key(line: float) -> str:
    return f"{line:.1f}".replace(".", "_")


def _match_wide_row(df_wide: pd.DataFrame, row: pd.Series):
    if df_wide.empty:
        return None

    mandante = _norm_text(row.get("mandante"))
    visitante = _norm_text(row.get("visitante"))
    home_col = df_wide["home"] if "home" in df_wide.columns else pd.Series([""] * len(df_wide), index=df_wide.index)
    away_col = df_wide["away"] if "away" in df_wide.columns else pd.Series([""] * len(df_wide), index=df_wide.index)

    mask = (
        home_col.map(_norm_text).eq(mandante)
        & away_col.map(_norm_text).eq(visitante)
    )
    matches = df_wide.loc[mask]
    if matches.empty:
        jogo = _norm_text(row.get("jogo"))
        if jogo:
            mask = home_col.map(_norm_text).apply(lambda h: bool(h) and h in jogo) & away_col.map(_norm_text).apply(lambda a: bool(a) and a in jogo)
            matches = df_wide.loc[mask]

    if matches.empty:
        return None
    return matches.iloc[0]


def _classify_market(row: pd.Series) -> str:
    mercado = _norm_text(row.get("mercado"))
    pick = _norm_text(row.get("pick"))

    if "handicap" in mercado:
        return "handicap"
    if "total" in mercado or "gols" in mercado or pick.startswith("over") or pick.startswith("under"):
        return "total_goals"
    if "ambas" in mercado or "btts" in mercado:
        return "btts"
    if "dupla" in mercado or "double" in mercado:
        return "double_chance"
    if "resultado" in mercado or "1x2" in mercado or "moneyline" in mercado:
        return "1x2"
    return "unknown"


def _pick_side_1x2(row: pd.Series) -> str | None:
    pick = _norm_text(row.get("pick"))
    mandante = _norm_text(row.get("mandante"))
    visitante = _norm_text(row.get("visitante"))
    if "empate" in pick or pick == "x" or "draw" in pick:
        return "draw"
    if mandante and mandante in pick:
        return "home"
    if visitante and visitante in pick:
        return "away"
    return None


def _pick_side_total(row: pd.Series) -> str | None:
    pick = _norm_text(row.get("pick"))
    if "over" in pick:
        return "over"
    if "under" in pick:
        return "under"
    return None


def _pick_side_btts(row: pd.Series) -> str | None:
    pick = _norm_text(row.get("pick"))
    if "sim" in pick or "yes" in pick:
        return "yes"
    if "nao" in pick or "não" in pick or "no" in pick:
        return "no"
    return None


def _pick_side_double_chance(row: pd.Series) -> str | None:
    pick = str(row.get("pick", "")).upper().replace(" ", "")
    if "1X" in pick:
        return "1X"
    if "X2" in pick:
        return "X2"
    if "12" in pick:
        return "12"
    return None


def _pick_side_handicap(row: pd.Series) -> str | None:
    pick = _norm_text(row.get("pick"))
    mandante = _norm_text(row.get("mandante"))
    visitante = _norm_text(row.get("visitante"))
    if mandante and mandante in pick:
        return "home"
    if visitante and visitante in pick:
        return "away"
    return None


def _find_asian_handicap_pair(wide_row, line: float, side: str):
    for idx in range(1, 20):
        home_line_col = f"odds_Asian_handicap_Full_Time_Linha{idx}_HANDICAP"
        home_odd_col = f"odds_Asian_handicap_Full_Time_Linha{idx}_1"
        away_line_col = f"odds_Asian_handicap_Full_Time_Linha{idx}_Opp_HANDICAP"
        away_odd_col = f"odds_Asian_handicap_Full_Time_Linha{idx}_Opp_Odd"

        home_line = _to_float(wide_row.get(home_line_col))
        away_line = _to_float(wide_row.get(away_line_col))
        home_odd = _to_float(wide_row.get(home_odd_col))
        away_odd = _to_float(wide_row.get(away_odd_col))

        if home_line is None or away_line is None or home_odd is None or away_odd is None:
            continue

        if abs(home_line + away_line) > 1e-9:
            continue

        if side == "home" and abs(home_line - line) < 1e-9:
            return home_odd, away_odd
        if side == "away" and abs(away_line - line) < 1e-9:
            return away_odd, home_odd

    return None


def _append_reason(parts: list[str], label: str, value) -> None:
    if value is not None and value != "":
        parts.append(f"{label}={value}")


def _extract_note_value(text: str, key: str):
    if not isinstance(text, str):
        return None
    marker = f"{key}="
    if marker not in text:
        return None
    return text.split(marker, 1)[1].split(";", 1)[0].split("|", 1)[0].strip()


def _extract_core_stat_debug(row: pd.Series) -> dict:
    observacoes = str(row.get("observacoes", "") or "")
    return {
        "lambda_home_raw": _extract_note_value(observacoes, "core_lambda_home"),
        "lambda_away_raw": _extract_note_value(observacoes, "core_lambda_away"),
        "lambda_home_final": _extract_note_value(observacoes, "core_lambda_home"),
        "lambda_away_final": _extract_note_value(observacoes, "core_lambda_away"),
        "league_avg_home_goals": _extract_note_value(observacoes, "league_avg_home_goals"),
        "league_avg_away_goals": _extract_note_value(observacoes, "league_avg_away_goals"),
        "sample_home": _extract_note_value(observacoes, "sample_home"),
        "sample_away": _extract_note_value(observacoes, "sample_away"),
        "sample_league": _extract_note_value(observacoes, "sample_league"),
        "shrinkage_k": _extract_note_value(observacoes, "shrinkage_k"),
        "score_matrix_max_goals": _extract_note_value(observacoes, "score_matrix_max_goals"),
        "score_matrix_tail_mass": _extract_note_value(observacoes, "score_matrix_tail_mass"),
        "score_matrix_probability_sum": _extract_note_value(observacoes, "score_matrix_probability_sum"),
        "nbd_enabled": _extract_note_value(observacoes, "nbd_enabled"),
        "overdispersion_ratio": _extract_note_value(observacoes, "overdispersion_ratio"),
    }


def _build_v1_1_note(debug: dict) -> str:
    parts = [f"modelo_versao={MODEL_VERSION}"]
    for key in (
        "football_stat_audit_version",
        "mercado_tipo",
        "lambda_home_raw",
        "lambda_away_raw",
        "lambda_home_final",
        "lambda_away_final",
        "league_avg_home_goals",
        "league_avg_away_goals",
        "sample_home",
        "sample_away",
        "sample_league",
        "poisson_enabled",
        "nbd_evaluated",
        "nbd_enabled",
        "overdispersion_ratio",
        "score_matrix_max_goals",
        "score_matrix_tail_mass",
        "score_matrix_probability_sum",
        "simulation_enabled",
        "n_simulations",
        "prob_original",
        "prob_hist",
        "prob_no_vig",
        "prob_final",
        "odd_justa",
        "odd_ofertada",
        "edge",
        "edge_formula",
        "min_edge_required",
        "sample_size",
        "prior",
        "prior_strength",
        "shrinkage_aplicado",
        "warnings",
        "discard_reason",
    ):
        _append_reason(parts, key, debug.get(key))
    return " | ".join(parts)


def _blend_conservative(prob_original: float, prob_no_vig: float, prob_hist: float = PRIOR_PROBABILITY) -> float:
    return (prob_hist * 0.35) + (prob_original * 0.35) + (prob_no_vig * 0.30)


def _minimum_edge_required(market_type: str, warnings: list[str]) -> float:
    if "NEUTRAL_FALLBACK_NO_HISTORY" in warnings or "LOW_SAMPLE" in warnings:
        return LOW_SAMPLE_MIN_EDGE_FOOTBALL_V1_1
    if market_type in {"handicap", "total_goals", "btts"}:
        return MIN_EDGE_FOOTBALL_V1_1
    return MIN_EDGE_FOOTBALL_V1_1


def _overconfidence_decision(market_type: str, row: pd.Series, prob_final_pct: float, warnings: list[str]) -> str | None:
    if prob_final_pct < OVERCONFIDENCE_CUTOFF_PCT:
        return None

    line = _line_to_float(row.get("linha"))
    naturally_high = (
        market_type == "double_chance"
        or (market_type == "total_goals" and line is not None and line <= 0.5)
    )

    warnings.append("HIGH_PROBABILITY_REVIEW_FOOTBALL_V1_1")
    if naturally_high:
        return None

    if market_type in {"1x2", "handicap"}:
        return "OVERCONFIDENCE_CAP_FOOTBALL_V1_1"

    if "NEUTRAL_FALLBACK_NO_HISTORY" in warnings:
        return "OVERCONFIDENCE_LOW_SAMPLE_FOOTBALL_V1_1"

    return None


def _base_stat_audit_debug(market_type: str) -> dict:
    return {
        "football_stat_audit_version": FOOTBALL_STAT_AUDIT_VERSION,
        "lambda_home_raw": "unavailable_not_calculated_by_core",
        "lambda_away_raw": "unavailable_not_calculated_by_core",
        "lambda_home_final": "unavailable_not_calculated_by_core",
        "lambda_away_final": "unavailable_not_calculated_by_core",
        "poisson_enabled": True,
        "nbd_evaluated": True,
        "nbd_enabled": FOOTBALL_NBD_ENABLED_V1_1,
        "overdispersion_ratio": "unavailable_not_calculated_by_core",
        "score_matrix_max_goals": "dynamic_in_real_model",
        "score_matrix_tail_mass": "unavailable_not_calculated_by_core",
        "score_matrix_probability_sum": "unavailable_not_calculated_by_core",
        "simulation_enabled": False,
        "n_simulations": N_SIMULATIONS_FOOTBALL_V1_1,
        "mercado_tipo": market_type,
    }


def _evaluate_row_v1_1(row: pd.Series, wide_row) -> tuple[dict | None, dict | None]:
    market_type = _classify_market(row)
    offered_odd = _to_float(row.get("odd_ofertada"))
    original_prob_pct = _to_float(row.get("probabilidade_final"))
    original_prob = (original_prob_pct / 100.0) if original_prob_pct is not None else None
    warnings = []
    discard_reason = None
    sample_size = 0
    prob_hist = apply_shrinkage(PRIOR_PROBABILITY, sample_size)
    prob_no_vig = None
    debug = {
        **_base_stat_audit_debug(market_type),
        "prob_original": None if original_prob is None else round(original_prob, 4),
        "prob_hist": round(prob_hist, 4),
        "sample_size": sample_size,
        "prior": PRIOR_PROBABILITY,
        "prior_strength": PRIOR_STRENGTH,
        "shrinkage_aplicado": True,
    }
    core_debug = {k: v for k, v in _extract_core_stat_debug(row).items() if v not in (None, "")}
    debug.update(core_debug)

    if market_type == "handicap" and not HANDICAP_ENABLED_FOOTBALL_V1_1:
        discard_reason = "HANDICAP_BLOCKED_FOOTBALL_V1_1"
    elif market_type == "unknown":
        discard_reason = "UNSUPPORTED_MARKET_FOOTBALL_V1_1"
    elif wide_row is None:
        discard_reason = "NO_MARKET_BASELINE"
    elif not _valid_odd(offered_odd):
        discard_reason = "INVALID_ODDS"
    elif original_prob is None or not 0 < original_prob < 1:
        discard_reason = "INVALID_PROBABILITY"

    if discard_reason is None:
        try:
            if market_type == "1x2":
                p_home, p_draw, p_away = no_vig_probability_three(
                    wide_row.get("odds_1X2_Full_Time_1"),
                    wide_row.get("odds_1X2_Full_Time_X"),
                    wide_row.get("odds_1X2_Full_Time_2"),
                )
                side = _pick_side_1x2(row)
                prob_no_vig = {"home": p_home, "draw": p_draw, "away": p_away}.get(side)
                if prob_no_vig is None:
                    discard_reason = "INVALID_PICK_1X2"

            elif market_type == "double_chance":
                p_home, p_draw, p_away = no_vig_probability_three(
                    wide_row.get("odds_1X2_Full_Time_1"),
                    wide_row.get("odds_1X2_Full_Time_X"),
                    wide_row.get("odds_1X2_Full_Time_2"),
                )
                side = _pick_side_double_chance(row)
                prob_no_vig = {"1X": p_home + p_draw, "12": p_home + p_away, "X2": p_draw + p_away}.get(side)
                if prob_no_vig is None:
                    discard_reason = "INVALID_PICK_DOUBLE_CHANCE"

            elif market_type == "total_goals":
                line = _line_to_float(row.get("linha"))
                if not _is_supported_half_line(line):
                    discard_reason = "UNSUPPORTED_TOTAL_LINE"
                else:
                    key = _line_key(line)
                    over_odd = wide_row.get(f"odds_OverUnder_Full_Time_{key}_Over")
                    under_odd = wide_row.get(f"odds_OverUnder_Full_Time_{key}_Under")
                    p_over, p_under = no_vig_probability_pair(over_odd, under_odd)
                    side = _pick_side_total(row)
                    prob_no_vig = {"over": p_over, "under": p_under}.get(side)
                    if prob_no_vig is None:
                        discard_reason = "INVALID_PICK_TOTALS"
                    warnings.append("NEUTRAL_FALLBACK_NO_HISTORY")

            elif market_type == "btts":
                p_yes, p_no = no_vig_probability_pair(
                    wide_row.get("odds_Both_teams_to_score_Full_Time_YES"),
                    wide_row.get("odds_Both_teams_to_score_Full_Time_NO"),
                )
                side = _pick_side_btts(row)
                prob_no_vig = {"yes": p_yes, "no": p_no}.get(side)
                if prob_no_vig is None:
                    discard_reason = "INVALID_PICK_BTTS"
                warnings.append("NEUTRAL_FALLBACK_NO_HISTORY")

            elif market_type == "handicap":
                mercado_text = _norm_text(row.get("mercado"))
                if "europe" in mercado_text or "europeu" in mercado_text or "3 vias" in mercado_text:
                    discard_reason = "HANDICAP_EUROPEAN_BLOCKED_FOOTBALL_V1_1"
                elif not HANDICAP_ASIAN_ENABLED_FOOTBALL_V1_1:
                    discard_reason = "HANDICAP_ASIAN_BLOCKED_FOOTBALL_V1_1"
                else:
                    line = _line_to_float(row.get("linha"))
                    side = _pick_side_handicap(row)

                    if side is None:
                        discard_reason = "HANDICAP_AMBIGUOUS_BLOCKED_FOOTBALL_V1_1"
                    elif _is_quarter_line(line):
                        discard_reason = "HANDICAP_QUARTER_LINE_BLOCKED_FOOTBALL_V1_1"
                    elif _is_integer_line(line):
                        discard_reason = "HANDICAP_PUSH_PROBABILITY_UNAVAILABLE"
                    elif not _is_half_handicap_line(line):
                        discard_reason = "HANDICAP_LINE_UNSUPPORTED_FOOTBALL_V1_1"
                    else:
                        pair = _find_asian_handicap_pair(wide_row, line, side)
                        if pair is None:
                            discard_reason = "HANDICAP_NO_PAIRED_ODDS"
                        else:
                            selected_odd, opposite_odd = pair
                            prob_no_vig, _ = no_vig_probability_pair(selected_odd, opposite_odd)
                            warnings.append("HANDICAP_ASIAN_HALF_LINE_ONLY")
                            warnings.append("NEUTRAL_FALLBACK_NO_HISTORY")
        except Exception:
            discard_reason = "NO_MARKET_BASELINE"

    debug["prob_no_vig"] = None if prob_no_vig is None else round(prob_no_vig, 4)

    if discard_reason is None:
        prob_final = _blend_conservative(original_prob, prob_no_vig, prob_hist)
        prob_final_pct = prob_final * 100.0
        fair_odd = (1.0 / prob_final) if prob_final > 0 else None
        if market_type == "handicap":
            edge_decimal = calculate_handicap_ev(prob_final, 0.0, offered_odd)
            edge_decimal_override = edge_decimal
        else:
            edge_decimal = (offered_odd * prob_final) - 1.0
        min_edge_required = _minimum_edge_required(market_type, warnings)

        debug.update({
            "prob_final": round(prob_final, 4),
            "odd_justa": None if fair_odd is None else round(fair_odd, 4),
            "odd_ofertada": offered_odd,
            "edge": round(edge_decimal, 4),
            "edge_formula": "prob_win*(odd-1)-prob_loss" if market_type == "handicap" else "odd*prob-1",
            "min_edge_required": min_edge_required,
        })

        if offered_odd < MIN_ODD_FOOTBALL_V1_1 or offered_odd > MAX_ODD_FOOTBALL_V1_1:
            discard_reason = "ODD_OUT_OF_RANGE"
        else:
            overconfidence_reason = _overconfidence_decision(market_type, row, prob_final_pct, warnings)
            if overconfidence_reason:
                discard_reason = overconfidence_reason
            elif edge_decimal <= 0:
                discard_reason = "NEGATIVE_EDGE_AFTER_V1_1"
            elif edge_decimal < min_edge_required:
                discard_reason = (
                    "LOW_SAMPLE_REQUIRES_HIGHER_EDGE"
                    if min_edge_required > MIN_EDGE_FOOTBALL_V1_1
                    else "EDGE_BELOW_MINIMUM_FOOTBALL_V1_1"
                )
            else:
                selected = row.to_dict()
                selected["probabilidade_final"] = round(prob_final_pct, 2)
                selected["odd_valor"] = round(fair_odd, 2)
                selected["edge"] = round(edge_decimal * 100.0, 2)
                note = _build_v1_1_note({**debug, "warnings": ",".join(warnings)})
                selected["observacoes"] = "; ".join([str(selected.get("observacoes") or "").strip(), note]).strip("; ")
                selected["dados_tecnicos"] = "; ".join([str(selected.get("dados_tecnicos") or "").strip(), note]).strip("; ")
                selected["contexto_modelo"] = "; ".join([str(selected.get("contexto_modelo") or "").strip(), note]).strip("; ")
                selected["modelo_versao"] = MODEL_VERSION
                return selected, None

    debug["warnings"] = ",".join(warnings)
    debug["discard_reason"] = discard_reason or "V1_1_FILTERED"
    discarded = row.to_dict()
    discarded["modelo_versao"] = MODEL_VERSION
    discarded["motivo_descarte_v1_1"] = debug["discard_reason"]
    discarded["debug_v1_1"] = _build_v1_1_note(debug)
    return None, discarded


def aplicar_controles_football_v1_1(df_saida: pd.DataFrame, df_wide: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    selected = []
    discarded = []

    for _, row in df_saida.iterrows():
        wide_row = _match_wide_row(df_wide, row)
        keep, drop = _evaluate_row_v1_1(row, wide_row)
        if keep is not None:
            selected.append(keep)
        if drop is not None:
            discarded.append(drop)

    selected_df = pd.DataFrame(selected)
    discarded_df = pd.DataFrame(discarded)
    return selected_df, discarded_df


def limpar_json_nan(obj):
    if isinstance(obj, dict):
        return {k: limpar_json_nan(v) for k, v in obj.items()}

    if isinstance(obj, list):
        return [limpar_json_nan(v) for v in obj]

    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj

    return obj


def limpar_contexto_modelo(texto: str) -> str:
    """
    Mantém apenas o bloco técnico útil para a Validação Crítica:
    - Confronto
    - Probabilidades Moneyline
    - Data/Horário
    - Rodada Atual
    - H2H
    - Últimos 5 jogos no local
    - Dados técnicos

    Remove:
    - instrução INPUT APRIMORADO
    - título === PROGNÓSTICOS - FUTEBOL ===
    - top 5 placares
    - mercados/picks do modelo
    """

    if not texto:
        return ""

    linhas = texto.splitlines()
    linhas_limpas = []

    ignorar_blocos = [
        "--- TOP 5 PLACARES MAIS PROVÁVEIS ---",
        "--- RESULTADO DA PARTIDA ---",
        "--- OVER/UNDER GOLS ---",
        "--- AMBOS MARCAM ---",
        "--- DUPLA CHANCE ---",
        "--- HANDICAP ASIÁTICO ---",
        "--- HANDICAP ASIÁTICO. ---",
    ]

    parar_ate_proximo_bloco = False

    for linha in linhas:
        linha_strip = linha.strip()

        # Remove linhas introdutórias que não devem ir para análise crítica
        if linha_strip.startswith("Utilize o INPUT APRIMORADO"):
            continue

        if linha_strip == "=== PROGNÓSTICOS - FUTEBOL ===":
            continue

        # Remove separadores finais
        if linha_strip.startswith("===="):
            continue

        # Se encontrou um bloco que deve ser removido, ignora até o próximo título/bloco
        if any(linha_strip.startswith(bloco) for bloco in ignorar_blocos):
            parar_ate_proximo_bloco = True
            continue

        if parar_ate_proximo_bloco:
            # Se encontrou outro bloco removível, continua ignorando
            if any(linha_strip.startswith(bloco) for bloco in ignorar_blocos):
                continue

            # Se encontrou o fim ou outro separador, continua ignorando
            if linha_strip.startswith("===="):
                continue

            # Se encontrou uma nova seção que queremos manter no futuro, liberar.
            # Neste caso, os blocos removidos ficam no fim do relatório,
            # então normalmente não haverá nova seção útil depois deles.
            secoes_permitidas = [
                "Confronto:",
                "--- Probabilidades",
                "Data/Horário:",
                "Rodada Atual:",
                "--- H2H",
                "Total de jogos:",
                "Vitórias ",
                "Médias H2H",
                "--- ÚLTIMOS 5 JOGOS NO LOCAL ---",
                "--- DADOS TÉCNICOS ---",
                "RPI:",
                "Médias e Expectativas de Gols:",
                "Diferencial de Gols:",
            ]

            if any(linha_strip.startswith(secao) for secao in secoes_permitidas):
                parar_ate_proximo_bloco = False
            else:
                continue

        linhas_limpas.append(linha)

    contexto = "\n".join(linhas_limpas).strip()

    # Limpeza de múltiplas linhas vazias consecutivas
    while "\n\n\n" in contexto:
        contexto = contexto.replace("\n\n\n", "\n\n")

    return contexto


def dividir_contexto_por_confronto(contexto_modelo: str) -> list[str]:
    if not contexto_modelo:
        return []

    linhas = contexto_modelo.splitlines()
    blocos: list[list[str]] = []
    atual: list[str] = []

    for linha in linhas:
        if linha.strip().lower() == "confronto:":
            if atual:
                blocos.append(atual)
            atual = [linha]
            continue

        if atual:
            atual.append(linha)

    if atual:
        blocos.append(atual)

    return ["\n".join(bloco).strip() for bloco in blocos if "\n".join(bloco).strip()]


def _inferir_times_linha(row: pd.Series) -> tuple[str, str]:
    mandante = str(row.get("mandante") or "").strip()
    visitante = str(row.get("visitante") or "").strip()
    if mandante and visitante:
        return mandante, visitante

    jogo = str(row.get("jogo") or "")
    partes = re.split(r"\s+(?:vs|x|v)\s+", jogo, maxsplit=1, flags=re.IGNORECASE)
    if len(partes) == 2:
        return partes[0].strip(), partes[1].strip()

    return mandante, visitante


def selecionar_contexto_do_prognostico(row: pd.Series, contexto_modelo: str) -> str:
    blocos = dividir_contexto_por_confronto(contexto_modelo)
    if not blocos:
        return contexto_modelo or ""

    mandante, visitante = _inferir_times_linha(row)
    mandante_norm = _comparable_context_text(mandante)
    visitante_norm = _comparable_context_text(visitante)

    if mandante_norm and visitante_norm:
        for bloco in blocos:
            bloco_norm = _comparable_context_text(bloco)
            if mandante_norm in bloco_norm and visitante_norm in bloco_norm:
                return bloco

    return blocos[0] if len(blocos) == 1 else ""


def carregar_modulo_modelo_real():
    if not REAL_MODEL_PATH.exists():
        raise FileNotFoundError(f"Modelo real não encontrado em {REAL_MODEL_PATH}")

    spec = importlib.util.spec_from_file_location(
        "prognosticos_football_real",
        str(REAL_MODEL_PATH)
    )

    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)

    return modulo


def arquivo_csv_mais_recente(pasta: Path):
    if not pasta.exists():
        return None

    candidatos = list(pasta.glob("*.csv"))

    if not candidatos:
        return None

    return max(candidatos, key=lambda p: p.stat().st_mtime)


def salvar_contexto_modelo(texto_contexto: str, caminho_saida: Path):
    contexto_dir = BASE_DIR / "model_outputs" / "contextos"
    contexto_dir.mkdir(parents=True, exist_ok=True)

    nome_base = caminho_saida.stem
    caminho_contexto = contexto_dir / f"{nome_base}_contexto.txt"

    caminho_contexto.write_text(texto_contexto or "", encoding="utf-8")

    return caminho_contexto


def executar_modelo_real(caminho_csv_longo, caminho_saida):
    caminho_csv_longo = Path(caminho_csv_longo)
    caminho_saida = Path(caminho_saida)

    if not caminho_csv_longo.exists():
        raise FileNotFoundError(f"CSV de entrada não encontrado: {caminho_csv_longo}")

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)

    # Remove saída antiga para evitar reaproveitar resultado mock ou antigo
    if caminho_saida.exists():
        caminho_saida.unlink()

    caminho_wide = BASE_DIR / "model_outputs" / f"{caminho_csv_longo.stem}_wide.csv"

    # 1. Converte CSV longo da coleta para CSV wide usado pelo modelo original
    df_wide = converter_csv_longo_para_wide(
        caminho_entrada=str(caminho_csv_longo),
        caminho_saida=str(caminho_wide)
    )

    if df_wide.empty:
        raise ValueError("CSV wide ficou vazio após conversão.")

    # 2. Carrega modelo real extraído do notebook
    modelo = carregar_modulo_modelo_real()

    # 3. Tenta sobrescrever variáveis globais, caso o notebook use alguma delas
    modelo.MATCHES_CSV = caminho_wide
    modelo.LOVABLE_CSV = caminho_saida
    modelo.ARQ_PROGNOSTICOS_LOVABLE = caminho_saida

    if not hasattr(modelo, "main"):
        raise AttributeError("O modelo real não possui função main().")

    pasta_prognostico = BASE_DIR / "Prognostico"

    # 4. Executa o modelo real capturando o relatório técnico impresso no stdout
    buffer_saida = io.StringIO()

    with contextlib.redirect_stdout(buffer_saida):
        modelo.main()

    contexto_bruto = buffer_saida.getvalue()
    contexto_modelo = limpar_contexto_modelo(contexto_bruto)

    # 5. Salva o relatório técnico filtrado em TXT
    caminho_contexto = salvar_contexto_modelo(contexto_modelo, caminho_saida)

    # 6. O notebook original salva em pasta própria.
    # Pegamos o CSV mais recente gerado na pasta Prognostico.
    arquivo_real = arquivo_csv_mais_recente(pasta_prognostico)

    if arquivo_real is None:
        raise FileNotFoundError(
            f"O modelo executou, mas não encontrei CSVs em {pasta_prognostico}"
        )

    df_saida = pd.read_csv(arquivo_real)

    # 7. Padroniza colunas para o Lovable
    colunas_saida = [
        "data",
        "hora",
        "esporte",
        "liga",
        "jogo",
        "mandante",
        "visitante",
        "mercado",
        "pick",
        "linha",
        "odd_ofertada",
        "odd_valor",
        "probabilidade_final",
        "edge",
        "observacoes",
    ]

    for coluna in colunas_saida:
        if coluna not in df_saida.columns:
            df_saida[coluna] = ""

    df_saida = df_saida[colunas_saida]

    # 8. Adiciona o contexto técnico filtrado em cada prognóstico
    contextos_linha = df_saida.apply(lambda row: selecionar_contexto_do_prognostico(row, contexto_modelo), axis=1)
    df_saida["dados_tecnicos"] = contextos_linha
    df_saida["contexto_modelo"] = contextos_linha
    df_saida["arquivo_contexto"] = str(caminho_contexto)

    # 8.1. Aplica a camada conservadora Football V1.1 sem alterar o notebook real.
    global LAST_V1_1_DISCARDED
    df_saida, LAST_V1_1_DISCARDED = aplicar_controles_football_v1_1(df_saida, df_wide)

    if df_saida.empty:
        df_saida = pd.DataFrame(columns=colunas_saida + [
            "dados_tecnicos",
            "contexto_modelo",
            "arquivo_contexto",
            "modelo_versao",
        ])

    descartes_path = caminho_saida.with_name(f"{caminho_saida.stem}_descartes_v1_1.csv")
    LAST_V1_1_DISCARDED.to_csv(descartes_path, index=False, encoding="utf-8-sig")

    # 9. Higieniza NaN/inf
    df_saida = df_saida.replace([float("inf"), float("-inf")], pd.NA)
    df_saida = df_saida.where(pd.notna(df_saida), None)

    # 10. Salva CSV final no caminho esperado pela API
    df_saida.to_csv(caminho_saida, index=False, encoding="utf-8-sig")

    return df_saida, contexto_modelo, caminho_contexto


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({
            "ok": False,
            "erro": "Uso correto: python modelos/football_runner_real.py caminho_entrada.csv caminho_saida.csv"
        }, ensure_ascii=False))
        sys.exit(1)

    caminho_entrada = sys.argv[1]
    caminho_saida = sys.argv[2]

    try:
        prognosticos, contexto_modelo, caminho_contexto = executar_modelo_real(
            caminho_entrada,
            caminho_saida
        )

        resposta = {
            "ok": True,
            "total_prognosticos": len(prognosticos),
            "arquivo_saida": str(caminho_saida),
            "arquivo_contexto": str(caminho_contexto),
            "contexto_modelo": contexto_modelo,
            "dados_tecnicos": contexto_modelo,
            "prognosticos": prognosticos.to_dict(orient="records")
        }

        print(json.dumps(limpar_json_nan(resposta), ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "ok": False,
            "erro": str(e)
        }, ensure_ascii=False))
        sys.exit(1)
