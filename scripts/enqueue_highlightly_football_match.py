"""Queue one bounded Football match for the Phase 2 shadow vertical slice."""

from __future__ import annotations

import argparse
import json
from api.highlightly_repository import HighlightlyRepository


ENDPOINT = "football.MatchesController_getMatchById"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("match_id", help="Highlightly Football match id")
    parser.add_argument("--fanout", action="store_true", help="Queue every related match analysis endpoint after match discovery")
    args = parser.parse_args()

    repository = HighlightlyRepository.from_environment()
    job = repository.enqueue_job(
        endpoint_key=ENDPOINT,
        sport="football",
        resource="matches",
        dedupe_key=f"shadow:football:match:{args.match_id}:6.13.2",
        request_params={"id": args.match_id, "_fanout": args.fanout},
        priority=0,
    )
    print(json.dumps({"job_id": job.get("id"), "match_id": args.match_id, "fanout": args.fanout}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
