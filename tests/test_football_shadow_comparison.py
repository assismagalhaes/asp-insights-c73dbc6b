import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "modelos"
if str(MODELS) not in sys.path:
    sys.path.insert(0, str(MODELS))

from football_shadow_comparison import ShadowRunArtifact, compare_shadow_artifacts


def artifact(side="legacy", **overrides):
    values = {
        "side": side,
        "match_id": "match-1",
        "kickoff_at": "2026-09-21T20:00:00Z",
        "cutoff_at": "2026-09-21T19:00:00Z",
        "source_max_at": "2026-09-21T18:59:00Z",
        "input_manifest": {"snapshot": "abc", "rows": 12},
        "predictions": pd.DataFrame([{
            "mercado": "1x2", "pick": "home", "linha": None,
            "probabilidade_final": 55.0, "odd_valor": 1.82,
            "odd_ofertada": 1.95, "edge": 7.1, "decision": "eligible",
        }]),
    }
    values.update(overrides)
    return ShadowRunArtifact(**values)


class ShadowComparisonTests(unittest.TestCase):
    def test_equal_execution_is_deterministic(self):
        first = compare_shadow_artifacts(artifact(), artifact(side="canonical"))
        second = compare_shadow_artifacts(artifact(), artifact(side="canonical"))
        self.assertEqual(first, second)
        self.assertTrue(first["input"]["equal"])
        self.assertTrue(first["output"]["equal"])
        self.assertFalse(first["published"])

    def test_reports_probability_and_decision_changes(self):
        changed = artifact(
            side="canonical",
            predictions=pd.DataFrame([{
                "mercado": "1x2", "pick": "home", "linha": None,
                "probabilidade_final": 52.0, "odd_valor": 1.92,
                "odd_ofertada": 1.95, "edge": 1.6, "decision": "discarded",
            }]),
        )
        result = compare_shadow_artifacts(artifact(), changed)
        fields = result["output"]["differences"][0]["changed_fields"]
        self.assertEqual(set(fields), {"probabilidade_final", "odd_valor", "edge", "decision"})

    def test_blocks_different_cutoff(self):
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            compare_shadow_artifacts(
                artifact(),
                artifact(
                    side="canonical",
                    cutoff_at="2026-09-21T18:30:00Z",
                    source_max_at="2026-09-21T18:29:00Z",
                ),
            )

    def test_blocks_source_after_cutoff(self):
        with self.assertRaisesRegex(ValueError, "exceeds cutoff"):
            compare_shadow_artifacts(
                artifact(),
                artifact(side="canonical", source_max_at="2026-09-21T19:01:00Z"),
            )

    def test_blocks_provider_calls_and_publication(self):
        with self.assertRaisesRegex(ValueError, "must not call providers"):
            compare_shadow_artifacts(artifact(provider_calls=1), artifact(side="canonical"))
        with self.assertRaisesRegex(ValueError, "must not publish"):
            compare_shadow_artifacts(artifact(), artifact(side="canonical", published=True))


if __name__ == "__main__":
    unittest.main()
