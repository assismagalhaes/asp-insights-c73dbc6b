import hashlib
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "vendor" / "highlightly" / "openapi-6.13.2.json"
MANIFEST = CONTRACT.with_name("manifest.json")
REGISTRY = ROOT / "config" / "highlightly" / "endpoint-registry.json"
ENV_EXAMPLE = ROOT / "api" / "highlightly.env.example"


class HighlightlyPhaseZeroContractTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.registry = json.loads(REGISTRY.read_text(encoding="utf-8"))

    def test_frozen_contract_matches_manifest(self):
        payload = CONTRACT.read_bytes()
        self.assertEqual(self.manifest["version"], "6.13.2")
        self.assertEqual(self.manifest["bytes"], len(payload))
        self.assertEqual(self.manifest["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertTrue(self.manifest["immutable"])

    def test_registry_covers_every_v1_operation(self):
        operations = self.registry["operations"]
        counts = {
            sport: sum(item["sport"] == sport for item in operations)
            for sport in self.registry["sports"]
        }
        self.assertEqual(counts, {"football": 25, "baseball": 20, "basketball": 19})
        self.assertEqual(len(operations), 64)
        self.assertEqual(len({item["key"] for item in operations}), 64)

    def test_every_operation_has_an_executable_policy(self):
        for operation in self.registry["operations"]:
            with self.subTest(operation=operation["key"]):
                self.assertEqual(operation["method"], "GET")
                self.assertTrue(operation["path"].startswith(f"/{operation['sport']}/"))
                self.assertIn(operation["priority"], range(5))
                self.assertTrue(operation["cadence_policy"])
                self.assertTrue(operation["freshness_sla"])
                self.assertTrue(operation["normalizer"])
                self.assertTrue(operation["target_tables"])
                self.assertTrue(operation["raw_retention_class"])
                names = {item["name"] for item in operation["parameters"]}
                self.assertNotIn("x-rapidapi-key", names)
                self.assertNotIn("x-rapidapi-host", names)

    def test_feature_flag_and_example_are_off_by_default(self):
        self.assertEqual(
            self.registry["feature_flag"],
            {"name": "highlightly_analysis_enabled", "default": False},
        )
        values = {}
        for line in ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
        self.assertEqual(values["HIGHLIGHTLY_API_KEY"], "replace-at-deploy")
        self.assertEqual(values["HIGHLIGHTLY_ANALYSIS_ENABLED"], "false")
        self.assertEqual(values["VITE_HIGHLIGHTLY_ANALYSIS_ENABLED"], "false")

    def test_quota_budget_reconciles(self):
        quota = self.registry["quota"]
        allocated = quota["scheduled"] + quota["postmatch_backfill"] + quota["retry"] + quota["reserve"]
        self.assertEqual(allocated, quota["daily_limit"])
        self.assertGreaterEqual(quota["reserve"] / quota["daily_limit"], 0.10)


if __name__ == "__main__":
    unittest.main()
