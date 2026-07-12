from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from api.model_provenance import single_input_model_provenance


class ApiModelProvenanceTests(unittest.TestCase):
    def test_builds_single_input_fallback_without_packball_meta(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_path = root / "raw.json"
            input_path = root / "input.csv"
            raw_path.write_bytes(b'{"games": []}')
            input_path.write_bytes(b"game,odd\nA vs B,1.90\n")

            provenance = single_input_model_provenance(
                {}, raw_path=raw_path, input_path=input_path, job_id="job-123"
            )

            self.assertEqual(provenance["job_id"], "job-123")
            self.assertEqual(provenance["sha256_raw"], hashlib.sha256(raw_path.read_bytes()).hexdigest())
            self.assertEqual(provenance["sha256_input"], hashlib.sha256(input_path.read_bytes()).hexdigest())
            self.assertIn("+00:00", provenance["created_at"])
            self.assertNotIn("sha256_5", provenance)

    def test_preserves_runner_supplied_provenance(self) -> None:
        supplied = {"schema_hash": "abc", "created_at": "2026-07-12T17:00:00+00:00"}
        provenance = single_input_model_provenance(
            {"provenance": supplied},
            raw_path=Path("not-read.json"),
            input_path=Path("not-read.csv"),
            job_id="job-123",
        )
        self.assertIs(provenance, supplied)


if __name__ == "__main__":
    unittest.main()
