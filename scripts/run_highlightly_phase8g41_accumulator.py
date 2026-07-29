"""Preview or run the bounded daily Football training-data accumulator."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Iterable

from api.highlightly_repository import HighlightlyRepository


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--label-limit", type=int, default=200)
    parser.add_argument("--feature-limit", type=int, default=200)
    parser.add_argument(
        "--max-candidates-per-kickoff",
        type=int,
        default=200,
    )
    parser.add_argument("--dataset-limit", type=int, default=5_000)
    parser.add_argument("--confirm-accumulate", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if not 1 <= args.days <= 3_650:
        parser.error("--days must be between 1 and 3650")
    if not 1 <= args.label_limit <= 200:
        parser.error("--label-limit must be between 1 and 200")
    if not 1 <= args.feature_limit <= 200:
        parser.error("--feature-limit must be between 1 and 200")
    if not 1 <= args.max_candidates_per_kickoff <= 500:
        parser.error(
            "--max-candidates-per-kickoff must be between 1 and 500"
        )
    if not 1 <= args.dataset_limit <= 5_000:
        parser.error("--dataset-limit must be between 1 and 5000")
    return args


def _emit(payload: dict[str, object], output: Path | None) -> None:
    rendered = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_text(rendered + "\n", encoding="utf-8")
        os.replace(temporary, output)
    print(rendered)


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    if context["provider"].get("enabled"):
        raise RuntimeError(
            "Highlightly provider must be disabled for accumulation"
        )

    rpc_args = {
        "p_days": args.days,
        "p_label_limit": args.label_limit,
        "p_feature_limit": args.feature_limit,
        "p_max_candidates_per_kickoff":
            args.max_candidates_per_kickoff,
        "p_dataset_limit": args.dataset_limit,
    }
    payload: dict[str, object] = {
        "event": "phase8g41_daily_training_accumulation",
        "mode": "execute" if args.confirm_accumulate else "dry-run",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sport": "football",
        "provider_enabled": False,
        "provider_calls": 0,
        "stored_data_only": True,
        "global_lock_required": True,
        "automatic_training": False,
        "automatic_predictions": False,
    }

    if args.confirm_accumulate:
        result = repository.rpc(
            "run_highlightly_football_training_accumulation_v1",
            rpc_args,
        )
        payload["result"] = result
        _emit(payload, args.output)
        return 1 if result.get("status") == "failed" else 0

    payload["preview"] = repository.rpc(
        "get_highlightly_training_accumulation_preview_v1",
        rpc_args,
    )
    payload["report"] = repository.rpc(
        "get_highlightly_training_accumulation_report_v1",
        {"p_days": 30},
    )
    _emit(payload, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
