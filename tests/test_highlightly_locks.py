import unittest
from datetime import datetime, timedelta, timezone

from api.highlightly_locks import running_lock_blocks_start


class HighlightlyLockTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 7, 22, 0, 15, tzinfo=timezone.utc)

    def test_unexpired_running_lock_blocks_start(self):
        row = {
            "status": "running",
            "lock_expires_at": (self.now + timedelta(seconds=30)).isoformat(),
        }
        self.assertTrue(running_lock_blocks_start(row, now=self.now))

    def test_expired_running_lock_is_reclaimable(self):
        row = {
            "status": "running",
            "lock_expires_at": (self.now - timedelta(seconds=1)).isoformat(),
        }
        self.assertFalse(running_lock_blocks_start(row, now=self.now))

    def test_missing_or_malformed_lease_blocks_conservatively(self):
        self.assertTrue(running_lock_blocks_start({"status": "running"}, now=self.now))
        self.assertTrue(
            running_lock_blocks_start(
                {"status": "running", "lock_expires_at": "not-a-timestamp"},
                now=self.now,
            )
        )

    def test_non_running_job_never_blocks_start(self):
        self.assertFalse(
            running_lock_blocks_start(
                {"status": "retry", "lock_expires_at": self.now.isoformat()},
                now=self.now,
            )
        )


if __name__ == "__main__":
    unittest.main()
