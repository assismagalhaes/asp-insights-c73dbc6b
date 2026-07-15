import io
import json
import unittest
from unittest.mock import patch

from api.highlightly_client import HighlightlyClient, HighlightlyError


class _Response:
    status = 200
    headers = {
        "Content-Type": "application/json",
        "X-RateLimit-Requests-Limit": "100",
        "X-RateLimit-Requests-Remaining": "99",
    }

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps({"data": []}).encode()


class HighlightlyClientTests(unittest.TestCase):
    @patch("api.highlightly_client.urlopen", return_value=_Response())
    def test_get_builds_direct_api_request_and_reads_quota(self, mocked_open):
        response = HighlightlyClient("secret").get("/football/matches", {"limit": 5, "unused": None})

        request = mocked_open.call_args.args[0]
        self.assertEqual(request.full_url, "https://sports.highlightly.net/football/matches?limit=5")
        self.assertEqual(request.headers["X-rapidapi-key"], "secret")
        self.assertTrue(request.headers["User-agent"].startswith("ASP-Insights/"))
        self.assertEqual(response.rate_limit, 100)
        self.assertEqual(response.rate_remaining, 99)

    def test_rejects_empty_key(self):
        with self.assertRaises(ValueError):
            HighlightlyClient("  ")


if __name__ == "__main__":
    unittest.main()
