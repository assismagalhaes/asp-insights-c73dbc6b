"""Compare MLB V1 backup against MLB V1.1 on local audit files.

This audit builds a temporary Baseball Reference-like history directory from a
results JSON/CSV, runs both runners over the same odds CSVs, and writes a
compact before/after report. It does not alter endpoints, screens, databases,
or any production service.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import tempfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from modelos import baseball_runner_real as v11
from modelos import baseball_runner_real_v1_backup as v1


REPORT_NAME = "mlb_v1_vs_v2_walk_forward_comparativo.csv"


def _norm(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _float(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return default


def _team_sigla(name: str, fallback: Any = None) -> str | None:
    if fallback:
        return str(fallback).upper().strip()
    return v11.team_sigla(str(name))


def _row_date(value: Any) -> str:
    text = str(value or "").strip()
    return text[:10]


def parse_date(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _float_or_none(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def normalize_result_row(row: dict[str, Any]) -> dict[str, Any] | None:
    home = row.get("home") or row.get("mandante")
    away = row.get("away") or row.get("visitante")
    home_runs = row.get("home_runs") or row.get("placar_mandante") or row.get("runs_mandante")
    away_runs = row.get("away_runs") or row.get("placar_visitante") or row.get("runs_visitante")
    parsed_date = parse_date(row.get("date") or row.get("data"))
    home_score = _float_or_none(home_runs)
    away_score = _float_or_none(away_runs)
    if not home or not away or parsed_date is None or home_score is None or away_score is None:
        return None
    return {
        **row,
        "date": parsed_date.strftime("%Y-%m-%d"),
        "home": str(home).strip(),
        "away": str(away).strip(),
        "home_runs": home_score,
        "away_runs": away_score,
    }


def load_results(path: str | Path) -> list[dict[str, Any]]:
    source = Path(path)
    if source.suffix.lower() == ".csv":
        with source.open("r", encoding="utf-8-sig", newline="") as fh:
            raw_rows = list(csv.DictReader(fh))
    else:
        with source.open("r", encoding="utf-8-sig") as fh:
            payload = json.load(fh)
        raw_rows = payload.get("games", []) if isinstance(payload, dict) else payload
    rows = [normalize_result_row(row) for row in raw_rows if isinstance(row, dict)]
    return [row for row in rows if row is not None]


def result_key(date: Any, home: Any, away: Any) -> tuple[str, str, str]:
    parsed = parse_date(date)
    date_key = parsed.strftime("%Y-%m-%d") if parsed else str(date or "").strip()
    return date_key, _norm(home), _norm(away)


def build_result_index(results: list[dict[str, Any]]) -> dict[tuple[str, str, str], dict[str, Any]]:
    return {result_key(row["date"], row["home"], row["away"]): row for row in results}


def _same_team(a: Any, b: Any) -> bool:
    return _norm(a) == _norm(b)


def resolve_pick_result(opportunity: dict[str, Any], result_row: dict[str, Any]) -> str:
    market = str(opportunity.get("mercado") or "").strip()
    pick = str(opportunity.get("pick") or "").strip()
    line = _float_or_none(opportunity.get("linha"))
    home = str(result_row.get("home") or "").strip()
    away = str(result_row.get("away") or "").strip()
    home_runs = _float_or_none(result_row.get("home_runs"))
    away_runs = _float_or_none(result_row.get("away_runs"))
    if not home or not away or home_runs is None or away_runs is None:
        raise ValueError("Resultado sem times ou placar reconhecivel.")

    if market == "Moneyline":
        if _same_team(pick, home):
            return "GREEN" if home_runs > away_runs else "RED"
        if _same_team(pick, away):
            return "GREEN" if away_runs > home_runs else "RED"
        raise ValueError("Pick Moneyline nao corresponde ao mandante ou visitante.")

    if market == "Total de Corridas":
        if line is None:
            raise ValueError("Linha ausente para Total de Corridas.")
        total = home_runs + away_runs
        if math.isclose(total, line, abs_tol=1e-12):
            return "PUSH"
        normalized_pick = pick.lower()
        if "over" in normalized_pick:
            return "GREEN" if total > line else "RED"
        if "under" in normalized_pick:
            return "GREEN" if total < line else "RED"
        raise ValueError("Pick de total sem Over/Under.")

    if market in {"Handicap Asiatico", "Handicap Asiático"}:
        if line is None:
            raise ValueError("Linha ausente para Handicap.")
        if _same_team(pick.split(" ")[0], home) or _norm(home) in _norm(pick):
            margin = home_runs - away_runs
        elif _same_team(pick.split(" ")[0], away) or _norm(away) in _norm(pick):
            margin = away_runs - home_runs
        else:
            raise ValueError("Pick Handicap nao corresponde ao mandante ou visitante.")
        adjusted = margin + line
        if math.isclose(adjusted, 0.0, abs_tol=1e-12):
            return "PUSH"
        return "GREEN" if adjusted > 0 else "RED"

    raise ValueError(f"Mercado nao reconhecido: {market}")


def fixed_unit_profit(result: str, odd: float) -> float:
    if result == "GREEN":
        return odd - 1.0
    if result == "RED":
        return -1.0
    if result == "PUSH":
        return 0.0
    raise ValueError("result must be GREEN, RED, or PUSH.")


def _binary_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in rows if row.get("resultado_real") in {"GREEN", "RED"}]


def _brier_score(probabilities: list[float], outcomes: list[int]) -> float:
    if not probabilities:
        return 0.0
    return sum((prob - outcome) ** 2 for prob, outcome in zip(probabilities, outcomes)) / len(probabilities)


def _log_loss(probabilities: list[float], outcomes: list[int]) -> float:
    if not probabilities:
        return 0.0
    eps = 1e-15
    total = 0.0
    for prob, outcome in zip(probabilities, outcomes):
        clipped = min(max(prob, eps), 1.0 - eps)
        total += -(outcome * math.log(clipped) + (1 - outcome) * math.log(1 - clipped))
    return total / len(probabilities)


def _expected_calibration_error(probabilities: list[float], outcomes: list[int], bins: int = 10) -> float:
    if not probabilities:
        return 0.0
    total = len(probabilities)
    ece = 0.0
    for index in range(bins):
        start = index / bins
        end = (index + 1) / bins
        bucket = [
            (prob, outcome)
            for prob, outcome in zip(probabilities, outcomes)
            if start <= prob < end or (index == bins - 1 and math.isclose(prob, 1.0))
        ]
        if not bucket:
            continue
        avg_prob = sum(prob for prob, _outcome in bucket) / len(bucket)
        avg_outcome = sum(outcome for _prob, outcome in bucket) / len(bucket)
        ece += (len(bucket) / total) * abs(avg_prob - avg_outcome)
    return ece


def summarize_prediction_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    materialized = list(rows)
    binary = _binary_rows(materialized)
    probabilities = [_float(row.get("probabilidade_v2")) for row in binary]
    outcomes = [1 if row.get("resultado_real") == "GREEN" else 0 for row in binary]
    odds = [_float(row.get("odd_ofertada")) for row in materialized if row.get("resultado_real") in {"GREEN", "RED", "PUSH"}]
    profits = [
        fixed_unit_profit(row["resultado_real"], _float(row.get("odd_ofertada")))
        for row in materialized
        if row.get("resultado_real") in {"GREEN", "RED", "PUSH"}
    ]
    green = sum(1 for row in materialized if row.get("resultado_real") == "GREEN")
    red = sum(1 for row in materialized if row.get("resultado_real") == "RED")
    push = sum(1 for row in materialized if row.get("resultado_real") == "PUSH")
    settled = green + red
    total_with_push = green + red + push
    all_probs = [_float(row.get("probabilidade_v2")) for row in materialized if row.get("probabilidade_v2") not in (None, "")]
    profit = sum(profits)
    return {
        "picks": len(materialized),
        "green": green,
        "red": red,
        "push": push,
        "win_rate": green / settled if settled else 0.0,
        "roi_hipotetico": profit / total_with_push if total_with_push else 0.0,
        "lucro_unidades_hipotetico": profit,
        "media_probabilidade_prevista": sum(all_probs) / len(all_probs) if all_probs else 0.0,
        "media_odd": sum(odds) / len(odds) if odds else 0.0,
        "brier_score": _brier_score(probabilities, outcomes),
        "log_loss": _log_loss(probabilities, outcomes),
        "expected_calibration_error": _expected_calibration_error(probabilities, outcomes),
    }


def build_temp_history(results: list[dict[str, Any]], root: Path) -> Path:
    grouped: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    team_records: dict[tuple[int, str], dict[str, int]] = defaultdict(lambda: {"wins": 0, "losses": 0})

    for result in sorted(results, key=lambda row: row.get("date", "")):
        date = _row_date(result.get("date"))
        if not date:
            continue
        year = int(date[:4])
        home = str(result["home"])
        away = str(result["away"])
        home_sigla = _team_sigla(home, result.get("home_sigla"))
        away_sigla = _team_sigla(away, result.get("away_sigla"))
        if not home_sigla or not away_sigla:
            continue
        home_runs = int(float(result["home_runs"]))
        away_runs = int(float(result["away_runs"]))
        home_win = home_runs > away_runs

        home_record = team_records[(year, home_sigla)]
        away_record = team_records[(year, away_sigla)]
        home_record["wins"] += 1 if home_win else 0
        home_record["losses"] += 0 if home_win else 1
        away_record["wins"] += 0 if home_win else 1
        away_record["losses"] += 1 if home_win else 0

        grouped[(year, home_sigla)].append(
            {
                "Gm#": len(grouped[(year, home_sigla)]) + 1,
                "Date": date,
                "Tm": home_sigla,
                "HomeAway": "",
                "Opp": away_sigla,
                "W/L": "W" if home_win else "L",
                "R": home_runs,
                "RA": away_runs,
                "W-L": f"{home_record['wins']}-{home_record['losses']}",
                "Rank": "1",
                "Streak": "W1" if home_win else "L1",
            }
        )
        grouped[(year, away_sigla)].append(
            {
                "Gm#": len(grouped[(year, away_sigla)]) + 1,
                "Date": date,
                "Tm": away_sigla,
                "HomeAway": "@",
                "Opp": home_sigla,
                "W/L": "L" if home_win else "W",
                "R": away_runs,
                "RA": home_runs,
                "W-L": f"{away_record['wins']}-{away_record['losses']}",
                "Rank": "1",
                "Streak": "L1" if home_win else "W1",
            }
        )

    fields = ["Gm#", "Date", "Tm", "HomeAway", "Opp", "W/L", "R", "RA", "W-L", "Rank", "Streak"]
    for (year, sigla), rows in grouped.items():
        year_dir = root / str(year)
        year_dir.mkdir(parents=True, exist_ok=True)
        path = year_dir / f"dados_base_{sigla.lower()}.csv"
        with path.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
    return root


def run_runner(module: Any, odds_paths: list[Path], history_dir: Path, results: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    result_index = build_result_index(results)
    predictions: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    cutoff_history_cache: dict[str, Path] = {}

    for odds_path in odds_paths:
        try:
            games = module.preparar_jogos_baseball(odds_path)
        except Exception as exc:  # noqa: BLE001
            errors.append({"arquivo": str(odds_path), "erro": str(exc)})
            continue
        season = module.infer_season(games)
        stats_cache: dict[tuple[str, str], Any] = {}
        for game in games:
            result = result_index.get(result_key(game.get("data"), game.get("home"), game.get("away")))
            if result is None:
                errors.append({"arquivo": str(odds_path), "jogo": game.get("jogo"), "erro": "resultado_nao_encontrado"})
                continue
            try:
                cutoff_date = str(game.get("data") or "")[:10]
                cutoff_history = cutoff_history_cache.get(cutoff_date)
                if cutoff_history is None:
                    cutoff_results = [
                        row for row in results if str(row.get("date") or "")[:10] < cutoff_date
                    ]
                    cutoff_history = build_temp_history(
                        cutoff_results,
                        history_dir / f"cutoff_{cutoff_date.replace('-', '')}",
                    )
                    cutoff_history_cache[cutoff_date] = cutoff_history
                module.HIST_DIR = cutoff_history
                if hasattr(module, "_load_league_average_runs_cached"):
                    module._load_league_average_runs_cached.cache_clear()
                home_sigla = module.team_sigla(game["home"])
                away_sigla = module.team_sigla(game["away"])
                cache_prefix = str(cutoff_history)
                if module is v11:
                    home_stats = stats_cache.setdefault(
                        (cache_prefix, home_sigla),
                        module.load_team_stats(home_sigla, season, cutoff_date=cutoff_date),
                    )
                    away_stats = stats_cache.setdefault(
                        (cache_prefix, away_sigla),
                        module.load_team_stats(away_sigla, season, cutoff_date=cutoff_date),
                    )
                else:
                    home_stats = stats_cache.setdefault(
                        (cache_prefix, home_sigla), module.load_team_stats(home_sigla, season)
                    )
                    away_stats = stats_cache.setdefault(
                        (cache_prefix, away_sigla), module.load_team_stats(away_sigla, season)
                    )
                context = module.build_game_context(game, home_stats, away_stats, season)
                if module is v11:
                    league_runs = module.load_league_average_runs(season, cutoff_date)
                    picks = module.generate_game_picks(
                        game, home_stats, away_stats, context, league_runs=league_runs
                    )
                else:
                    picks = module.generate_game_picks(game, home_stats, away_stats, context)
            except Exception as exc:  # noqa: BLE001
                errors.append({"arquivo": str(odds_path), "jogo": game.get("jogo"), "erro": str(exc)})
                continue
            for pick in picks:
                try:
                    outcome = resolve_pick_result(pick, result)
                except Exception as exc:  # noqa: BLE001
                    errors.append({"arquivo": str(odds_path), "jogo": pick.get("jogo"), "pick": pick.get("pick"), "erro": str(exc)})
                    continue
                predictions.append(
                    {
                        **pick,
                        "resultado_real": outcome,
                        "probabilidade_v2": _float(pick.get("probabilidade_final")) / 100.0,
                        "edge_v2": _float(pick.get("edge")) / 100.0,
                    }
                )
    return predictions, errors


def _market_rows(rows: list[dict[str, Any]], market: str | None = None) -> list[dict[str, Any]]:
    if market is None:
        return rows
    return [row for row in rows if _norm(row.get("mercado")) == _norm(market)]


def _summary_row(version: str, market: str, rows: list[dict[str, Any]], skipped_overconfidence: int = 0, skipped_handicap: int = 0) -> dict[str, Any]:
    summary = summarize_prediction_rows(rows)
    high_prob = sum(1 for row in rows if _float(row.get("probabilidade_final")) >= 70.0)
    return {
        "versao": version,
        "mercado": market,
        "quantidade_picks": summary["picks"],
        "green": summary["green"],
        "red": summary["red"],
        "push": summary["push"],
        "win_rate": summary["win_rate"],
        "roi_hipotetico_1u": summary["roi_hipotetico"],
        "lucro_hipotetico_1u": summary["lucro_unidades_hipotetico"],
        "probabilidade_media": summary["media_probabilidade_prevista"],
        "odd_media": summary["media_odd"],
        "brier": summary["brier_score"],
        "log_loss": summary["log_loss"],
        "ece": summary["expected_calibration_error"],
        "picks_probabilidade_acima_70": high_prob,
        "picks_puladas_overconfidence": skipped_overconfidence,
        "picks_puladas_handicap_bloqueado": skipped_handicap,
    }


def comparison_rows(v1_rows: list[dict[str, Any]], v11_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    v1_high_prob = sum(1 for row in v1_rows if _float(row.get("probabilidade_final")) >= 70.0)
    v1_handicap = len(_market_rows(v1_rows, "Handicap Asiático")) + len(_market_rows(v1_rows, "Handicap Asiatico"))
    output = [
        _summary_row("MLB_V1_BACKUP", "Todos", v1_rows),
        _summary_row(v11.MODEL_VERSION, "Todos", v11_rows, skipped_overconfidence=v1_high_prob, skipped_handicap=v1_handicap),
    ]
    for market in ("Moneyline", "Total de Corridas", "Handicap Asiático"):
        before = _market_rows(v1_rows, market)
        after = _market_rows(v11_rows, market)
        output.append(_summary_row("MLB_V1_BACKUP", market, before))
        output.append(
            _summary_row(
                v11.MODEL_VERSION,
                market,
                after,
                skipped_overconfidence=sum(1 for row in before if _float(row.get("probabilidade_final")) >= 70.0),
                skipped_handicap=len(before) if "handicap" in _norm(market) else 0,
            )
        )
    return output


def _calibration_market_key(value: Any) -> str:
    normalized = _norm(value)
    if "moneyline" in normalized:
        return "moneyline"
    if "total" in normalized:
        return "totals"
    if "handicap" in normalized:
        return "handicap"
    return normalized.replace(" ", "_")


def _fit_platt_logit(rows: list[dict[str, Any]]) -> tuple[float, float]:
    intercept = 0.0
    slope = 1.0
    regularization = 0.10
    for _iteration in range(60):
        gradient_intercept = -regularization * intercept
        gradient_slope = -regularization * (slope - 1.0)
        h00 = regularization
        h01 = 0.0
        h11 = regularization
        for row in rows:
            raw = min(max(_float(row.get("probabilidade_v2")), 1e-6), 1 - 1e-6)
            feature = math.log(raw / (1 - raw))
            outcome = 1.0 if row.get("resultado_real") == "GREEN" else 0.0
            linear = intercept + slope * feature
            predicted = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, linear))))
            residual = outcome - predicted
            variance = predicted * (1 - predicted)
            gradient_intercept += residual
            gradient_slope += residual * feature
            h00 += variance
            h01 += variance * feature
            h11 += variance * feature * feature
        determinant = h00 * h11 - h01 * h01
        if determinant <= 1e-12:
            break
        delta_intercept = (gradient_intercept * h11 - gradient_slope * h01) / determinant
        delta_slope = (gradient_slope * h00 - gradient_intercept * h01) / determinant
        intercept += delta_intercept
        slope += delta_slope
        if max(abs(delta_intercept), abs(delta_slope)) < 1e-8:
            break
    return intercept, slope


def _apply_platt(probability: float, intercept: float, slope: float) -> float:
    clipped = min(max(probability, 1e-6), 1 - 1e-6)
    feature = math.log(clipped / (1 - clipped))
    linear = max(-30.0, min(30.0, intercept + slope * feature))
    return 1.0 / (1.0 + math.exp(-linear))


def _rows_log_loss(rows: list[dict[str, Any]], intercept: float = 0.0, slope: float = 1.0) -> float:
    probabilities = [
        _apply_platt(_float(row.get("probabilidade_v2")), intercept, slope) for row in rows
    ]
    outcomes = [1 if row.get("resultado_real") == "GREEN" else 0 for row in rows]
    return _log_loss(probabilities, outcomes)


def build_oos_calibration_candidate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    markets = sorted({_calibration_market_key(row.get("mercado")) for row in rows})
    for market in markets:
        market_rows = sorted(
            [
                row
                for row in rows
                if _calibration_market_key(row.get("mercado")) == market
                and row.get("resultado_real") in {"GREEN", "RED"}
            ],
            key=lambda row: (str(row.get("data") or ""), str(row.get("jogo") or "")),
        )
        split_index = int(len(market_rows) * 0.70)
        train = market_rows[:split_index]
        validation = market_rows[split_index:]
        config: dict[str, Any] = {
            "active": False,
            "out_of_sample": True,
            "sample_size": len(market_rows),
            "train_size": len(train),
            "validation_size": len(validation),
            "intercept": 0.0,
            "slope": 1.0,
            "status": "insufficient_walk_forward_sample",
        }
        if len(train) >= 100 and len(validation) >= 40:
            intercept, slope = _fit_platt_logit(train)
            raw_log_loss = _rows_log_loss(validation)
            calibrated_log_loss = _rows_log_loss(validation, intercept, slope)
            improved = calibrated_log_loss + 0.002 < raw_log_loss and 0.20 <= slope <= 2.50
            config.update(
                {
                    "active": improved,
                    "intercept": intercept,
                    "slope": slope,
                    "validation_log_loss_raw": raw_log_loss,
                    "validation_log_loss_calibrated": calibrated_log_loss,
                    "status": "validated_oos" if improved else "rejected_no_oos_improvement",
                }
            )
        output[market] = config
    for market in ("moneyline", "totals", "handicap"):
        output.setdefault(
            market,
            {
                "active": False,
                "out_of_sample": True,
                "sample_size": 0,
                "train_size": 0,
                "validation_size": 0,
                "intercept": 0.0,
                "slope": 1.0,
                "status": "insufficient_walk_forward_sample",
            },
        )
    output["handicap"]["active"] = False
    output["handicap"]["status"] = "operationally_disabled"
    return output


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = sorted({field for row in rows for field in row})
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def run_comparison(*, odds_dir: str | Path, results_path: str | Path, out_dir: str | Path) -> dict[str, Any]:
    odds_paths = sorted(Path(odds_dir).glob("*.csv"))
    results = load_results(results_path)
    out = Path(out_dir)
    with tempfile.TemporaryDirectory() as tmp:
        history_dir = Path(tmp) / "dados_baseball_walk_forward"
        v1_rows, v1_errors = run_runner(v1, odds_paths, history_dir, results)
        v11_rows, v11_errors = run_runner(v11, odds_paths, history_dir, results)

    rows = comparison_rows(v1_rows, v11_rows)
    report_path = out / REPORT_NAME
    write_csv(report_path, rows)
    predictions_path = out / "mlb_v2_walk_forward_predictions.csv"
    write_csv(predictions_path, v11_rows)
    errors_path = out / "mlb_v2_walk_forward_errors.csv"
    write_csv(errors_path, v11_errors)
    calibration_path = out / "mlb_v2_calibration_candidate.json"
    calibration_path.parent.mkdir(parents=True, exist_ok=True)
    calibration_path.write_text(
        json.dumps(build_oos_calibration_candidate(v11_rows), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "ok": True,
        "report": str(report_path),
        "predictions_report": str(predictions_path),
        "calibration_candidate": str(calibration_path),
        "errors_report": str(errors_path),
        "v1_picks": len(v1_rows),
        "v2_picks": len(v11_rows),
        "v1_errors": len(v1_errors),
        "v2_errors": len(v11_errors),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare MLB V1 backup vs MLB V1.1.")
    parser.add_argument("--odds-dir", required=True)
    parser.add_argument("--results", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    payload = run_comparison(odds_dir=args.odds_dir, results_path=args.results, out_dir=args.out_dir)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
