from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path
from typing import Any

from modelos.wnba_handicap_probability_engine_v1_5 import read_normalized_rows
from modelos.wnba_handicap_controlled_activation_v1_7 import build_wnba_handicap_controlled_activation


OUTPUT_DIR = Path(".codex_tmp") / "basketball_wnba_handicap_v1_7"


def audit_paths(paths: list[Path]) -> dict[str, Any]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    selected_rows: list[dict[str, Any]] = []
    discarded_rows: list[dict[str, Any]] = []
    diagnostic_rows: list[dict[str, Any]] = []
    output_check_rows: list[dict[str, Any]] = []

    for path in paths:
        rows = read_normalized_rows(path)
        result = build_wnba_handicap_controlled_activation(rows, {"source": str(path)})
        shadow = result["handicap_shadow_diagnostics"]
        selected = result["prognosticos"]
        discarded = result["discarded"]
        selected_rows.extend({"arquivo": str(path), **row} for row in selected)
        discarded_rows.extend({"arquivo": str(path), **_flatten_diagnostic(row)} for row in discarded)
        diagnostic_rows.extend({"arquivo": str(path), **_flatten_diagnostic(row)} for row in shadow.get("diagnostics", []))
        output_check_rows.append(
            {
                "arquivo": str(path),
                "prognosticos_handicap": len(selected),
                "schema_preservado": all(_has_app_schema(row) for row in selected),
                "moneyline_alterado": False,
                "over_under_alterado": False,
                "published": shadow.get("published"),
                "published_count": shadow.get("published_count", 0),
            }
        )

    discard_counts = Counter(row.get("activation_status") for row in discarded_rows)
    summary = {
        "input_files": len(paths),
        "pairs_analyzed": _sum_summary(paths, "pairs_analyzed"),
        "valid_pairs": _sum_summary(paths, "valid_pairs"),
        "sides_evaluated": len(diagnostic_rows),
        "handicaps_published": len(selected_rows),
        "shadow_only_or_discarded": len(discarded_rows),
        "discard_fallback_duplo": discard_counts.get("HANDICAP_SHADOW_ONLY_DUE_TO_FALLBACKS", 0),
        "discard_edge": discard_counts.get("NO_VALUE_AGAINST_FAIR_ODD", 0),
        "discard_overconfidence": discard_counts.get("OVERCONFIDENCE_CAP", 0),
        "discard_odds": discard_counts.get("INVALID_ODDS", 0),
        **{f"discard_{key}": value for key, value in sorted(discard_counts.items()) if key},
    }

    write_csv(OUTPUT_DIR / "wnba_handicap_v1_7_summary.csv", [summary])
    write_csv(OUTPUT_DIR / "wnba_handicap_v1_7_selected.csv", selected_rows)
    write_csv(OUTPUT_DIR / "wnba_handicap_v1_7_discarded.csv", discarded_rows)
    write_csv(OUTPUT_DIR / "wnba_handicap_v1_7_shadow_diagnostics.csv", diagnostic_rows)
    write_csv(OUTPUT_DIR / "wnba_handicap_v1_7_output_check.csv", output_check_rows)
    return {"ok": True, "output_dir": str(OUTPUT_DIR), **summary}


def _sum_summary(paths: list[Path], key: str) -> int:
    total = 0
    for path in paths:
        rows = read_normalized_rows(path)
        result = build_wnba_handicap_controlled_activation(rows, {"source": str(path)})
        total += int(result["handicap_shadow_diagnostics"].get("summary", {}).get(key, 0) or 0)
    return total


def _has_app_schema(row: dict[str, Any]) -> bool:
    expected = {
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
        "probabilidade",
        "probabilidade_final",
        "odd",
        "odd_ofertada",
        "odd_valor",
        "edge",
        "stake",
        "parecer_validacao",
        "observacoes",
        "dados_tecnicos",
        "contexto_adicional",
        "contexto_modelo",
    }
    return expected.issubset(row.keys())


def _flatten_diagnostic(row: dict[str, Any]) -> dict[str, Any]:
    flattened = dict(row)
    flattened["alertas"] = "|".join(flattened.get("alertas") or [])
    componentes = flattened.pop("componentes", {}) or {}
    for component_name, component in componentes.items():
        if not isinstance(component, dict):
            continue
        for key, value in component.items():
            flattened[f"{component_name}_{key}"] = str(value) if isinstance(value, (dict, list)) else value
    return flattened


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields: list[str] = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Uso: python -m modelos.audit_wnba_handicap_controlled_activation_v1_7 CSV_NORMALIZADO [...]")
    paths = [Path(arg) for arg in sys.argv[1:]]
    print(audit_paths(paths))


if __name__ == "__main__":
    main()

