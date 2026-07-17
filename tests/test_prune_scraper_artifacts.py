import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts.prune_scraper_artifacts import collect_candidates


class ScraperArtifactRetentionTests(unittest.TestCase):
    def test_completed_artifacts_expire_but_recent_and_failed_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "asp-scraper-api"
            for relative in ("jobs", "outputs/raw", "outputs/normalized", "outputs/exports"):
                (root / relative).mkdir(parents=True, exist_ok=True)
            now = datetime(2026, 7, 17, tzinfo=timezone.utc)
            old = (now - timedelta(days=100)).isoformat()
            recent = (now - timedelta(days=10)).isoformat()
            for job_id, status, created_at in (
                ("old-ok", "CONCLUIDA", old),
                ("recent-ok", "CONCLUIDA", recent),
                ("old-error", "ERRO", old),
            ):
                (root / "jobs" / f"{job_id}.json").write_text(
                    json.dumps({"job_id": job_id, "status": status, "created_at": created_at}),
                    encoding="utf-8",
                )
                (root / "outputs" / "raw" / f"{job_id}.json").write_text("{}", encoding="utf-8")

            candidates = collect_candidates(root, now)
            paths = {item.path.name for item in candidates}
            self.assertIn("old-ok.json", paths)
            self.assertNotIn("recent-ok.json", paths)
            self.assertNotIn("old-error.json", paths)


if __name__ == "__main__":
    unittest.main()
