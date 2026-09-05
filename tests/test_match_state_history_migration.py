from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260905014153_create_match_state_history.sql"


class MatchStateHistoryMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_history_is_immutable_and_service_role_only(self) -> None:
        self.assertIn("sports_match_state_history", self.sql)
        self.assertIn("ENABLE ROW LEVEL SECURITY", self.sql)
        self.assertIn(
            "REVOKE ALL ON TABLE public.sports_match_state_history FROM PUBLIC, anon, authenticated",
            self.sql,
        )
        self.assertNotIn("GRANT INSERT", self.sql)
        self.assertNotIn("GRANT UPDATE", self.sql)
        self.assertNotIn("GRANT DELETE", self.sql)
        self.assertIn("SECURITY INVOKER", self.sql)
        self.assertNotIn("SECURITY DEFINER", self.sql)

    def test_trigger_tracks_only_material_state_fields(self) -> None:
        self.assertIn(
            "AFTER UPDATE OF kickoff_at, status, provider_status, score_data, state_data",
            self.sql,
        )
        self.assertIn("AFTER INSERT", self.sql)
        self.assertIn("IS DISTINCT FROM NEW.kickoff_at", self.sql)
        self.assertIn("IS DISTINCT FROM NEW.status", self.sql)
        self.assertIn("IS DISTINCT FROM NEW.score_data", self.sql)
        self.assertNotIn("UPDATE OF updated_at", self.sql)

    def test_snapshots_are_idempotent(self) -> None:
        self.assertIn("UNIQUE (match_id, state_fingerprint)", self.sql)
        self.assertGreaterEqual(
            self.sql.count("ON CONFLICT (match_id, state_fingerprint) DO NOTHING"),
            2,
        )

    def test_baseline_is_explicitly_non_retrospective(self) -> None:
        self.assertIn("'migration_baseline'", self.sql)
        self.assertIn("is not retrospective history", self.sql)
        self.assertIn("not the provider event time", self.sql)

    def test_migration_does_not_invent_ended_at(self) -> None:
        self.assertNotIn("UPDATE public.sports_matches", self.sql)
        self.assertNotIn("SET ended_at", self.sql)


if __name__ == "__main__":
    unittest.main()
