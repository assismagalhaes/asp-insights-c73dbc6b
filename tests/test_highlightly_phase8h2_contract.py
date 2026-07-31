from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260731165146_246ceac6-9413-4a10-a25f-ddff799c2553.sql"
SMOKE = ROOT / "supabase/tests/highlightly_phase8h2_football_shadow_smoke.sql"
API = ROOT / "api/main.py"
BRIDGE = ROOT / "src/lib/highlightly-ingest-bridge.server.ts"


def test_phase8h2_is_shadow_only_and_immutable() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "CHECK (run_mode = 'shadow')" in sql
    assert "CHECK (NOT automatic_publication)" in sql
    assert "football shadow runs are immutable" in sql
    assert "SECURITY INVOKER" in sql
    assert "FROM PUBLIC, anon, authenticated" in sql


def test_phase8h2_selects_consensus_with_quorum_and_no_live_odds() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "consensus.bookmaker_count >= 2" in sql
    assert "NOT consensus.is_live" in sql
    assert "definition.odds_type = 'prematch'" in sql
    assert "America/Sao_Paulo" in sql


def test_phase8h2_api_never_calls_prediction_publication() -> None:
    source = API.read_text(encoding="utf-8")
    endpoint = source[source.index('@app.post("/modelos/futebol/shadow-central")'):source.index('@app.post("/modelos/futebol/iniciar")')]
    assert '"automatic_publication": False' in endpoint
    assert "prognosticos.insert" not in endpoint
    assert "publicar" not in endpoint.casefold()


def test_phase8h2_smoke_checks_rls_and_least_privilege() -> None:
    smoke = SMOKE.read_text(encoding="utf-8")
    assert "must have RLS" in smoke
    assert "grants are too broad" in smoke
    assert "SECURITY INVOKER" in smoke


def test_phase8h2_bridge_allows_only_the_required_model_input_rpcs() -> None:
    bridge = BRIDGE.read_text(encoding="utf-8")
    for rpc in (
        "get_football_model_input_candidates_v1",
        "create_model_input_build_v1",
        "record_football_shadow_run_v1",
    ):
        assert bridge.count(f'"{rpc}"') == 1
    assert '"publish_football_predictions_v1"' not in bridge
