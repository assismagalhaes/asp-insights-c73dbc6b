from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from modelos import basketball_runner_real as runner
from modelos.wnba_totals_v1_3_lab import (
    DEFAULT_WNBA_TOTALS_V1_3_WEIGHTS,
    blend_probability,
    calibrate_expected_points_to_market,
    calculate_expected_points_baseball_style,
    edge_decimal,
    fair_odd,
    normal_total_probability,
    poisson_total_probability,
    simulate_total_probability,
)


DEFAULT_OUTPUT_DIR = PROJECT_DIR / ".codex_tmp" / "basketball_wnba_totals_v1_3"


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit WNBA Totals V1.2 vs V1.3 experimental logic.")
    parser.add_argument("csvs", nargs="*", help="WNBA odds CSV files to audit.")
    parser.add_argument("--input-dir", default="", help="Directory with *_basketball_odds_coletadas.csv files.")
    parser.add_argument("--limit", type=int, default=10, help="Max files from --input-dir, newest first.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--market-anchor-weight", type=float, default=0.40, help="Weight used to calibrate model total to market anchor line.")
    parser.add_argument("--simulations", type=int, default=10_000, help="Monte Carlo simulations per total side.")
    args = parser.parse_args()

    csv_paths = [Path(item) for item in args.csvs]
    if args.input_dir:
        input_dir = Path(args.input_dir)
        csv_paths.extend(
            sorted(input_dir.glob("*_basketball_odds_coletadas.csv"), key=lambda p: p.stat().st_mtime, reverse=True)[: args.limit]
        )
    if not csv_paths:
        raise SystemExit("Informe CSVs ou --input-dir.")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for csv_path in csv_paths:
        try:
            rows.extend(audit_csv(csv_path, market_anchor_weight=args.market_anchor_weight, simulations=args.simulations))
        except Exception as exc:  # noqa: BLE001 - audit should continue across files.
            errors.append({"csv": str(csv_path), "erro": str(exc)})

    detail_path = output_dir / "wnba_totals_v1_3_detalhado.csv"
    summary_path = output_dir / "wnba_totals_v1_3_summary.csv"
    errors_path = output_dir / "wnba_totals_v1_3_errors.json"
    write_csv(detail_path, rows)
    write_csv(summary_path, build_summary(rows))
    errors_path.write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"rows": len(rows), "detail": str(detail_path), "summary": str(summary_path), "errors": errors}, ensure_ascii=False))


def audit_csv(csv_path: Path, market_anchor_weight: float = 0.40, simulations: int = 10_000) -> list[dict[str, Any]]:
    module = runner.load_notebook_module("WNBA")
    games = runner.long_csv_to_wide(csv_path, "WNBA", module)
    runner.update_model_periods(module, "WNBA", games)
    lines = runner.detect_ou_lines(games)
    handicap_indexes = runner.detect_hc_indexes(games)
    output: list[dict[str, Any]] = []
    for _, row in games.iterrows():
        result = module.analyze_game(row, lines, handicap_indexes)
        home = str(row["home_sigla"])
        away = str(row["away_sigla"])
        home_metrics = module.calcular_metricas_time(home, "casa", lines)
        away_metrics = module.calcular_metricas_time(away, "fora", lines)
        expected = calculate_expected_points_baseball_style(
            home_scored=float(home_metrics["media_tm"]),
            home_allowed=float(home_metrics["media_opp"]),
            away_scored=float(away_metrics["media_tm"]),
            away_allowed=float(away_metrics["media_opp"]),
            home_scored_sd=float(home_metrics["std_tm"]),
            home_allowed_sd=float(home_metrics["std_opp"]),
            away_scored_sd=float(away_metrics["std_tm"]),
            away_allowed_sd=float(away_metrics["std_opp"]),
        )
        market_anchor = find_market_anchor(result.get("ou") or {})
        calibrated = calibrate_expected_points_to_market(expected, market_anchor, market_weight=market_anchor_weight)
        for line, values in (result.get("ou") or {}).items():
            over_odd = runner.to_float(values.get("odd_off_over"))
            under_odd = runner.to_float(values.get("odd_off_under"))
            if over_odd is None or under_odd is None:
                continue
            no_vig = runner.no_vig_pair(over_odd, under_odd)
            if no_vig is None:
                continue
            for side, odd, market_prob in (("over", over_odd, no_vig[0]), ("under", under_odd, no_vig[1])):
                current_item = {
                    "mercado": "Over/Under Pontos",
                    "pick": f"{side.title()} {line}",
                    "linha": line,
                    "odd_ofertada": odd,
                    "odd_valor": values.get(f"odd_val_{side}"),
                    "probabilidade_final": values.get(f"prob_{side}"),
                }
                recalculated = runner.recalculate_wnba_total_pick(module, row, result, dict(current_item), home, away)
                if recalculated is None:
                    continue
                current_adjusted, current_debug = recalculated
                hist = runner.wnba_historical_total_probability(module, home, away, float(line), side)
                normal_prob = normal_total_probability(calibrated.total_expected, calibrated.total_sd, float(line), side)
                simulation = simulate_total_probability(
                    calibrated.home_expected,
                    calibrated.away_expected,
                    max(8.0, calibrated.home_sd),
                    max(8.0, calibrated.away_sd),
                    float(line),
                    side,
                    simulations=simulations,
                    seed=f"{csv_path.name}|{row.get('date')}|{row.get('time')}|{home}|{away}|{line}|{side}|{market_anchor_weight}",
                )
                poisson_prob = poisson_total_probability(expected.total_expected, float(line), side)
                v13_prob = blend_probability(
                    hist["taxa_com_shrinkage"],
                    float(simulation["probability"]),
                    market_prob,
                    DEFAULT_WNBA_TOTALS_V1_3_WEIGHTS,
                )
                output.append(
                    {
                        "arquivo": csv_path.name,
                        "data": row.get("date"),
                        "hora": row.get("time"),
                        "jogo": f"{module.TEAMS[home]} vs {module.TEAMS[away]}",
                        "side": side,
                        "linha": float(line),
                        "odd": odd,
                        "prob_v12": runner.to_float(current_adjusted.get("probabilidade_final")) / 100.0,
                        "odd_justa_v12": runner.to_float(current_adjusted.get("odd_valor")),
                        "edge_v12": runner.to_float(current_adjusted.get("edge")) / 100.0,
                        "prob_hist_v12": runner.to_float(current_debug.get("prob_hist")) / 100.0,
                        "prob_normal_v13": normal_prob,
                        "prob_sim_mc_v13": simulation["probability"],
                        "simulacoes_v13": simulation["simulations"],
                        "media_total_sim_v13": simulation["average_total"],
                        "prob_poisson_diag": poisson_prob,
                        "prob_no_vig": market_prob,
                        "prob_v13": v13_prob,
                        "odd_justa_v13": fair_odd(v13_prob),
                        "edge_v13": edge_decimal(v13_prob, odd),
                        "total_modelo_pre_mercado": expected.total_expected,
                        "linha_ancora_mercado": market_anchor,
                        "peso_ancora_mercado": market_anchor_weight,
                        "total_expected_v13": calibrated.total_expected,
                        "total_sd_v13": calibrated.total_sd,
                        "delta_total_vs_linha": calibrated.total_expected - float(line),
                        "jogos_hist": hist["jogos_considerados"],
                        "warnings_hist": ",".join(hist.get("warnings") or []),
                        "ev_v12": bool((runner.to_float(current_adjusted.get("edge")) or 0.0) > 0 and runner.to_float(current_adjusted.get("probabilidade_final")) < 70.0),
                        "ev_v13": bool(edge_decimal(v13_prob, odd) > 0 and v13_prob < 0.70 and 1.25 < odd <= 2.00),
                    }
                )
    return output


def find_market_anchor(ou: dict[Any, Any]) -> float:
    best_line = None
    best_distance = float("inf")
    for raw_line, values in ou.items():
        line = runner.to_float(raw_line)
        if line is None and isinstance(values, dict):
            line = runner.to_float(values.get("linha"))
        if line is None:
            continue
        over_odd = runner.to_float((values or {}).get("odd_off_over") if isinstance(values, dict) else None)
        under_odd = runner.to_float((values or {}).get("odd_off_under") if isinstance(values, dict) else None)
        if over_odd is None or under_odd is None:
            continue
        no_vig = runner.no_vig_pair(over_odd, under_odd)
        if no_vig is None:
            continue
        distance = abs(no_vig[0] - 0.5)
        if distance < best_distance:
            best_line = line
            best_distance = distance
    if best_line is None:
        return 0.0
    return float(best_line)


def build_summary(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault((str(row.get("arquivo")), str(row.get("side"))), []).append(row)
    summary: list[dict[str, Any]] = []
    for (file_name, side), group in sorted(groups.items()):
        summary.append(
            {
                "arquivo": file_name,
                "side": side,
                "linhas_avaliadas": len(group),
                "ev_v12": sum(1 for row in group if row.get("ev_v12")),
                "ev_v13": sum(1 for row in group if row.get("ev_v13")),
                "prob_v12_media": average(row.get("prob_v12") for row in group),
                "prob_v13_media": average(row.get("prob_v13") for row in group),
                "edge_v12_medio": average(row.get("edge_v12") for row in group),
                "edge_v13_medio": average(row.get("edge_v13") for row in group),
                "delta_total_vs_linha_medio": average(row.get("delta_total_vs_linha") for row in group),
            }
        )
    return summary


def average(values: Any) -> float:
    clean_values = [float(value) for value in values if value not in (None, "")]
    return sum(clean_values) / len(clean_values) if clean_values else 0.0


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
