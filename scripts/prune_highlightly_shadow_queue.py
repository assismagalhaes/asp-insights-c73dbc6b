"""Cancel only redundant pending jobs from one explicit Highlightly shadow scope."""

from __future__ import annotations

import argparse
from collections import Counter
import json

from api.highlightly_repository import HighlightlyRepository


REDUNDANT_ENDPOINTS = frozenset(
    {
        "football.FootballLastFiveGamesController_getLastFiveGames",
        "football.FootballHead2HeadController_getHead2HeadData",
        "football.HighlightsController_getHighlights",
        "football.PlayersController_getPlayerSummaryById",
        "football.PlayersController_getPlayerStatisticsById",
        "baseball.BaseballLastFiveGamesController_getLastFiveGames",
        "baseball.BaseballHead2HeadController_getHead2HeadData",
        "baseball.HighlightsController_getHighlights",
        "baseball.BaseballPlayersController_getPlayerSummaryById",
        "baseball.BaseballPlayersController_getPlayerStatisticsById",
        "basketball.BasketballLastFiveGamesController_getLastFiveGames",
        "basketball.BasketballHead2HeadController_getHead2HeadData",
        "basketball.HighlightsController_getHighlights",
    }
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    parser.add_argument("--confirm-prune", action="store_true")
    args = parser.parse_args()

    repository = HighlightlyRepository.from_environment()
    if repository.ingestion_context("football")["provider"].get("enabled"):
        raise RuntimeError("Highlightly provider is enabled; refusing queue pruning")

    running = repository.select_rows(
        "hl_ingestion_jobs",
        columns="id,endpoint_key,status",
        filters={"shadow_scope": args.scope, "status": "running"},
        limit=1,
    )
    if running:
        raise RuntimeError("A shadow job is running; refusing concurrent queue pruning")

    candidates: list[dict] = []
    for status in ("pending", "retry"):
        candidates.extend(
            repository.select_rows(
                "hl_ingestion_jobs",
                columns="id,endpoint_key,status",
                filters={"shadow_scope": args.scope, "status": status},
                limit=1501,
            )
        )
    selected = [row for row in candidates if str(row.get("endpoint_key")) in REDUNDANT_ENDPOINTS]
    breakdown = Counter(str(row["endpoint_key"]) for row in selected)
    report = {
        "scope": args.scope,
        "mode": "execute" if args.confirm_prune else "dry-run",
        "eligible": len(selected),
        "breakdown": dict(breakdown),
        "provider_disabled_at_rest": True,
    }
    if not args.confirm_prune:
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
        return 0

    cancelled = int(
        repository.rpc(
            "cancel_highlightly_redundant_shadow_jobs",
            {
                "p_scope": args.scope,
                "p_endpoint_keys": sorted(breakdown),
                "p_reason": "Cancelled by approved Phase 7 reduced fan-out profile",
            },
        )
        or 0
    )
    report["cancelled"] = cancelled
    report["provider_disabled_after"] = not bool(
        repository.ingestion_context("football")["provider"].get("enabled")
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    return 0 if cancelled == len(selected) and report["provider_disabled_after"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
