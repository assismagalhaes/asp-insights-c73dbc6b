import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class HighlightlyPhaseFourContractTests(unittest.TestCase):
    def test_basketball_read_models_are_admin_gated_and_security_invoker(self):
        sql = (ROOT / "supabase/migrations/20260715200000_create_highlightly_basketball_read_models.sql").read_text(encoding="utf-8")
        self.assertIn("WITH (security_invoker = true)", sql)
        self.assertIn("SET search_path = ''", sql)
        self.assertIn("public.has_role(auth.uid(), 'admin'::public.app_role)", sql)
        self.assertIn("REVOKE ALL ON FUNCTION public.get_basketball_match_detail(uuid) FROM PUBLIC, anon", sql)
        self.assertIn("standing.quality_status = 'valid'", sql)
        self.assertIn("'moneyline', 'total', 'spread'", sql)

    def test_phase_four_smoke_is_transactional_and_keeps_provider_disabled(self):
        sql = (ROOT / "supabase/tests/highlightly_phase4_smoke.sql").read_text(encoding="utf-8")
        self.assertTrue(sql.lstrip().startswith("-- Transactional smoke"))
        self.assertIn("BEGIN;", sql)
        self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
        self.assertIn("sports_basketball_match_summary_v", sql)
        self.assertIn("Highlightly provider must remain disabled", sql)


if __name__ == "__main__":
    unittest.main()
