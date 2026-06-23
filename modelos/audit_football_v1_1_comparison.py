"""
Auditoria comparativa Futebol V1 vs Futebol V1.1.

Uso:
    python modelos/audit_football_v1_1_comparison.py caminho_coleta.csv

O script executa o backup V1 e o runner atual V1.1 sobre o mesmo CSV de odds,
quando os arquivos historicos da VM estiverem disponiveis, e grava relatorios em:
    .codex_tmp/football_backtest_app_outputs/
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
MODELOS_DIR = ROOT / "modelos"
OUTPUT_DIR = ROOT / ".codex_tmp" / "football_backtest_app_outputs"


def load_module(path: Path, name: str):
    if str(MODELOS_DIR) not in sys.path:
        sys.path.insert(0, str(MODELOS_DIR))
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def run_runner(module, input_csv: Path, output_csv: Path) -> pd.DataFrame:
    df, _, _ = module.executar_modelo_real(input_csv, output_csv)
    return pd.DataFrame(df)


def norm_key(df: pd.DataFrame) -> pd.Series:
    parts = []
    for column in ["data", "hora", "jogo", "mercado", "pick", "linha"]:
        if column not in df.columns:
            df[column] = ""
        parts.append(df[column].fillna("").astype(str).str.strip().str.lower())
    return parts[0].str.cat(parts[1:], sep="|")


def numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def build_odds_group_diagnostics(input_csv: Path) -> pd.DataFrame:
    raw = pd.read_csv(input_csv)
    rows = []
    group_cols = ["data", "hora", "liga", "jogo", "mandante", "visitante"]
    for keys, group in raw.groupby(group_cols, dropna=False):
        base = dict(zip(group_cols, keys))
        mercados = set(group["mercado"].fillna("").astype(str).str.lower())

        one_x_two = group[group["mercado"].astype(str).str.lower().eq("1x2")]
        one_x_two_picks = set(one_x_two["pick"].astype(str))
        rows.append({
            **base,
            "mercado": "1X2",
            "completo": {str(base["mandante"]), "Empate", str(base["visitante"])}.issubset(one_x_two_picks),
            "detalhe": f"opcoes={sorted(one_x_two['pick'].dropna().astype(str).unique())}",
        })

        btts = group[group["mercado"].astype(str).str.lower().str.contains("ambas|btts|both", regex=True, na=False)]
        btts_picks = set(btts["pick"].fillna("").astype(str).str.lower())
        rows.append({
            **base,
            "mercado": "Ambas Marcam",
            "completo": any("sim" in p or "yes" in p for p in btts_picks) and any("não" in p or "nao" in p or "no" in p for p in btts_picks),
            "detalhe": f"opcoes={sorted(btts['pick'].dropna().astype(str).unique())}",
        })

        dc = group[group["mercado"].astype(str).str.lower().str.contains("dupla|double", regex=True, na=False)]
        dc_picks = {str(p).upper().replace(" ", "") for p in dc["pick"].dropna()}
        rows.append({
            **base,
            "mercado": "Dupla Chance",
            "completo": {"1X", "12", "X2"}.issubset(dc_picks),
            "detalhe": f"opcoes={sorted(dc_picks)}",
        })

        ou = group[group["mercado"].astype(str).str.lower().str.contains("over/under|total|gols", regex=True, na=False)]
        for line, line_group in ou.groupby("linha", dropna=False):
            picks = set(line_group["pick"].fillna("").astype(str).str.lower())
            rows.append({
                **base,
                "mercado": "Over/Under",
                "linha": line,
                "completo": any("over" in p for p in picks) and any("under" in p for p in picks),
                "detalhe": f"opcoes={sorted(line_group['pick'].dropna().astype(str).unique())}",
            })

        ah = group[group["mercado"].astype(str).str.lower().str.contains("asian handicap|handicap", regex=True, na=False)]
        for line, line_group in ah.groupby("linha", dropna=False):
            picks = set(line_group["pick"].fillna("").astype(str))
            rows.append({
                **base,
                "mercado": "Asian Handicap",
                "linha": line,
                "completo": str(base["mandante"]) in picks and str(base["visitante"]) in picks,
                "detalhe": f"opcoes={sorted(picks)}",
            })

        if not mercados:
            rows.append({**base, "mercado": "sem mercado", "completo": False, "detalhe": "nenhum mercado"})

    return pd.DataFrame(rows)


def extract_debug_value(text: str, key: str):
    marker = f"{key}="
    if not isinstance(text, str) or marker not in text:
        return None
    value = text.split(marker, 1)[1].split("|", 1)[0].strip()
    return value or None


def build_comparison(v1: pd.DataFrame, v11: pd.DataFrame) -> pd.DataFrame:
    v1 = v1.copy()
    v11 = v11.copy()
    v1["audit_key"] = norm_key(v1)
    v11["audit_key"] = norm_key(v11)

    merged = v1.merge(
        v11,
        on="audit_key",
        how="outer",
        suffixes=("_v1", "_v1_1"),
        indicator=True,
    )

    merged["prob_v1"] = numeric(merged.get("probabilidade_final_v1", pd.Series(dtype=float)))
    merged["prob_v1_1"] = numeric(merged.get("probabilidade_final_v1_1", pd.Series(dtype=float)))
    merged["edge_v1"] = numeric(merged.get("edge_v1", pd.Series(dtype=float)))
    merged["edge_v1_1"] = numeric(merged.get("edge_v1_1", pd.Series(dtype=float)))
    merged["delta_prob"] = merged["prob_v1_1"] - merged["prob_v1"]
    merged["status_comparacao"] = merged["_merge"].map({
        "both": "mantida",
        "left_only": "descartada_v1_1",
        "right_only": "nova_v1_1",
    })
    return merged


def write_reports(v1: pd.DataFrame, v11: pd.DataFrame, discarded: pd.DataFrame, comparison: pd.DataFrame) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    comparison.to_csv(OUTPUT_DIR / "football_v1_vs_v1_1_comparativo.csv", index=False, encoding="utf-8-sig")
    v11.to_csv(OUTPUT_DIR / "football_v1_1_selected.csv", index=False, encoding="utf-8-sig")
    discarded.to_csv(OUTPUT_DIR / "football_v1_1_discarded.csv", index=False, encoding="utf-8-sig")

    warnings_rows = []
    for _, row in v11.iterrows():
        text = str(row.get("observacoes", ""))
        if "warnings=" in text or "NEUTRAL_FALLBACK" in text:
            warnings_rows.append(row.to_dict())
    pd.DataFrame(warnings_rows).to_csv(OUTPUT_DIR / "football_v1_1_warnings.csv", index=False, encoding="utf-8-sig")

    summary_rows = [
        {"metric": "total_v1", "value": len(v1)},
        {"metric": "total_v1_1", "value": len(v11)},
        {"metric": "discarded_v1_1", "value": len(discarded)},
        {"metric": "prob_ge_70_v1", "value": int((numeric(v1.get("probabilidade_final", pd.Series(dtype=float))) >= 70).sum())},
        {"metric": "prob_ge_70_v1_1", "value": int((numeric(v11.get("probabilidade_final", pd.Series(dtype=float))) >= 70).sum())},
    ]

    if "mercado" in v11.columns:
        market_counts = v11["mercado"].fillna("").astype(str).value_counts()
        for market, count in market_counts.items():
            safe_market = market.strip().replace(" ", "_").lower() or "sem_mercado"
            summary_rows.append({"metric": f"selected_market_{safe_market}", "value": int(count)})
        handicap_selected = v11["mercado"].fillna("").astype(str).str.contains("handicap", case=False, na=False).sum()
        summary_rows.append({"metric": "handicap_mantido_v1_1", "value": int(handicap_selected)})

    if not discarded.empty and "motivo_descarte_v1_1" in discarded.columns:
        for reason, count in discarded["motivo_descarte_v1_1"].value_counts().items():
            summary_rows.append({"metric": f"discard_reason_{reason}", "value": int(count)})
        handicap_discarded = discarded.get("mercado", pd.Series(dtype=str)).fillna("").astype(str).str.contains("handicap", case=False, na=False).sum()
        summary_rows.append({"metric": "handicap_descartado_v1_1", "value": int(handicap_discarded)})

    pd.DataFrame(summary_rows).to_csv(OUTPUT_DIR / "football_v1_1_summary.csv", index=False, encoding="utf-8-sig")

    pd.DataFrame(summary_rows).to_csv(
        OUTPUT_DIR / "football_v1_1_b_stat_audit_summary.csv",
        index=False,
        encoding="utf-8-sig",
    )

    if "mercado" in v11.columns:
        market_distribution = (
            v11.assign(
                probabilidade_final_num=numeric(v11.get("probabilidade_final", pd.Series(dtype=float))),
                edge_num=numeric(v11.get("edge", pd.Series(dtype=float))),
            )
            .groupby("mercado", dropna=False)
            .agg(
                total=("mercado", "size"),
                prob_media=("probabilidade_final_num", "mean"),
                edge_medio=("edge_num", "mean"),
            )
            .reset_index()
        )
    else:
        market_distribution = pd.DataFrame(columns=["mercado", "total", "prob_media", "edge_medio"])

    market_distribution.to_csv(
        OUTPUT_DIR / "football_v1_1_b_market_distribution.csv",
        index=False,
        encoding="utf-8-sig",
    )

    if not discarded.empty and "motivo_descarte_v1_1" in discarded.columns:
        discard_reasons = discarded["motivo_descarte_v1_1"].value_counts().rename_axis("motivo").reset_index(name="total")
    else:
        discard_reasons = pd.DataFrame(columns=["motivo", "total"])

    discard_reasons.to_csv(
        OUTPUT_DIR / "football_v1_1_b_discard_reasons.csv",
        index=False,
        encoding="utf-8-sig",
    )

    probability_rows = []
    for _, row in v11.iterrows():
        obs = str(row.get("observacoes", ""))
        probability_rows.append({
            "jogo": row.get("jogo"),
            "mercado": row.get("mercado"),
            "pick": row.get("pick"),
            "linha": row.get("linha"),
            "probabilidade_final": row.get("probabilidade_final"),
            "prob_original": extract_debug_value(obs, "prob_original"),
            "prob_hist": extract_debug_value(obs, "prob_hist"),
            "prob_no_vig": extract_debug_value(obs, "prob_no_vig"),
            "prob_final": extract_debug_value(obs, "prob_final"),
            "score_matrix_max_goals": extract_debug_value(obs, "score_matrix_max_goals"),
            "score_matrix_tail_mass": extract_debug_value(obs, "score_matrix_tail_mass"),
            "warnings": extract_debug_value(obs, "warnings"),
        })

    pd.DataFrame(probability_rows).to_csv(
        OUTPUT_DIR / "football_v1_1_b_probability_diagnostics.csv",
        index=False,
        encoding="utf-8-sig",
    )

    edge_rows = []
    for _, row in v11.iterrows():
        obs = str(row.get("observacoes", ""))
        edge_rows.append({
            "jogo": row.get("jogo"),
            "mercado": row.get("mercado"),
            "pick": row.get("pick"),
            "linha": row.get("linha"),
            "odd_ofertada": row.get("odd_ofertada"),
            "odd_valor": row.get("odd_valor"),
            "edge": row.get("edge"),
            "edge_debug": extract_debug_value(obs, "edge"),
            "edge_formula": extract_debug_value(obs, "edge_formula"),
            "min_edge_required": extract_debug_value(obs, "min_edge_required"),
        })

    pd.DataFrame(edge_rows).to_csv(
        OUTPUT_DIR / "football_v1_1_b_edge_diagnostics.csv",
        index=False,
        encoding="utf-8-sig",
    )


def main() -> int:
    global OUTPUT_DIR

    parser = argparse.ArgumentParser()
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    OUTPUT_DIR = args.output_dir

    backup_path = MODELOS_DIR / "football_runner_real_v1_backup.py"
    current_path = MODELOS_DIR / "football_runner_real.py"

    if not backup_path.exists():
        raise FileNotFoundError(f"Backup V1 nao encontrado: {backup_path}")

    odds_diag = build_odds_group_diagnostics(args.input_csv)
    odds_diag.to_csv(
        OUTPUT_DIR / "football_v1_1_c_odds_group_diagnostics.csv",
        index=False,
        encoding="utf-8-sig",
    )

    v1_module = load_module(backup_path, "football_runner_real_v1_backup")
    v11_module = load_module(current_path, "football_runner_real_v1_1")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    v1 = run_runner(v1_module, args.input_csv, OUTPUT_DIR / "football_v1_output.csv")
    v11 = run_runner(v11_module, args.input_csv, OUTPUT_DIR / "football_v1_1_output.csv")
    discarded = getattr(v11_module, "LAST_V1_1_DISCARDED", pd.DataFrame())

    comparison = build_comparison(v1, v11)
    write_reports(v1, v11, discarded, comparison)

    print(f"Relatorios gerados em {OUTPUT_DIR}")
    print(f"V1={len(v1)} | V1.1={len(v11)} | descartadas={len(discarded)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
