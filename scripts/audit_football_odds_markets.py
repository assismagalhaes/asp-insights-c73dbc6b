"""Audit archived Highlightly football odds without calling the provider.

The report distinguishes what the provider returned from what the canonical
collection policy accepted.  It intentionally reports aggregates only: raw
payloads, credentials and request metadata are never printed.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.highlightly.collection_policy import (
    allows_canonical_odds,
    canonical_odds_rejection_reason,
)
from api.highlightly.normalizers.common import items
from api.highlightly.normalizers.football import _bookmaker_token, _market_family
from api.highlightly_repository import HighlightlyRepository


ODDS_ENDPOINT = "football.FootballOddsController_getOddsV2"
TARGET_FAMILIES = {
    "moneyline",
    "total",
    "both_teams_to_score",
    "double_chance",
    "handicap",
}


def summarize_payloads(payloads: Iterable[Any]) -> dict[str, Any]:
    raw_families: Counter[str] = Counter()
    eligible_families: Counter[str] = Counter()
    raw_market_names: Counter[str] = Counter()
    eligible_market_names: Counter[str] = Counter()
    raw_bookmakers: Counter[str] = Counter()
    rejection_reasons: Counter[str] = Counter()
    odds_types: Counter[str] = Counter()
    match_ids: set[str] = set()
    selection_quotes = 0
    market_blocks = 0

    for payload in payloads:
        for record in items(payload):
            match_external = record.get("matchId")
            if match_external is not None:
                match_ids.add(str(match_external))
            markets = record.get("odds")
            if not isinstance(markets, list):
                continue
            for market in markets:
                if not isinstance(market, Mapping):
                    continue
                market_blocks += 1
                market_name = str(market.get("market") or "unknown")
                family = _market_family(market_name)
                bookmaker = _bookmaker_token(
                    market.get("bookmakerName")
                    or market.get("bookmakerId")
                    or "unknown"
                )
                odds_type = str(market.get("type") or "unknown").casefold()
                if odds_type not in {"prematch", "live"}:
                    odds_type = "unknown"

                raw_families[family] += 1
                raw_market_names[market_name] += 1
                raw_bookmakers[bookmaker] += 1
                odds_types[odds_type] += 1
                values = market.get("values")
                if isinstance(values, list):
                    selection_quotes += len(values)

                reason = canonical_odds_rejection_reason(
                    "football", bookmaker, family, odds_type
                )
                if reason:
                    rejection_reasons[reason] += 1
                if allows_canonical_odds(
                    "football", bookmaker, family, odds_type
                ):
                    eligible_families[family] += 1
                    eligible_market_names[market_name] += 1

    target_presence = {
        family: {
            "raw_market_blocks": raw_families[family],
            "eligible_market_blocks": eligible_families[family],
            "status": "present" if eligible_families[family] else "not_observed",
        }
        for family in sorted(TARGET_FAMILIES)
    }
    return {
        "contract": "highlightly_football_odds_archive_audit@1.0.0",
        "provider_calls": 0,
        "published": False,
        "distinct_matches": len(match_ids),
        "market_blocks": market_blocks,
        "selection_quotes": selection_quotes,
        "target_presence": target_presence,
        "raw_families": raw_families.most_common(),
        "eligible_families": eligible_families.most_common(),
        "eligible_market_names": eligible_market_names.most_common(),
        "raw_bookmakers": raw_bookmakers.most_common(),
        "odds_types": odds_types.most_common(),
        "rejection_reasons": rejection_reasons.most_common(),
        "raw_market_names": raw_market_names.most_common(),
    }


def audit_archive(limit: int) -> dict[str, Any]:
    repository = HighlightlyRepository.from_environment()
    raw_objects = repository.select_rows(
        "hl_raw_objects",
        columns=(
            "id,created_at,endpoint_key,request_metadata,response_metadata,"
            "storage_bucket,storage_path,content_encoding,sha256"
        ),
        filters={"endpoint_key": ODDS_ENDPOINT},
        limit=limit,
        order="created_at.desc",
    )
    payloads = []
    load_errors = 0
    for raw_object in raw_objects:
        try:
            payloads.append(repository.load_raw_payload(raw_object))
        except Exception:  # aggregate evidence; never print storage/auth details
            load_errors += 1
    report = summarize_payloads(payloads)
    report["raw_objects_requested"] = limit
    report["raw_objects_found"] = len(raw_objects)
    report["raw_objects_loaded"] = len(payloads)
    report["raw_object_load_errors"] = load_errors
    report["newest_raw_object_at"] = raw_objects[0]["created_at"] if raw_objects else None
    report["oldest_raw_object_at"] = raw_objects[-1]["created_at"] if raw_objects else None
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.limit < 1 or args.limit > 1000:
        parser.error("--limit must be between 1 and 1000")
    report = audit_archive(args.limit)
    rendered = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(rendered)
    print(rendered, end="")


if __name__ == "__main__":
    main()
