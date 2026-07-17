from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class HighlightlyBridgeContractTests(unittest.TestCase):
    def test_route_keeps_service_role_server_side_and_claims_nonce(self):
        route = (ROOT / "src/routes/api/public/hooks/highlightly-ingest.ts").read_text(encoding="utf-8")
        self.assertIn('process.env.SUPABASE_SERVICE_ROLE_KEY', route)
        self.assertIn('process.env.HIGHLIGHTLY_INGEST_BRIDGE_SECRET', route)
        self.assertIn('claim_highlightly_ingestion_bridge_nonce', route)
        self.assertNotIn('SUPABASE_PUBLISHABLE_KEY', route)
        self.assertNotIn('x-highlightly-forward-authorization', route)
        self.assertIn('AbortSignal.timeout(SUPABASE_UPSTREAM_TIMEOUT_MS)', route)

    def test_verifier_uses_constant_time_hmac_and_explicit_allowlists(self):
        verifier = (ROOT / "src/lib/highlightly-ingest-bridge.server.ts").read_text(encoding="utf-8")
        self.assertIn('createHmac("sha256"', verifier)
        self.assertIn('timingSafeEqual', verifier)
        self.assertIn('HIGHLIGHTLY_BRIDGE_TABLES', verifier)
        self.assertIn('HIGHLIGHTLY_BRIDGE_RPCS', verifier)
        self.assertIn('"refresh_sports_odds_consensus"', verifier)
        self.assertIn('"sports_player_box_scores"', verifier)
        self.assertIn('"hl_shadow_observations"', verifier)
        self.assertIn('"hl_phase7_window_health_v"', verifier)
        self.assertIn('"refresh_highlightly_shadow_observation"', verifier)
        self.assertIn('"cancel_highlightly_redundant_shadow_jobs"', verifier)
        self.assertIn('/storage/v1/object/highlightly-raw/', verifier)

    def test_nonce_rpc_is_service_role_only(self):
        migration = (
            ROOT
            / "supabase/migrations/20260715180000_create_highlightly_ingestion_bridge_nonces.sql"
        ).read_text(encoding="utf-8")
        self.assertIn("security definer", migration.casefold())
        self.assertIn("set search_path = ''", migration)
        self.assertIn("on conflict (nonce) do nothing", migration.casefold())
        self.assertIn("from public, anon, authenticated", migration.casefold())
        self.assertIn("to service_role", migration.casefold())


if __name__ == "__main__":
    unittest.main()
