"""Idempotently provision the private Highlightly raw bucket.

Required environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import json
import os

from api.highlightly_repository import HighlightlyRepository


def main() -> int:
    repository = HighlightlyRepository(
        os.environ.get("SUPABASE_URL", ""),
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    )
    result = repository.ensure_raw_bucket()
    print(
        json.dumps(
            {
                "bucket": result["bucket"],
                "created": result["created"],
                "updated": result.get("updated", False),
                "public": False,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
