"""Run resumable stored-data-only Football accumulation in bounded batches."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from api.highlightly_repository import (
    HighlightlyRepository,
    HighlightlyRepositoryError,
)


_SENSITIVE_KEY = re.compile(
    r"(api[-_]?key|authorization|token|secret|password)",
    re.IGNORECASE,
)


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--max-batches", type=int, default=5)
    parser.add_argument("--feature-limit", type=int, default=20)
    parser.add_argument(
        "--max-candidates-per-kickoff",
        type=int,
        default=20,
    )
    parser.add_argument("--dataset-limit", type=int, default=500)
    parser.add_argument("--cycle-key")
    parser.add_argument("--confirm-accumulate", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if not 1 <= args.days <= 3_650:
        parser.error("--days must be between 1 and 3650")
    if not 1 <= args.batch_size <= 50:
        parser.error("--batch-size must be between 1 and 50")
    if not 1 <= args.max_batches <= 20:
        parser.error("--max-batches must be between 1 and 20")
    if not 1 <= args.feature_limit <= 50:
        parser.error("--feature-limit must be between 1 and 50")
    if not 1 <= args.max_candidates_per_kickoff <= 100:
        parser.error(
            "--max-candidates-per-kickoff must be between 1 and 100"
        )
    if not 1 <= args.dataset_limit <= 5_000:
        parser.error("--dataset-limit must be between 1 and 5000")
    return args


def _cycle_key(value: str | None) -> str:
    if value:
        return value
    local_day = datetime.now(
        ZoneInfo("America/Sao_Paulo")
    ).date().isoformat()
    return f"phase8g42:football:{local_day}"


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): (
                "[REDACTED]"
                if _SENSITIVE_KEY.search(str(key))
                else _redact(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value[:50]]
    if isinstance(value, str):
        return value[:1_000]
    return value


def _error_payload(error: Exception) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": type(error).__name__,
        "message": str(error)[:1_000],
    }
    if isinstance(error, HighlightlyRepositoryError):
        payload["http_status"] = error.status
        payload["body"] = _redact(error.body)
    return payload


def _emit(payload: dict[str, Any], output: Path | None) -> None:
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


def _summary(
    current: Any,
    *,
    batches_key: str,
) -> dict[str, Any]:
    if isinstance(current, dict):
        result = dict(current)
    else:
        result = {}
    result.setdefault(batches_key, [])
    if not isinstance(result[batches_key], list):
        result[batches_key] = []
    return result


def _finish_failed(
    repository: HighlightlyRepository,
    run_id: str | None,
    *,
    batches_completed: int,
    label_result: dict[str, Any],
    feature_result: dict[str, Any],
    cursor_state: dict[str, Any],
    error_payload: dict[str, Any],
) -> dict[str, Any] | None:
    if not run_id:
        return None
    try:
        return repository.rpc(
            "finish_highlightly_training_accumulation_cycle_v2",
            {
                "p_run_id": run_id,
                "p_status": "failed",
                "p_batches": batches_completed,
                "p_label_result": label_result,
                "p_feature_result": feature_result,
                "p_dataset_result": {},
                "p_readiness_result": {},
                "p_cursor_state": cursor_state,
                "p_error_summary": error_payload,
            },
        )
    except Exception as finish_error:  # defensive operational reporting
        return {
            "status": "finalization_failed",
            "error": _error_payload(finish_error),
        }


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    repository = HighlightlyRepository.from_environment()
    context = repository.ingestion_context("football")
    if context["provider"].get("enabled"):
        raise RuntimeError(
            "Highlightly provider must be disabled for accumulation"
        )

    cycle_key = _cycle_key(args.cycle_key)
    generated_at = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "event": "phase8g42_batched_training_accumulation",
        "quality_contract_version": "phase8g.4.3",
        "mode": "execute" if args.confirm_accumulate else "dry-run",
        "generated_at": generated_at.isoformat(),
        "cycle_key": cycle_key,
        "sport": "football",
        "limits": {
            "days": args.days,
            "batch_size": args.batch_size,
            "max_batches": args.max_batches,
            "feature_limit": args.feature_limit,
            "max_candidates_per_kickoff":
                args.max_candidates_per_kickoff,
            "dataset_limit": args.dataset_limit,
        },
        "provider_enabled": False,
        "provider_calls": 0,
        "stored_data_only": True,
        "cursor_pagination": True,
        "deterministic_rejections_excluded": True,
        "automatic_training": False,
        "automatic_predictions": False,
    }

    if not args.confirm_accumulate:
        payload["preview"] = repository.rpc(
            "get_highlightly_score_label_batch_preview_v1",
            {
                "p_days": args.days,
                "p_limit": args.batch_size,
                "p_before_at": None,
                "p_before_id": None,
            },
        )
        payload["report"] = repository.rpc(
            "get_highlightly_training_accumulation_report_v2",
            {"p_days": 30},
        )
        _emit(payload, args.output)
        return 0

    run_id: str | None = None
    batches_completed = 0
    cursor_state: dict[str, Any] = {}
    label_result: dict[str, Any] = {
        "batches": [],
        "candidates_considered": 0,
        "candidates_eligible": 0,
        "candidates_blocked": 0,
        "labels_inserted": 0,
        "labels_rejected": 0,
        "permanent_blockers_recorded": 0,
        "labels_skipped": 0,
    }
    feature_result: dict[str, Any] = {
        "batches": [],
        "kickoff_groups_processed": 0,
        "kickoff_groups_failed": 0,
        "labeled_snapshots_created": 0,
    }

    try:
        started = repository.rpc(
            "start_highlightly_training_accumulation_cycle_v2",
            {
                "p_cycle_key": cycle_key,
                "p_days": args.days,
                "p_batch_limit": args.batch_size,
                "p_feature_limit": args.feature_limit,
                "p_max_candidates_per_kickoff":
                    args.max_candidates_per_kickoff,
                "p_dataset_limit": args.dataset_limit,
                "p_max_batches": args.max_batches,
            },
        )
        run_id = str(started["run_id"])
        if started.get("idempotent") and started.get("status") != "running":
            payload["result"] = started
            payload["report"] = repository.rpc(
                "get_highlightly_training_accumulation_report_v2",
                {"p_days": 30},
            )
            _emit(payload, args.output)
            return 1 if started.get("status") == "failed" else 0

        batches_completed = int(started.get("batches_completed") or 0)
        cursor_state = (
            dict(started.get("cursor_state") or {})
            if isinstance(started.get("cursor_state"), dict)
            else {}
        )
        label_result = _summary(
            started.get("label_result") or label_result,
            batches_key="batches",
        )
        feature_result = _summary(
            started.get("feature_result") or feature_result,
            batches_key="batches",
        )
        for key in (
            "candidates_considered",
            "candidates_eligible",
            "candidates_blocked",
            "labels_inserted",
            "labels_rejected",
            "permanent_blockers_recorded",
            "labels_skipped",
        ):
            label_result.setdefault(key, 0)
        for key in (
            "kickoff_groups_processed",
            "kickoff_groups_failed",
            "labeled_snapshots_created",
        ):
            feature_result.setdefault(key, 0)

        while batches_completed < args.max_batches:
            before_at = cursor_state.get("kickoff_at")
            before_id = cursor_state.get("match_id")
            labels = repository.rpc(
                "materialize_highlightly_football_score_labels_v2",
                {
                    "p_days": args.days,
                    "p_limit": args.batch_size,
                    "p_before_at": before_at,
                    "p_before_id": before_id,
                },
            )
            considered = int(labels.get("candidates_considered") or 0)
            if considered == 0:
                cursor_state = {}
                break

            features = repository.rpc(
                "backfill_highlightly_football_labeled_features_v2",
                {
                    "p_limit": args.feature_limit,
                    "p_max_candidates_per_kickoff":
                        args.max_candidates_per_kickoff,
                },
            )
            label_result["batches"].append(labels)
            feature_result["batches"].append(features)
            for key in (
                "candidates_considered",
                "candidates_eligible",
                "candidates_blocked",
                "labels_inserted",
                "labels_rejected",
                "permanent_blockers_recorded",
                "labels_skipped",
            ):
                label_result[key] = int(label_result.get(key) or 0) + int(
                    labels.get(key) or 0
                )
            for key in (
                "kickoff_groups_processed",
                "kickoff_groups_failed",
                "labeled_snapshots_created",
            ):
                feature_result[key] = int(feature_result.get(key) or 0) + int(
                    features.get(key) or 0
                )

            batches_completed += 1
            next_cursor = labels.get("next_cursor")
            cursor_state = (
                dict(next_cursor)
                if isinstance(next_cursor, dict)
                else {}
            )
            repository.rpc(
                "checkpoint_highlightly_training_accumulation_cycle_v2",
                {
                    "p_run_id": run_id,
                    "p_batches": batches_completed,
                    "p_label_result": label_result,
                    "p_feature_result": feature_result,
                    "p_cursor_state": cursor_state,
                },
            )
            if not labels.get("has_more") or not cursor_state:
                break

        window_to = datetime.now(timezone.utc)
        window_from = window_to - timedelta(days=args.days)
        dataset_result = repository.rpc(
            "build_highlightly_football_training_dataset_v1",
            {
                "p_from": window_from.isoformat(),
                "p_to": window_to.isoformat(),
                "p_limit": args.dataset_limit,
            },
        )
        readiness_result = repository.rpc(
            "get_highlightly_training_readiness_report_v1",
            {"p_sport": "football", "p_days": args.days},
        )
        has_exceptions = (
            int(label_result.get("candidates_blocked") or 0) > 0
            or int(feature_result.get("kickoff_groups_failed") or 0) > 0
            or int(dataset_result.get("rows_blocked") or 0) > 0
        )
        status = (
            "completed_with_exceptions"
            if has_exceptions
            else "completed"
        )
        finalized = repository.rpc(
            "finish_highlightly_training_accumulation_cycle_v2",
            {
                "p_run_id": run_id,
                "p_status": status,
                "p_batches": batches_completed,
                "p_label_result": label_result,
                "p_feature_result": feature_result,
                "p_dataset_result": dataset_result,
                "p_readiness_result": readiness_result,
                "p_cursor_state": cursor_state,
                "p_error_summary": {},
            },
        )
        payload["result"] = {
            "cycle": finalized,
            "labels": label_result,
            "features": feature_result,
            "dataset": dataset_result,
            "readiness": readiness_result,
        }
        payload["report"] = repository.rpc(
            "get_highlightly_training_accumulation_report_v2",
            {"p_days": 30},
        )
        _emit(payload, args.output)
        return 0
    except Exception as error:
        error_payload = _error_payload(error)
        payload["error"] = error_payload
        payload["finalization"] = _finish_failed(
            repository,
            run_id,
            batches_completed=batches_completed,
            label_result=label_result,
            feature_result=feature_result,
            cursor_state=cursor_state,
            error_payload=error_payload,
        )
        _emit(payload, args.output)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
