from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from api.scraping_debug import ScraperDebugContext, extract_debug_metrics, is_debug_enabled, log_raw_debug


class ScrapingDebugTests(unittest.TestCase):
    def test_baseball_jobs_enable_debug_by_default(self) -> None:
        self.assertTrue(is_debug_enabled({"esporte": "Baseball"}))
        self.assertFalse(is_debug_enabled({"esporte": "Football"}))
        self.assertFalse(is_debug_enabled({"esporte": "Baseball", "debug": False}))

    def test_extract_debug_metrics_from_flashscore_payload(self) -> None:
        raw = {
            "_default": {
                "game-1": {
                    "url": "https://www.flashscore.com/match/baseball/a/b/odds/home-away/ft-including-ot/?mid=abc123",
                    "jogo": "A vs B",
                    "odds": {
                        "Home/Away": {
                            "Full Time": [
                                ["Book A", "A", "1.80", "B", "2.05"],
                                ["Book B", "A", "1.85", "B", "2.00"],
                            ]
                        }
                    },
                }
            }
        }
        normalized = {"linhas": [{"odd": 1.8}, {"odd": 2.05}]}

        metrics = extract_debug_metrics(raw, normalized)

        self.assertEqual(metrics["fixtures_encontrados"], 1)
        self.assertEqual(metrics["jogos_abertos"], 1)
        self.assertEqual(metrics["mercados_encontrados"], 1)
        self.assertEqual(metrics["bookmakers_encontrados"], 2)
        self.assertEqual(metrics["odds_extraidas"], 2)

    def test_log_raw_debug_writes_events_and_empty_fixture_html(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = ScraperDebugContext("job-1", Path(tmp), enabled=True)

            metrics = log_raw_debug(ctx, {"jogos": []}, {"linhas": []})

            self.assertEqual(metrics["fixtures_encontrados"], 0)
            events = (ctx.job_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertTrue(any(json.loads(line)["event"] == "fixtures_result" for line in events))
            self.assertTrue((ctx.html_dir / "fixtures_empty.html").exists())


if __name__ == "__main__":
    unittest.main()
