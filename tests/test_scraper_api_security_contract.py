from __future__ import annotations

import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ScraperApiSecurityContractTests(unittest.TestCase):
    def test_scraper_api_key_has_no_fallback_value(self) -> None:
        tree = ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
        assignments = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "API_KEY" for target in node.targets)
        ]
        self.assertEqual(len(assignments), 1)
        source = ast.unparse(assignments[0].value)
        self.assertIn("os.getenv('SCRAPER_API_KEY', '')", source)
        self.assertNotIn("asp-teste-123", source)

    def test_missing_scraper_api_key_fails_closed(self) -> None:
        source = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
        self.assertIn("if not API_KEY:", source)
        self.assertIn('status_code=503, detail="SCRAPER_API_KEY não configurada"', source)


if __name__ == "__main__":
    unittest.main()
