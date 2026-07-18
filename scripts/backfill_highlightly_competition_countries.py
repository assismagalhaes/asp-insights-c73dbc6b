"""Restore Highlightly competition countries from saved league catalog payloads.

The command is dry-run by default and never calls the Highlightly API. It reads
the private raw bucket through the ingestion bridge, keeps the newest catalog
record per provider league ID, and replays one canonical league batch.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from typing import Any
from urllib.parse import urlencode

from api.highlightly.normalizers.common import items, stable_id
from api.highlightly.registry import EndpointRegistry
from api.highlightly.worker import HighlightlyWorker
from api.highlightly_repository import HighlightlyRepository


ENDPOINT_KEY = "football.LeaguesController_getLeagues"


def _competition_rows(
    repository: HighlightlyRepository,
    competition_ids: list[str],
) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for start in range(0, len(competition_ids), 100):
        group = competition_ids[start : start + 100]
        in_filter = "(" + ",".join(group) + ")"
        path = "/rest/v1/sports_competitions?" + urlencode(
            [
                ("select", "id,name,country_id"),
                ("id", f"in.{in_filter}"),
                ("limit", str(len(group))),
            ]
        )
        for row in repository._request("GET", path, expected=(200,)):
            rows[str(row["id"])] = dict(row)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-raw-objects", type=int, default=200)
    parser.add_argument("--confirm-backfill", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.max_raw_objects <= 500:
        parser.error("--max-raw-objects must be between 1 and 500")

    repository = HighlightlyRepository.from_environment(timeout=120.0)
    context = repository.ingestion_context("football")
    provider = context["provider"]
    if provider.get("enabled"):
        raise RuntimeError("Highlightly provider must be disabled during raw country backfill")
    running = repository.select_rows("hl_ingestion_jobs", columns="id", filters={"status": "running"}, limit=1)
    if running:
        raise RuntimeError("An ingestion job is running; refusing concurrent raw country backfill")

    raw_rows = repository.select_rows(
        "hl_raw_objects",
        columns="id,storage_bucket,storage_path,content_encoding,sha256,request_metadata,created_at",
        filters={"endpoint_key": ENDPOINT_KEY},
        order="created_at.asc",
        limit=args.max_raw_objects,
    )
    if not raw_rows:
        raise RuntimeError("No saved Highlightly football league catalog payloads were found")

    newest_by_external_id: dict[str, dict[str, Any]] = {}
    source_by_external_id: dict[str, dict[str, Any]] = {}
    for raw in raw_rows:
        payload = repository.load_raw_payload(raw)
        for record in items(payload):
            external_id = record.get("id")
            country = record.get("country") if isinstance(record.get("country"), dict) else {}
            if external_id is None or not country or not (country.get("code") or country.get("name")):
                continue
            key = str(external_id)
            newest_by_external_id[key] = dict(record)
            source_by_external_id[key] = raw

    sport_id = str(context["sport"]["id"])
    provider_id = str(provider["id"])
    competition_ids = [
        stable_id(provider_id, sport_id, "competition", external_id)
        for external_id in newest_by_external_id
    ]
    before = _competition_rows(repository, competition_ids)
    missing_before = sorted(row_id for row_id, row in before.items() if not row.get("country_id"))
    usage_date = datetime.now(timezone.utc).date().isoformat()
    usage_before = repository.daily_request_usage(provider_id, usage_date)

    report: dict[str, Any] = {
        "mode": "execute" if args.confirm_backfill else "dry-run",
        "raw_objects": len(raw_rows),
        "catalog_leagues_with_country": len(newest_by_external_id),
        "existing_competitions": len(before),
        "missing_country_before": len(missing_before),
        "highlightly_requests_before": usage_before,
    }
    if not args.confirm_backfill:
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
        return 0

    latest_raw = max(source_by_external_id.values(), key=lambda row: str(row.get("created_at") or ""))
    operation = EndpointRegistry().get(ENDPOINT_KEY, sport="football")
    worker = HighlightlyWorker(object(), repository, worker_id="competition-country-raw-backfill", enabled=True)
    batch = worker.normalize_payload(
        {"data": list(newest_by_external_id.values())},
        operation=operation,
        provider_id=provider_id,
        sport_id=sport_id,
        request_params={},
        raw_object_id=str(latest_raw["id"]),
        captured_at=str(latest_raw.get("created_at") or datetime.now(timezone.utc).isoformat()),
        bookmakers=context["bookmakers"],
    )
    persisted = worker._persist(batch)

    after = _competition_rows(repository, competition_ids)
    missing_after = sorted(row_id for row_id, row in after.items() if not row.get("country_id"))
    usage_after = repository.daily_request_usage(provider_id, usage_date)
    provider_disabled = not bool(repository.ingestion_context("football")["provider"].get("enabled"))
    report.update(
        {
            "persisted_rows": persisted,
            "missing_country_after": len(missing_after),
            "unresolved_competition_ids": missing_after,
            "highlightly_requests_after": usage_after,
            "highlightly_requests_added": usage_after - usage_before,
            "provider_disabled_at_rest": provider_disabled,
        }
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
    return 1 if missing_after or usage_after != usage_before or not provider_disabled else 0


if __name__ == "__main__":
    raise SystemExit(main())
