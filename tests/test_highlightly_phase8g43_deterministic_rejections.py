from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/"
    "20260730151839_6318085a-d214-407a-8b6c-08771ec75259.sql"
)
SMOKE = (
    ROOT
    / "supabase/tests/"
    "highlightly_phase8g43_deterministic_rejections_smoke.sql"
)
RUNNER = ROOT / "scripts/run_highlightly_phase8g42_accumulator.py"


class HighlightlyPhase8G43DeterministicRejectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.smoke = SMOKE.read_text(encoding="utf-8")
        cls.runner = RUNNER.read_text(encoding="utf-8")

    def test_only_permanent_blockers_become_rejected_labels(self) -> None:
        match = re.search(
            r"WHERE source\.block_reason IN \((.*?)\)"
            r"\s+AND source\.terminal_observed_at",
            self.migration,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(match)
        permanent_reasons = match.group(1)
        self.assertIn(
            "terminal_state_requires_manual_review",
            permanent_reasons,
        )
        self.assertIn(
            "participant_identity_collision",
            permanent_reasons,
        )
        for transient_reason in (
            "participants_missing",
            "score_missing_or_invalid",
            "terminal_observation_missing",
        ):
            self.assertNotIn(transient_reason, permanent_reasons)

    def test_rejections_are_immutable_and_training_ineligible(self) -> None:
        self.assertIn("'rejected'", self.migration)
        self.assertIn(
            "'permanent_for_label_version', true",
            self.migration,
        )
        self.assertIn(
            "'rejected_labels_training_eligible', false",
            self.migration,
        )
        self.assertIn("quality_status = 'rejected'", self.migration)
        self.assertIn(
            "quality_status = ''valid''",
            self.smoke,
        )
        evaluator_start = self.migration.index(
            "public.evaluate_highlightly_football_training_dataset_v1"
        )
        evaluator = self.migration[evaluator_start:]
        self.assertLess(
            evaluator.index("label.quality_status = 'valid'"),
            evaluator.index("LIMIT p_limit"),
        )

    def test_runner_aggregates_rejection_observability(self) -> None:
        self.assertIn(
            '"quality_contract_version": "phase8g.4.3"',
            self.runner,
        )
        self.assertIn('"labels_rejected": 0', self.runner)
        self.assertIn('"permanent_blockers_recorded": 0', self.runner)
        self.assertIn(
            '"deterministic_rejections_excluded": True',
            self.runner,
        )

    def test_functions_remain_invoker_and_least_privilege(self) -> None:
        self.assertNotIn("SECURITY DEFINER", self.migration)
        self.assertGreaterEqual(
            self.migration.count("SECURITY INVOKER"),
            3,
        )
        self.assertIn(
            "FROM PUBLIC, anon, authenticated;",
            self.migration,
        )
        self.assertIn("TO service_role;", self.migration)
        self.assertIn("TO authenticated, service_role;", self.migration)
        self.assertIn("BEGIN;", self.smoke)
        self.assertIn("ROLLBACK;", self.smoke)


if __name__ == "__main__":
    unittest.main()
