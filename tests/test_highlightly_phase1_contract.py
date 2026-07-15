from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "supabase" / "migrations" / "20260714230000_create_highlightly_canonical_foundation.sql"
CONTROL = ROOT / "supabase" / "migrations" / "20260714231000_create_highlightly_ingestion_control.sql"
FUNCTIONS = ROOT / "supabase" / "migrations" / "20260714232000_create_highlightly_ingestion_functions.sql"


class HighlightlyPhaseOneContractTests(unittest.TestCase):
    def setUp(self):
        self.canonical = CANONICAL.read_text(encoding="utf-8")
        self.control = CONTROL.read_text(encoding="utf-8")
        self.functions = FUNCTIONS.read_text(encoding="utf-8")
        self.all_sql = "\n".join((self.canonical, self.control, self.functions))

    def test_foundation_tables_are_present(self):
        expected = {
            "sports_providers",
            "sports",
            "sports_countries",
            "sports_competitions",
            "sports_seasons",
            "sports_teams",
            "sports_players",
            "sports_bookmakers",
            "sports_matches",
            "sports_match_participants",
            "sports_match_period_scores",
            "sports_provider_entities",
            "hl_metric_definitions",
            "hl_ingestion_jobs",
            "hl_ingestion_runs",
            "hl_raw_objects",
            "hl_rate_limit_usage",
            "hl_data_quality_issues",
        }
        created = set(re.findall(r"CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+)", self.all_sql))
        self.assertTrue(expected.issubset(created), expected - created)

    def test_every_foreign_key_has_a_supporting_index(self):
        expected_index_fragments = {
            "sports_competitions": ("sport_id", "country_id"),
            "sports_seasons": ("competition_id",),
            "sports_teams": ("sport_id", "country_id"),
            "sports_players": ("sport_id", "current_team_id"),
            "sports_matches": ("sport_id", "competition_id", "season_id"),
            "sports_match_participants": ("match_id", "team_id"),
            "sports_match_period_scores": ("match_id", "team_id"),
            "sports_provider_entities": ("sport_id",),
            "hl_metric_definitions": ("sport_id",),
            "hl_ingestion_runs": ("job_id",),
            "hl_raw_objects": ("job_id", "run_id", "provider_id", "sport_id"),
            "hl_rate_limit_usage": ("run_id", "provider_id"),
            "hl_data_quality_issues": ("run_id", "raw_object_id"),
        }
        compact = re.sub(r"\s+", " ", self.all_sql)
        for table, columns in expected_index_fragments.items():
            for column in columns:
                with self.subTest(table=table, column=column):
                    self.assertRegex(
                        compact,
                        rf"CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [^ ]+ ON public\.{table} \([^)]*\b{column}\b",
                    )

    def test_queue_claim_is_atomic_and_skip_locked(self):
        self.assertIn("FOR UPDATE SKIP LOCKED", self.functions)
        self.assertIn("UPDATE public.hl_ingestion_jobs AS job", self.functions)
        self.assertIn("attempts = job.attempts + 1", self.functions)
        self.assertIn("lock_expires_at", self.functions)
        self.assertIn("ON CONFLICT (dedupe_key) DO UPDATE", self.functions)

    def test_queue_functions_are_service_role_only(self):
        for name in (
            "enqueue_highlightly_ingestion_job",
            "claim_highlightly_ingestion_job",
            "finish_highlightly_ingestion_job",
        ):
            with self.subTest(function=name):
                self.assertRegex(self.functions, rf"REVOKE ALL ON FUNCTION public\.{name}\(")
                self.assertRegex(
                    self.functions,
                    rf"GRANT EXECUTE ON FUNCTION public\.{name}\([\s\S]*?\)\s+TO service_role;",
                )

    def test_rls_is_admin_read_and_never_anon(self):
        for sql in (self.canonical, self.control):
            self.assertIn("ENABLE ROW LEVEL SECURITY", sql)
            self.assertIn("GRANT SELECT ON TABLE public.%I TO authenticated", sql)
            self.assertIn("GRANT ALL ON TABLE public.%I TO service_role", sql)
            self.assertIn("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated", sql)
            self.assertIn("public.has_role", sql)
        self.assertNotRegex(self.all_sql, r"GRANT\s+(?:SELECT|ALL).*\sTO\s+anon")

    def test_raw_bucket_is_private_and_has_no_client_write_policy(self):
        self.assertIn("'highlightly-raw'", self.control)
        self.assertRegex(self.control, r"'highlightly-raw',\s*'highlightly-raw',\s*false")
        self.assertIn("highlightly_raw_admin_read", self.control)
        self.assertNotRegex(self.control, r"CREATE POLICY highlightly_raw_.*(?:INSERT|UPDATE|DELETE)")

    def test_provider_and_rollout_are_seeded_disabled(self):
        self.assertIn("'highlightly', 'Highlightly'", self.canonical)
        self.assertIn("'6.13.2', false", self.canonical)
        for sport in ("football", "baseball", "basketball"):
            self.assertIn(f"('{sport}'", self.canonical)


if __name__ == "__main__":
    unittest.main()
