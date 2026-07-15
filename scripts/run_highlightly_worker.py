"""Run the Highlightly worker once or as a bounded polling process."""

from __future__ import annotations

import argparse
import json
import socket
import time

from api.highlightly.worker import HighlightlyWorker


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker-id", default=f"{socket.gethostname()}-highlightly")
    parser.add_argument("--max-jobs", type=int, default=1, help="Maximum claimed jobs before exit; 0 keeps polling")
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    args = parser.parse_args()
    if args.max_jobs < 0:
        parser.error("--max-jobs must be zero or greater")
    if args.poll_seconds < 0.5 or args.poll_seconds > 60:
        parser.error("--poll-seconds must be between 0.5 and 60")

    worker = HighlightlyWorker.from_environment(worker_id=args.worker_id)
    processed = 0
    while args.max_jobs == 0 or processed < args.max_jobs:
        result = worker.run_once()
        print(json.dumps(result.__dict__, ensure_ascii=False, default=str))
        if result.status == "disabled":
            return 2
        if result.status == "idle":
            if args.max_jobs:
                return 0
            time.sleep(args.poll_seconds)
            continue
        processed += 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
