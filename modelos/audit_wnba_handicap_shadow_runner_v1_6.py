from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any

from modelos.wnba_handicap_probability_engine_v1_5 import read_normalized_rows
from modelos.wnba_handicap_shadow_runner_integration_v1_6 import (
    ensure_main_output_has_no_handicap,
    build_wnba_handicap_shadow_diagnostics,
)


OUTPUT_DIR = Path(".codex_tmp") / "basketball_wnba_handicap_shadow_v1_6"


def audit_shadow_runner(input_path: Path, output_json_path: Path | None = None) -> dict[str, Any]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    normalized_rows = read_normalized_rows(input_path)
    shadow = build_wnba_handicap_shadow_diagnostics(normalized_rows, {"source": str(input_path)})

    prognosticos = _read_output_prognosticos(output_json_path) if output_json_path else []
    output_check = {
        "output_json": str(output_json_path) if output_json_path else "",
        "main_output_available": bool(output_json_path),
        "main_output_total": len(prognosticos),
        "main_output_has_no_handicap": ensure_main_output_has_no_handicap(prognosticos),
        "moneyline_count": _count_market(prognosticos, "moneyline"),
        "over_under_count": _count_market(prognosticos, "over") + _count_market(prognosticos, "under") + _count_market(prognosticos, "pontos"),
        "handicap_count": _count_market(prognosticos, "handicap"),
    }

    diagnostics = shadow.get("diagnostics", [])
    flags = _flags_from_diagnostics(diagnostics)
    summary = {
        "input": str(input_path),
        "main_output_total": output_check["main_output_total"],
        "main_output_has_no_handicap": output_check["main_output_has_no_handicap"],
        "pairs_analyzed": shadow.get("pairs_analyzed", 0),
        "valid_pairs": shadow.get("valid_pairs", 0),
        "diagnostics_generated": len(diagnostics),
        "shadow_ready": shadow.get("summary", {}).get("shadow_ready", 0),
        "historical_fallback": shadow.get("summary", {}).get("historical_fallback", 0),
        "margin_fallback": shadow.get("summary", {}).get("margin_fallback", 0),
        "overconfidence_flags": shadow.get("summary", {}).get("overconfidence_flags", 0),
        "real_odd_2_00": shadow.get("summary", {}).get("real_odd_2_00", 0),
        "published": shadow.get("published"),
        "mode": shadow.get("mode"),
    }

    write_csv(OUTPUT_DIR / "wnba_handicap_shadow_runner_summary.csv", [summary])
    write_csv(OUTPUT_DIR / "wnba_handicap_shadow_runner_diagnostics.csv", [_flatten_diagnostic(row) for row in diagnostics])
    write_csv(OUTPUT_DIR / "wnba_handicap_shadow_runner_output_check.csv", [output_check])
    write_csv(OUTPUT_DIR / "wnba_handicap_shadow_runner_flags.csv", flags)
    return {"ok": True, "output_dir": str(OUTPUT_DIR), **summary}


def _read_output_prognosticos(path: Path | None) -> list[dict[str, Any]]:
    if not path or not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        rows = data.get("prognosticos") or data.get("rows") or []
        return [row for row in rows if isinstance(row, dict)]
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    return []


def _count_market(rows: list[dict[str, Any]], token: str) -> int:
    return sum(1 for row in rows if token in str(row.get("mercado") or "").lower() or token in str(row.get("pick") or "").lower())


def _flags_from_diagnostics(diagnostics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for item in diagnostics:
        for alert in item.get("alertas") or []:
            counts[alert] += 1
            rows.append(
                {
                    "jogo": item.get("jogo"),
                    "lado": item.get("lado"),
                    "linha": item.get("linha"),
                    "odd": item.get("odd"),
                    "flag": alert,
                }
            )
    rows.append({"jogo": "__TOTAL__", "flag_counts": dict(counts)})
    return rows


def _flatten_diagnostic(row: dict[str, Any]) -> dict[str, Any]:
    flattened = dict(row)
    flattened["alertas"] = "|".join(flattened.get("alertas") or [])
    componentes = flattened.pop("componentes", {}) or {}
    for component_name, component in componentes.items():
        if not isinstance(component, dict):
            continue
        for key, value in component.items():
            if isinstance(value, (dict, list)):
                flattened[f"{component_name}_{key}"] = str(value)
            else:
                flattened[f"{component_name}_{key}"] = value
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
        raise SystemExit("Uso: python -m modelos.audit_wnba_handicap_shadow_runner_v1_6 CSV_NORMALIZADO [OUTPUT_JSON]")
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    print(audit_shadow_runner(input_path, output_path))


if __name__ == "__main__":
    main()

