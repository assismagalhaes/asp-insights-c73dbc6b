from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from modelos import basketball_runner_real as v11
from modelos import basketball_runner_real_v1_backup as v1


REPORTS = {
    "summary": "wnba_v1_1_comparison_summary.csv",
    "by_market": "wnba_v1_1_by_market.csv",
    "selected": "wnba_v1_1_selected.csv",
    "discarded": "wnba_v1_1_discarded.csv",
    "flags": "wnba_v1_1_flags.csv",
}


def _norm(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _float(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return default


def pick_key(row: dict[str, Any]) -> tuple[str, str, str, str, str, str, str]:
    return (
        _norm(row.get("source_csv")),
        _norm(row.get("data")),
        _norm(row.get("jogo")),
        _norm(row.get("mercado")),
        _norm(row.get("pick")),
        _norm(row.get("linha")),
        _norm(row.get("odd_ofertada")),
    )


def run_runner(module: Any, csv_path: str | Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    notebook = module.load_notebook_module("WNBA")
    games = module.long_csv_to_wide(Path(csv_path), "WNBA", notebook)
    module.update_model_periods(notebook, "WNBA", games)
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    linhas_ou = module.detect_ou_lines(games)
    hc_idxs = module.detect_hc_indexes(games)

    for _, game in games.iterrows():
        try:
            res = notebook.analyze_game(game, linhas_ou, hc_idxs)
            home = game["home_sigla"]
            away = game["away_sigla"]
            res["H2H_df"], res["H2H_stats"] = notebook.gerar_h2h(
                home,
                away,
                periodos=(notebook.TEMPORADA_ATUAL, notebook.TEMPORADA_PASSADA),
            )
            game_rows = notebook.montar_linhas_lovable(game, res)
            if hasattr(module, "apply_wnba_v1_1_controls"):
                game_rows = module.apply_wnba_v1_1_controls(notebook, game, res, game_rows)
            for item in game_rows:
                item.setdefault("odd", item.get("odd_ofertada"))
                item.setdefault("probabilidade", item.get("probabilidade_final"))
            rows.extend(module.normalize_rows(game_rows, "WNBA"))
        except Exception as exc:  # noqa: BLE001
            errors.append({"jogo": f"{game.get('home')} vs {game.get('away')}", "erro": str(exc)})
    return rows, errors


def infer_discard_reason(row: dict[str, Any]) -> str:
    market = _norm(row.get("mercado"))
    if "handicap" in market:
        return "WEAK_HANDICAP_SUPPORT"
    if "moneyline" in market:
        if abs(_float(row.get("odd_ofertada")) - 2.0) < 1e-9:
            return "NO_MARKET_BASELINE"
        return "WEAK_MONEYLINE_SUPPORT"
    if _float(row.get("probabilidade_final")) >= v11.WNBA_OVERCONFIDENCE_CUTOFF:
        return "OVERCONFIDENCE_CAP"
    if _float(row.get("odd_ofertada")) <= 1:
        return "INVALID_ODD"
    if _float(row.get("odd_valor")) <= 1:
        return "NO_MARKET_BASELINE"
    if _float(row.get("edge")) <= 0:
        return "NO_EV_AFTER_V1_1"
    if "over" in market or "under" in market or "pontos" in market or "total" in market:
        return "WEAK_TOTALS_SUPPORT"
    return "V1_1_FILTERED"


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "total_picks": len(rows),
        "picks_probabilidade_acima_70": sum(1 for row in rows if _float(row.get("probabilidade_final")) >= 70.0),
        "picks_sem_linha_valida": sum(1 for row in rows if "over" in _norm(row.get("pick")) and not row.get("linha")),
        "picks_sem_odd_valida": sum(1 for row in rows if _float(row.get("odd_ofertada")) <= 1),
        "probabilidade_media": round(sum(_float(row.get("probabilidade_final")) for row in rows) / len(rows), 4) if rows else 0,
        "edge_medio": round(sum(_float(row.get("edge")) for row in rows) / len(rows), 4) if rows else 0,
    }


def summarize_by_market(rows: list[dict[str, Any]], version: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row.get("mercado") or "")].append(row)
    return [{"versao": version, "mercado": market, **summarize(group)} for market, group in sorted(grouped.items())]


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = sorted({field for row in rows for field in row}) if rows else ["mensagem"]
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        if rows:
            writer.writerows(rows)


def run_comparison(csv_path: str | Path | list[str | Path], out_dir: str | Path = ".codex_tmp/basketball_backtest_app_outputs") -> dict[str, Any]:
    out = Path(out_dir)
    csv_paths = [csv_path] if isinstance(csv_path, (str, Path)) else list(csv_path)
    v1_rows: list[dict[str, Any]] = []
    v11_rows: list[dict[str, Any]] = []
    v1_errors: list[dict[str, Any]] = []
    v11_errors: list[dict[str, Any]] = []
    for path in csv_paths:
        source = Path(path).name
        batch_v1_rows, batch_v1_errors = run_runner(v1, path)
        batch_v11_rows, batch_v11_errors = run_runner(v11, path)
        for row in batch_v1_rows:
            row["source_csv"] = source
        for row in batch_v11_rows:
            row["source_csv"] = source
        for error in batch_v1_errors:
            error["source_csv"] = source
        for error in batch_v11_errors:
            error["source_csv"] = source
        v1_rows.extend(batch_v1_rows)
        v11_rows.extend(batch_v11_rows)
        v1_errors.extend(batch_v1_errors)
        v11_errors.extend(batch_v11_errors)
    v11_keys = {pick_key(row) for row in v11_rows}
    discarded = [
        {**row, "motivo_descarte": infer_discard_reason(row)}
        for row in v1_rows
        if pick_key(row) not in v11_keys
    ]
    reasons = Counter(row["motivo_descarte"] for row in discarded)
    summary = [
        {"versao": "WNBA_V1", **summarize(v1_rows), "erros": len(v1_errors)},
        {"versao": v11.BASKETBALL_WNBA_MODEL_VERSION, **summarize(v11_rows), "erros": len(v11_errors)},
    ]
    flags = [{"flag": key, "quantidade": value} for key, value in sorted(reasons.items())]

    write_csv(out / REPORTS["summary"], summary)
    write_csv(out / REPORTS["by_market"], summarize_by_market(v1_rows, "WNBA_V1") + summarize_by_market(v11_rows, v11.BASKETBALL_WNBA_MODEL_VERSION))
    write_csv(out / REPORTS["selected"], v11_rows)
    write_csv(out / REPORTS["discarded"], discarded)
    write_csv(out / REPORTS["flags"], flags)
    return {
        "ok": True,
        "v1_picks": len(v1_rows),
        "v1_1_picks": len(v11_rows),
        "discarded": len(discarded),
        "flags": dict(reasons),
        "reports": {key: str(out / name) for key, name in REPORTS.items()},
        "v1_errors": v1_errors[:5],
        "v1_1_errors": v11_errors[:5],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare Basketball WNBA V1 vs V1.1.")
    parser.add_argument("--csv", required=True, nargs="+")
    parser.add_argument("--out-dir", default=".codex_tmp/basketball_backtest_app_outputs")
    args = parser.parse_args()
    print(json.dumps(run_comparison(args.csv, args.out_dir), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
