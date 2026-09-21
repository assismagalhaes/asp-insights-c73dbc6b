from pathlib import Path


MIGRATION = Path(__file__).parents[1] / "supabase" / "migrations" / (
    "20260921184538_align_football_feature_market_families.sql"
)


def test_feature_builder_translates_normalized_market_families():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "WHEN 'moneyline' THEN 'full_time_result'" in sql
    assert "WHEN 'total' THEN 'total_goals'" in sql
    assert "WHEN 'handicap' THEN 'asian_handicap'" in sql
    assert "'moneyline', 'full_time_result'" in sql
    assert "'total', 'total_goals'" in sql
    assert "'handicap', 'asian_handicap'" in sql


def test_feature_builder_remains_invoker_only():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "SECURITY INVOKER" in sql
    assert "SECURITY DEFINER" not in sql
    assert "REVOKE ALL ON FUNCTION" in sql
    assert "TO service_role" in sql
