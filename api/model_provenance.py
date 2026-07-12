from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def single_input_model_provenance(
    script_response: dict[str, Any],
    *,
    raw_path: Path,
    input_path: Path,
    job_id: str,
) -> dict[str, Any]:
    supplied = script_response.get("provenance")
    if isinstance(supplied, dict) and supplied:
        return supplied
    return {
        "job_id": job_id,
        "sha256_raw": file_sha256(raw_path),
        "sha256_input": file_sha256(input_path),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
