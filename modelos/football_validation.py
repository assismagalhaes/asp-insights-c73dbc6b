import argparse
import json
import math
import unicodedata
from pathlib import Path

import pandas as pd

from football_probability import calibrate_binary, clamp_probability


def canonical_market(value) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii").lower()
    if "handicap" in text:
        return "asian_handicap"
    if "ambas" in text or "btts" in text or "both" in text:
        return "btts"
    if "total" in text or "over" in text or "under" in text or "gols" in text:
        return "total_goals"
    if "dupla" in text or "double" in text:
        return "double_chance"
    if "resultado" in text or "1x2" in text or "moneyline" in text:
        return "1x2"
    return text.strip().replace(" ", "_") or "unknown"


def brier_score(probabilities, outcomes) -> float:
    pairs = [(float(p), int(y)) for p, y in zip(probabilities, outcomes)]
    return sum((p - y) ** 2 for p, y in pairs) / len(pairs) if pairs else math.nan


def log_loss(probabilities, outcomes) -> float:
    pairs = [(clamp_probability(float(p)), int(y)) for p, y in zip(probabilities, outcomes)]
    return -sum(y * math.log(p) + (1 - y) * math.log(1 - p) for p, y in pairs) / len(pairs) if pairs else math.nan


def calibration_table(probabilities, outcomes, bins: int = 10) -> pd.DataFrame:
    frame = pd.DataFrame({"probability": probabilities, "outcome": outcomes}).dropna()
    if frame.empty:
        return pd.DataFrame(columns=["bin", "count", "mean_probability", "observed_rate", "calibration_error"])
    frame["probability"] = frame["probability"].astype(float).clip(0, 1)
    frame["outcome"] = frame["outcome"].astype(int)
    frame["bin"] = pd.cut(frame["probability"], bins=bins, labels=False, include_lowest=True)
    result = frame.groupby("bin", observed=True).agg(
        count=("outcome", "size"),
        mean_probability=("probability", "mean"),
        observed_rate=("outcome", "mean"),
    ).reset_index()
    result["calibration_error"] = (result["mean_probability"] - result["observed_rate"]).abs()
    return result


def expected_calibration_error(probabilities, outcomes, bins: int = 10) -> float:
    table = calibration_table(probabilities, outcomes, bins=bins)
    total = int(table["count"].sum()) if not table.empty else 0
    if total <= 0:
        return math.nan
    return float((table["calibration_error"] * table["count"] / total).sum())


def flat_stake_roi(probabilities, outcomes, offered_odds) -> float:
    profits = []
    for _, outcome, odd in zip(probabilities, outcomes, offered_odds):
        odd = float(odd)
        profits.append(odd - 1.0 if int(outcome) == 1 else -1.0)
    return sum(profits) / len(profits) if profits else math.nan


def closing_line_value(offered_odds, closing_odds) -> float:
    values = []
    for offered, closing in zip(offered_odds, closing_odds):
        offered = float(offered)
        closing = float(closing)
        if offered > 1.0 and closing > 1.0:
            values.append(offered / closing - 1.0)
    return sum(values) / len(values) if values else math.nan


def ranked_probability_score_1x2(
    frame: pd.DataFrame,
    match_col: str = "jogo_id",
    outcome_option_col: str = "opcao_1x2",
    result_col: str = "resultado_1x2",
    probability_col: str = "probabilidade_final",
) -> float:
    required = {match_col, outcome_option_col, result_col, probability_col}
    if not required.issubset(frame.columns):
        return math.nan
    scores = []
    for _, group in frame.groupby(match_col):
        probabilities = {
            str(row[outcome_option_col]).strip().upper(): float(row[probability_col]) / 100.0
            for _, row in group.iterrows()
        }
        if not {"H", "D", "A"}.issubset(probabilities):
            continue
        normalized_total = probabilities["H"] + probabilities["D"] + probabilities["A"]
        if normalized_total <= 0:
            continue
        p_home = probabilities["H"] / normalized_total
        p_draw = probabilities["D"] / normalized_total
        result = str(group.iloc[0][result_col]).strip().upper()
        if result not in {"H", "D", "A"}:
            continue
        y_home = 1.0 if result == "H" else 0.0
        y_home_or_draw = 1.0 if result in {"H", "D"} else 0.0
        scores.append(((p_home - y_home) ** 2 + (p_home + p_draw - y_home_or_draw) ** 2) / 2.0)
    return sum(scores) / len(scores) if scores else math.nan


def fit_platt_scaling(probabilities, outcomes, iterations: int = 1500, learning_rate: float = 0.02) -> dict[str, float]:
    pairs = [(clamp_probability(float(p)), int(y)) for p, y in zip(probabilities, outcomes)]
    if len(pairs) < 20 or len({outcome for _, outcome in pairs}) < 2:
        return {"slope": 1.0, "intercept": 0.0}
    features = [math.log(p / (1.0 - p)) for p, _ in pairs]
    slope = 1.0
    intercept = 0.0
    for _ in range(iterations):
        grad_slope = 0.0
        grad_intercept = 0.0
        for feature, (_, outcome) in zip(features, pairs):
            prediction = calibrate_binary(1.0 / (1.0 + math.exp(-feature)), {"slope": slope, "intercept": intercept})
            error = prediction - outcome
            grad_slope += error * feature
            grad_intercept += error
        scale = 1.0 / len(pairs)
        slope -= learning_rate * grad_slope * scale
        intercept -= learning_rate * grad_intercept * scale
        slope = min(max(slope, 0.05), 5.0)
        intercept = min(max(intercept, -5.0), 5.0)
    return {"slope": round(slope, 8), "intercept": round(intercept, 8)}


def walk_forward_calibration(
    frame: pd.DataFrame,
    date_col: str = "data",
    probability_col: str = "probabilidade_final",
    outcome_col: str = "resultado_binario",
    min_train: int = 100,
) -> pd.Series:
    data = frame.copy()
    data[date_col] = pd.to_datetime(data[date_col], errors="coerce", dayfirst=True)
    data = data.dropna(subset=[date_col, probability_col, outcome_col]).sort_values(date_col, kind="mergesort")
    result = pd.Series(index=data.index, dtype=float)
    for test_date in data[date_col].drop_duplicates().sort_values():
        train = data.loc[data[date_col] < test_date]
        test = data.loc[data[date_col] == test_date]
        if len(train) < min_train:
            continue
        config = fit_platt_scaling(train[probability_col] / 100.0, train[outcome_col])
        result.loc[test.index] = [calibrate_binary(value / 100.0, config) for value in test[probability_col]]
    return result


def evaluate_market(frame: pd.DataFrame, probability_col: str = "probabilidade_final") -> dict:
    data = frame.dropna(subset=[probability_col, "resultado_binario", "odd_ofertada"]).copy()
    probabilities = (data[probability_col].astype(float) / 100.0).clip(0, 1)
    outcomes = data["resultado_binario"].astype(int)
    report = {
        "n": len(data),
        "brier": brier_score(probabilities, outcomes),
        "log_loss": log_loss(probabilities, outcomes),
        "ece": expected_calibration_error(probabilities, outcomes),
        "roi_flat": flat_stake_roi(probabilities, outcomes, data["odd_ofertada"]),
    }
    if "odd_fechamento" in data:
        report["clv_medio"] = closing_line_value(data["odd_ofertada"], data["odd_fechamento"])
    rps = ranked_probability_score_1x2(frame, probability_col=probability_col)
    if not math.isnan(rps):
        report["rps_1x2"] = rps
    return report


def run_validation(input_csv: Path, output_dir: Path, min_train: int = 100) -> dict:
    frame = pd.read_csv(input_csv)
    required = {"data", "mercado", "probabilidade_final", "resultado_binario", "odd_ofertada"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"CSV de validacao sem colunas obrigatorias: {sorted(missing)}")

    output_dir.mkdir(parents=True, exist_ok=True)
    summary = {"overall": evaluate_market(frame), "markets": {}}
    if "modelo_variante" in frame.columns:
        summary["model_variants"] = {
            str(variant): evaluate_market(group)
            for variant, group in frame.groupby("modelo_variante", dropna=False)
        }
    calibration_config = {}
    tables = []
    for market, group in frame.groupby("mercado", dropna=False):
        market_key = canonical_market(market)
        calibrated = walk_forward_calibration(group, min_train=min_train)
        valid_calibrated = calibrated.dropna()
        market_report = evaluate_market(group)
        if not valid_calibrated.empty:
            aligned = group.loc[valid_calibrated.index]
            market_report["walk_forward"] = {
                "n": len(aligned),
                "brier": brier_score(valid_calibrated, aligned["resultado_binario"]),
                "log_loss": log_loss(valid_calibrated, aligned["resultado_binario"]),
                "ece": expected_calibration_error(valid_calibrated, aligned["resultado_binario"]),
            }
        summary["markets"][market_key] = market_report
        calibration_config[market_key] = fit_platt_scaling(
            group["probabilidade_final"].astype(float) / 100.0,
            group["resultado_binario"].astype(int),
        )
        table = calibration_table(group["probabilidade_final"] / 100.0, group["resultado_binario"])
        table.insert(0, "mercado", market)
        tables.append(table)

    (output_dir / "football_validation_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    (output_dir / "football_calibration.json").write_text(
        json.dumps(calibration_config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if tables:
        pd.concat(tables, ignore_index=True).to_csv(output_dir / "football_calibration_table.csv", index=False)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Validacao temporal do modelo de futebol.")
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path(".codex_tmp/football_validation"))
    parser.add_argument("--min-train", type=int, default=100)
    args = parser.parse_args()
    summary = run_validation(args.input_csv, args.output_dir, min_train=args.min_train)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
