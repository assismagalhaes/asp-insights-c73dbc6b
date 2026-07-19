import unittest

from scripts.accept_highlightly_unavailable_odds import is_unavailable_sentinel


class AcceptHighlightlyUnavailableOddsTests(unittest.TestCase):
    def test_accepts_only_numeric_one_sentinel(self):
        self.assertTrue(is_unavailable_sentinel({"details": {"context": {"odd": 1}}}))
        self.assertTrue(is_unavailable_sentinel({"details": {"context": {"odd": "1.0"}}}))
        self.assertFalse(is_unavailable_sentinel({"details": {"context": {"odd": 0.9}}}))
        self.assertFalse(is_unavailable_sentinel({"details": {"context": {"odd": None}}}))
        self.assertFalse(is_unavailable_sentinel({"details": {}}))


if __name__ == "__main__":
    unittest.main()
