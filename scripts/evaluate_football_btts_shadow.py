"""Evaluate paired BTTS shadow predictions against persisted final scores."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any


def stable_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _score(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", str(value))
    if not match:
        raise ValueError(f"invalid final score: {value}")
    return int(match.group(1)), int(match.group(2))


def _metrics(rows: list[dict[str, Any]], side: str) -> dict[str, Any]:
    if not rows:
        return {"matches": 0}
    probabilities = [row[f"{side}_probability"] for row in rows]
    labels = [row["label"] for row in rows]
    brier = sum((p - y) ** 2 for p, y in zip(probabilities, labels)) / len(rows)
    log_loss = -sum(y * math.log(max(p, 1e-15)) + (1 - y) * math.log(max(1 - p, 1e-15)) for p, y in zip(probabilities, labels)) / len(rows)
    accuracy = sum((p >= 0.5) == bool(y) for p, y in zip(probabilities, labels)) / len(rows)
    candidates = [row for row in rows if row[f"{side}_decision"] == "SHADOW_CANDIDATE"]
    profit = 0.0
    wins = 0
    for row in candidates:
        won = row[f"{side}_pick"] == ("Sim" if row["label"] else "Não")
        wins += int(won)
        profit += row[f"{side}_odds"] - 1.0 if won else -1.0
    return {
        "matches": len(rows),
        "brier": round(brier, 6),
        "log_loss": round(log_loss, 6),
        "accuracy_at_0_5": round(accuracy, 6),
        "candidate_bets": len(candidates),
        "candidate_wins": wins,
        "candidate_losses": len(candidates) - wins,
        "candidate_profit_units": round(profit, 4),
        "candidate_roi": None if not candidates else round(profit / len(candidates), 6),
    }


def evaluate(legacy_dir: Path, canonical_dir: Path, settlement_source: Path, output_file: Path) -> dict[str, Any]:
    legacy_dir = legacy_dir.resolve()
    canonical_dir = canonical_dir.resolve()
    results = {row["id"]: row for row in json.loads(settlement_source.resolve().read_text(encoding="utf-8"))}
    lm = json.loads((legacy_dir / "manifest.json").read_text(encoding="utf-8"))
    cm = json.loads((canonical_dir / "manifest.json").read_text(encoding="utf-8"))
    legacy_by_match = {x["match_id"]: x for x in lm["artifacts"]}
    rows = []
    for item in cm["artifacts"]:
        canonical = json.loads((canonical_dir / item["path"]).read_text(encoding="utf-8"))
        legacy_item = legacy_by_match[item["match_id"]]
        legacy = json.loads((legacy_dir / legacy_item["path"]).read_text(encoding="utf-8"))
        result = results[item["match_id"]]
        if result.get("status") != "finished":
            raise ValueError(f"match not finished: {item['match_id']}")
        home, away = _score((result.get("score_data") or {}).get("current"))
        label = int(home > 0 and away > 0)
        cp = {x["pick"]: x for x in canonical["inference"]["predictions"]}
        lp = {x["pick"]: x for x in legacy["inference"]["predictions"]}
        canonical_candidate = next((x for x in cp.values() if x["decision"] == "SHADOW_CANDIDATE"), None)
        legacy_candidate = next((x for x in lp.values() if x["decision"] == "SHADOW_CANDIDATE"), None)
        rows.append({
            "match_id": item["match_id"],
            "match": f"{canonical['identity']['home_name']} vs {canonical['identity']['away_name']}",
            "competition": canonical["identity"]["competition_name"],
            "split_key": canonical["dataset"]["split_key"],
            "final_score": f"{home}-{away}",
            "label": label,
            "canonical_probability": float(cp["Sim"]["probabilidade_final"]) / 100.0,
            "legacy_probability": float(lp["Sim"]["probabilidade_final"]) / 100.0,
            "canonical_decision": None if canonical_candidate is None else canonical_candidate["decision"],
            "canonical_pick": None if canonical_candidate is None else canonical_candidate["pick"],
            "canonical_odds": None if canonical_candidate is None else canonical_candidate["odd_ofertada"],
            "legacy_decision": None if legacy_candidate is None else legacy_candidate["decision"],
            "legacy_pick": None if legacy_candidate is None else legacy_candidate["pick"],
            "legacy_odds": None if legacy_candidate is None else legacy_candidate["odd_ofertada"],
        })
    report = {
        "contract": "football_btts_shadow_evaluation@1.0.0",
        "match_count": len(rows),
        "settled_count": len(rows),
        "overall": {side: _metrics(rows, side) for side in ("canonical", "legacy")},
        "by_split": {
            split: {side: _metrics([x for x in rows if x["split_key"] == split], side) for side in ("canonical", "legacy")}
            for split in ("train", "validation", "test")
        },
        "by_league": {
            league: {side: _metrics([x for x in rows if x["competition"] == league], side) for side in ("canonical", "legacy")}
            for league in sorted({x["competition"] for x in rows})
        },
        "rows": rows,
        "supabase_reads": len(results),
        "highlightly_provider_calls": 0,
        "published": False,
        "bankroll_applied": False,
        "scope": "retrospective_shadow_evaluation_not_production_promotion",
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
    parser.add_argument("--settlement-source", required=True, type=Path)
    parser.add_argument("--output-file", required=True, type=Path)
    args = parser.parse_args()
    report = evaluate(args.legacy_dir, args.canonical_dir, args.settlement_source, args.output_file)
    print(json.dumps({key: report[key] for key in ("match_count", "settled_count", "overall", "by_split", "by_league", "highlightly_provider_calls", "published", "bankroll_applied", "report_fingerprint")}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
