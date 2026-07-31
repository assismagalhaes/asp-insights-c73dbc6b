from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260731165026_63ad5557-e12b-482e-8ba2-7961f089e95d.sql"
DOC = ROOT / "docs/highlightly/phase-8h0-current-model-input-contracts.md"


def test_phase8h01_has_four_versioned_contracts() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    for key in ("asp_matchmatrix_v1", "asp_diamond_v1", "asp_court_v1", "asp_court_w_v1"):
        assert key in sql
    for version in ("FOOTBALL_V1_5", "MLB_V2_1_TEMPORAL_UNCERTAINTY", "BASKETBALL_WNBA_V2_2_ROBUST_GATES"):
        assert version in sql


def test_phase8h01_is_sealed_rls_and_admin_only() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    assert sql.count("ENABLE ROW LEVEL SECURITY") == 5
    assert "sealed model input builds are immutable" in sql
    assert "children of sealed model input builds are immutable" in sql
    assert sql.count("REFERENCES public.model_input_matches(build_id, match_id)") == 2
    assert "extensions.digest" in sql
    assert "SECURITY DEFINER" in sql
    assert "SET search_path = ''" in sql
    assert "REVOKE ALL ON FUNCTION public.create_model_input_build_v1" in sql
    assert "FROM PUBLIC, anon" in sql


def test_phase8h0_document_keeps_history_outside_daily_payload() -> None:
    text = DOC.read_text(encoding="utf-8")
    assert "collection_long_v1" in text
    assert "model_wide_v1" in text
    assert "cutoff strictly before the target match date" in text
    assert "does not execute a model" in text
