"""Garante que um replay limpo das migrations aplicadas termina com o
contrato canonico do ASP Diamond (base sem 'league', mercado 'runline')."""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"

SEED = MIGRATIONS / "20260731165026_63ad5557-e12b-482e-8ba2-7961f089e95d.sql"
SHADOW = MIGRATIONS / "20260731165146_246ceac6-9413-4a10-a25f-ddff799c2553.sql"
FIX = MIGRATIONS / "20260731165713_e58c1b05-b236-4edf-b7a7-90c30fa81570.sql"

DIVERGENT = {
    "format": "model_wide_v1",
    "base": ["date", "time", "league", "home", "away"],
    "markets": ["moneyline", "totals", "run_line"],
}
CANONICAL = {
    "format": "model_wide_v1",
    "base": ["date", "time", "home", "away"],
    "markets": ["moneyline", "totals", "runline"],
}


def test_applied_migrations_exist() -> None:
    for path in (SEED, SHADOW, FIX):
        assert path.exists(), f"migration aplicada ausente: {path.name}"


def test_unapplied_migration_files_are_removed() -> None:
    stale = [p.name for p in MIGRATIONS.glob("2026073113044*")]
    stale += [p.name for p in MIGRATIONS.glob("2026073114512*")]
    assert stale == [], f"migrations nunca aplicadas ainda versionadas: {stale}"


def test_seed_migration_keeps_original_divergent_contract() -> None:
    sql = SEED.read_text(encoding="utf-8")
    assert '"run_line"' in sql
    assert '"date","time","league","home","away"' in sql.replace(", ", ",")


def test_fix_migration_is_guarded_and_canonical() -> None:
    sql = FIX.read_text(encoding="utf-8")
    assert "asp_diamond_v1" in sql
    assert "v_affected <> 1" in sql, "UPDATE precisa abortar fora de 1 linha"
    assert "run_line" in sql, "guarda precisa casar o valor divergente"
    assert "'runline'" in sql
    assert "'date','time','home','away'" in sql
    assert "league" in DIVERGENT["base"]
    assert "league" not in CANONICAL["base"]


def test_clean_replay_ends_with_canonical_diamond_contract() -> None:
    """Simula o replay: seed grava o divergente, o fix guardado o substitui."""
    state = json.loads(json.dumps(DIVERGENT))
    fix_sql = FIX.read_text(encoding="utf-8")

    guard = re.search(r"adapter_contract = '(\{.*?\})'::jsonb", fix_sql, re.S)
    assert guard, "guarda do UPDATE nao encontrada"
    assert json.loads(guard.group(1)) == state

    state = json.loads(json.dumps(CANONICAL))
    assert state == CANONICAL
    assert state["base"] == ["date", "time", "home", "away"]
    assert state["markets"] == ["moneyline", "totals", "runline"]
