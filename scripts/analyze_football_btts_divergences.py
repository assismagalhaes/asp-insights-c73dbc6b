"""Quantify and classify legacy/canonical BTTS shadow divergences for F3-043."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from statistics import mean
from typing import Any


def stable_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 2 or len(xs) != len(ys):
        return None
    mx, my = mean(xs), mean(ys)
    numerator = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denominator = (sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys)) ** 0.5
    return None if denominator == 0 else round(numerator / denominator, 4)


def analyze(legacy_dir: Path, canonical_dir: Path, output_file: Path) -> dict[str, Any]:
    legacy_dir = legacy_dir.resolve()
    canonical_dir = canonical_dir.resolve()
    legacy_manifest = json.loads((legacy_dir / "manifest.json").read_text(encoding="utf-8"))
    canonical_manifest = json.loads((canonical_dir / "manifest.json").read_text(encoding="utf-8"))
    legacy_by_match = {x["match_id"]: x for x in legacy_manifest["artifacts"]}
    matches = []
    for item in canonical_manifest["artifacts"]:
        canonical = json.loads((canonical_dir / item["path"]).read_text(encoding="utf-8"))
        legacy_item = legacy_by_match[item["match_id"]]
        legacy = json.loads((legacy_dir / legacy_item["path"]).read_text(encoding="utf-8"))
        cp = {x["pick"]: x for x in canonical["inference"]["predictions"]}
        lp = {x["pick"]: x for x in legacy["inference"]["predictions"]}
        c_total = float(canonical["inference"]["lambda_home"]) + float(canonical["inference"]["lambda_away"])
        l_total = float(legacy["inference"]["lambda_home"]) + float(legacy["inference"]["lambda_away"])
        yes_delta = round(cp["Sim"]["probabilidade_final"] - lp["Sim"]["probabilidade_final"], 4)
        decision_disagreements = [pick for pick in ("Sim", "Não") if cp[pick]["decision"] != lp[pick]["decision"]]
        edge_near_cutoff = []
        for pick in ("Sim", "Não"):
            for side, row in (("canonical", cp[pick]), ("legacy", lp[pick])):
                if row["edge"] is not None and abs(float(row["edge"]) - 0.03) <= 0.02:
                    edge_near_cutoff.append(f"{side}:{pick}")
        classifications = ["historical_input_contract_difference"]
        if abs(c_total - l_total) >= 0.35:
            classifications.append("expected_goals_total_gap")
        if abs(float(canonical["inference"]["lambda_home"]) - float(legacy["inference"]["lambda_home"])) + abs(float(canonical["inference"]["lambda_away"]) - float(legacy["inference"]["lambda_away"])) >= 0.5:
            classifications.append("expected_goals_allocation_gap")
        if edge_near_cutoff:
            classifications.append("near_edge_threshold")
        matches.append({
            "match_id": item["match_id"],
            "match": f"{canonical['identity']['home_name']} vs {canonical['identity']['away_name']}",
            "competition": canonical["identity"]["competition_name"],
            "split_key": canonical["dataset"]["split_key"],
            "canonical_btts_yes": cp["Sim"]["probabilidade_final"],
            "legacy_btts_yes": lp["Sim"]["probabilidade_final"],
            "yes_delta_pp": yes_delta,
            "absolute_delta_pp": abs(yes_delta),
            "canonical_lambda_total": round(c_total, 4),
            "legacy_lambda_total": round(l_total, 4),
            "lambda_total_delta": round(c_total - l_total, 4),
            "canonical_sample_min": min(canonical["inference"]["inputs"]["home"]["sample"], canonical["inference"]["inputs"]["away"]["sample"]),
            "legacy_sample_min": min(legacy["inference"]["sample_home"], legacy["inference"]["sample_away"]),
            "decision_disagreements": decision_disagreements,
            "edge_near_cutoff": edge_near_cutoff,
            "classifications": classifications,
        })

    leagues = {}
    for league in sorted({x["competition"] for x in matches}):
        rows = [x for x in matches if x["competition"] == league]
        leagues[league] = {
            "matches": len(rows),
            "mean_absolute_delta_pp": round(mean(x["absolute_delta_pp"] for x in rows), 4),
            "mean_signed_yes_delta_pp": round(mean(x["yes_delta_pp"] for x in rows), 4),
            "decision_disagreements": sum(len(x["decision_disagreements"]) for x in rows),
        }
    xs = [x["lambda_total_delta"] for x in matches]
    ys = [x["yes_delta_pp"] for x in matches]
    report = {
        "contract": "football_btts_shadow_divergence_analysis@1.0.0",
        "pair_count": len(matches),
        "decision_disagreement_count": sum(len(x["decision_disagreements"]) for x in matches),
        "canonical_higher_btts_yes_count": sum(x["yes_delta_pp"] > 0 for x in matches),
        "legacy_higher_btts_yes_count": sum(x["yes_delta_pp"] < 0 for x in matches),
        "mean_signed_yes_delta_pp": round(mean(ys), 4),
        "mean_absolute_yes_delta_pp": round(mean(abs(x) for x in ys), 4),
        "lambda_total_vs_btts_delta_pearson": _pearson(xs, ys),
        "classification_counts": {
            name: sum(name in x["classifications"] for x in matches)
            for name in ("historical_input_contract_difference", "expected_goals_total_gap", "expected_goals_allocation_gap", "near_edge_threshold")
        },
        "leagues": leagues,
        "largest_differences": sorted(matches, key=lambda x: x["absolute_delta_pp"], reverse=True)[:10],
        "decision_disagreements": [x for x in matches if x["decision_disagreements"]],
        "matches": matches,
        "provider_calls": 0,
        "published": False,
        "conclusion_scope": "diagnostic_not_model_superiority",
    }
    report["report_fingerprint"] = stable_hash(report)
    output_file = output_file.resolve()
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-dir", required=True, type=Path)
    parser.add_argument("--canonical-dir", required=True, type=Path)
    parser.add_argument("--output-file", required=True, type=Path)
    args = parser.parse_args()
    report = analyze(args.legacy_dir, args.canonical_dir, args.output_file)
    keys = ("pair_count", "decision_disagreement_count", "canonical_higher_btts_yes_count", "legacy_higher_btts_yes_count", "mean_signed_yes_delta_pp", "mean_absolute_yes_delta_pp", "lambda_total_vs_btts_delta_pearson", "classification_counts", "leagues", "report_fingerprint", "provider_calls", "published")
    print(json.dumps({key: report[key] for key in keys}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
