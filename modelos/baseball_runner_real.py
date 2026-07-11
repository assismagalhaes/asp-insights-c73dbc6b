from __future__ import annotations

import csv
import json
import math
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

HIST_DIR = Path(os.getenv("BASEBALL_HIST_DIR", "/home/ubuntu/jupyter/dados_baseball"))

MODEL_VERSION = "MLB_V2_0"
BASEBALL_MLB_HANDICAP_MODEL_VERSION = "MLB_V2_1_HANDICAP_NB_SHADOW"
HANDICAP_ENABLED_MLB_V1_1 = False
HANDICAP_CONTROLLED_ACTIVATION_MLB_V1_1 = False
HANDICAP_SHADOW_ENABLED = True
HANDICAP_SELECTED_CONTROLLED = "HANDICAP_SELECTED_CONTROLLED"
HISTORICAL_PRIOR = 0.50
HISTORICAL_PRIOR_STRENGTH = 10.0
OVERCONFIDENCE_PROB_CUTOFF = 0.70

TEMPORAL_WEIGHTS = {"current": 0.55, "recent": 0.30, "previous": 0.15}
RECENT_GAMES_WINDOW = 15
RECENT_HALF_LIFE_GAMES = 7.0
MLB_LEAGUE_RUNS_PRIOR = 4.50
LEAGUE_PRIOR_STRENGTH = 20.0
HOME_RUN_FACTOR = 1.025
AWAY_RUN_FACTOR = 0.975
RUNS_OVERDISPERSION = 0.08
MAX_DISTRIBUTION_RUNS = 40
MIN_EDGE_MONEYLINE = 5.0
MIN_EDGE_TOTALS = 4.0
MAX_MARKET_SELECTIONS_PER_GAME = 3
CALIBRATION_PATH = Path(os.getenv("MLB_CALIBRATION_PATH", Path(__file__).with_name("mlb_calibration.json")))

PROB_ML_WEIGHTS = {"vit": 0.15, "sim": 0.35, "vig": 0.50}
PROB_OU_WEIGHTS = {"hist": 0.20, "sim": 0.30, "vig": 0.50}
PROB_HC_WEIGHTS = {"hist": 0.25, "sim": 0.45, "vig": 0.30}
HANDICAP_WEIGHTS = PROB_HC_WEIGHTS
HANDICAP_ALLOWED_LINES = {-2.5, -1.5, 1.5, 2.5}
HANDICAP_MIN_PROB = 0.525
HANDICAP_MAX_PROB = 0.685
HANDICAP_MIN_EDGE = 3.0
HANDICAP_AUDIT_PATH = Path(".codex_tmp/mlb_handicap_v1_1_shadow_audit.csv")

MLB_TEAMS = {
    "Arizona Diamondbacks": "ARI",
    "Atlanta Braves": "ATL",
    "Baltimore Orioles": "BAL",
    "Boston Red Sox": "BOS",
    "Chicago Cubs": "CHC",
    "Chicago White Sox": "CHW",
    "Cincinnati Reds": "CIN",
    "Cleveland Guardians": "CLE",
    "Colorado Rockies": "COL",
    "Detroit Tigers": "DET",
    "Houston Astros": "HOU",
    "Kansas City Royals": "KCR",
    "Los Angeles Angels": "LAA",
    "Los Angeles Dodgers": "LAD",
    "Miami Marlins": "MIA",
    "Milwaukee Brewers": "MIL",
    "Minnesota Twins": "MIN",
    "New York Mets": "NYM",
    "New York Yankees": "NYY",
    "Athletics": "ATH",
    "Philadelphia Phillies": "PHI",
    "Pittsburgh Pirates": "PIT",
    "San Diego Padres": "SDP",
    "San Francisco Giants": "SFG",
    "Seattle Mariners": "SEA",
    "St. Louis Cardinals": "STL",
    "St Louis Cardinals": "STL",
    "St.Louis Cardinals": "STL",
    "Tampa Bay Rays": "TBR",
    "Texas Rangers": "TEX",
    "Toronto Blue Jays": "TOR",
    "Washington Nationals": "WSN",
}

MLB_DIVISIONS = {
    "AL East": ["NYY", "BOS", "TOR", "TBR", "BAL"],
    "AL Central": ["CLE", "DET", "KCR", "MIN", "CHW"],
    "AL West": ["HOU", "SEA", "TEX", "LAA", "ATH"],
    "NL East": ["ATL", "PHI", "NYM", "MIA", "WSN"],
    "NL Central": ["CHC", "MIL", "STL", "CIN", "PIT"],
    "NL West": ["LAD", "SDP", "SFG", "ARI", "COL"],
}

MLB_TEAM_DIVISION = {sigla: division for division, teams in MLB_DIVISIONS.items() for sigla in teams}


@dataclass
class TeamStats:
    sigla: str
    games: int
    avg_for: float
    avg_against: float
    win_rate: float
    last5_for: float
    last5_against: float
    streak: int
    current_rows: list[dict[str, str]]
    previous_rows: list[dict[str, str]]
    all_rows: list[dict[str, str]]
    temporal_for: float | None = None
    temporal_against: float | None = None
    current_games: int = 0
    previous_games: int = 0
    cutoff_date: str | None = None


def main() -> None:
    if len(sys.argv) != 3:
        emit({"ok": False, "erro": "Uso inválido", "detalhe": "python3 baseball_runner_real.py CSV_COLETA_PATH OUTPUT_PATH"})
        return

    csv_coleta_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    try:
        games = preparar_jogos_baseball(csv_coleta_path)
        if not games:
            emit(
                {
                    "ok": True,
                    "modelo": "Baseball",
                    "arquivo_saida": str(output_path),
                    "arquivo_contexto": None,
                    "total_prognosticos": 0,
                    "contexto_modelo": "CSV da coleta não trouxe jogos Baseball/MLB válidos.",
                    "dados_tecnicos": "Nenhuma linha Baseball/MLB encontrada no CSV long da coleta.",
                    "mensagem": "Nenhuma oportunidade EV+ encontrada para os filtros atuais.",
                    "prognosticos": [],
                }
            )
            return

        season = infer_season(games)
        stats_cache: dict[tuple[str, str], TeamStats] = {}
        prognosticos: list[dict[str, Any]] = []
        context_parts: list[str] = []
        handicap_audit_rows: list[dict[str, Any]] = []

        for game in games:
            home = game["home"]
            away = game["away"]
            home_sigla = team_sigla(home)
            away_sigla = team_sigla(away)
            if not home_sigla or not away_sigla:
                raise RuntimeError(f"Não foi possível mapear times MLB: {home} vs {away}")

            cutoff_date = normalize_date(game.get("data"))
            home_stats = stats_cache.setdefault(
                (home_sigla, cutoff_date), load_team_stats(home_sigla, season, cutoff_date=cutoff_date)
            )
            away_stats = stats_cache.setdefault(
                (away_sigla, cutoff_date), load_team_stats(away_sigla, season, cutoff_date=cutoff_date)
            )
            league_runs = load_league_average_runs(season, cutoff_date)
            game_context = build_game_context(game, home_stats, away_stats, season)
            context_parts.append(game_context)
            prognosticos.extend(
                generate_game_picks(
                    game,
                    home_stats,
                    away_stats,
                    game_context,
                    handicap_audit_rows,
                    league_runs=league_runs,
                )
            )

        write_output_csv(output_path, prognosticos)
        write_handicap_audit_csv(HANDICAP_AUDIT_PATH, handicap_audit_rows)
        handicap_shadow_diagnostics = build_handicap_shadow_diagnostics(handicap_audit_rows)
        contexto_modelo = "\n\n".join(context_parts[:20])
        emit(
            {
                "ok": True,
                "modelo": "Baseball",
                "arquivo_saida": str(output_path),
                "arquivo_contexto": None,
                "total_prognosticos": len(prognosticos),
                "contexto_modelo": contexto_modelo,
                "dados_tecnicos": contexto_modelo,
                "mensagem": None if prognosticos else "Nenhuma oportunidade EV+ encontrada para os filtros atuais.",
                "prognosticos": prognosticos,
                "handicap_shadow_diagnostics": handicap_shadow_diagnostics,
            }
        )
    except Exception as exc:  # noqa: BLE001 - runner must serialize failures to API.
        emit({"ok": False, "erro": str(exc), "detalhe": f"csv={csv_coleta_path} output={output_path}"})


def preparar_jogos_baseball(csv_coleta_path: Path) -> list[dict[str, Any]]:
    if not csv_coleta_path.exists():
        raise RuntimeError(f"CSV de coleta não encontrado: {csv_coleta_path}")

    grouped: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    with csv_coleta_path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            esporte = clean(row.get("esporte"))
            liga = clean(row.get("liga"))
            if "baseball" not in esporte.lower():
                continue
            if liga and "mlb" not in liga.lower():
                continue

            home = clean(row.get("mandante"))
            away = clean(row.get("visitante"))
            if not home or not away:
                continue
            data = normalize_date(row.get("data"))
            hora = normalize_time(row.get("hora"))
            jogo = clean(row.get("jogo")) or f"{home} vs {away}"
            key = (data, hora, home, away, jogo)
            game = grouped.setdefault(
                key,
                {
                    "data": data,
                    "hora": hora,
                    "date": data,
                    "time": hora,
                    "home": home,
                    "away": away,
                    "jogo": jogo,
                    "liga": liga or "MLB",
                    "moneyline": {},
                    "totals": defaultdict(dict),
                    "handicaps": defaultdict(dict),
                    "wide": {"date": data, "time": hora, "home": home, "away": away},
                },
            )
            add_odd_to_game(game, row)

    return list(grouped.values())


def add_odd_to_game(game: dict[str, Any], row: dict[str, Any]) -> None:
    mercado = normalize_key(row.get("mercado"))
    pick = clean(row.get("pick"))
    linha = parse_float(row.get("linha"))
    quote = build_odds_quote(row)
    if not quote:
        return

    home = game["home"]
    away = game["away"]
    pick_key = normalize_key(pick)
    line_key = format_line(linha)

    if any(token in mercado for token in ("moneyline", "homeaway", "vencedor")):
        if is_pick_team(pick, home):
            set_best_quote(game["moneyline"], "home", quote)
            game["wide"]["odds_HomeAway_FT_including_OT_1"] = quote_offered(game["moneyline"]["home"])
            game["wide"]["odds_HomeAway_FT_including_OT_1_MEDIANA"] = quote_consensus(game["moneyline"]["home"])
        elif is_pick_team(pick, away):
            set_best_quote(game["moneyline"], "away", quote)
            game["wide"]["odds_HomeAway_FT_including_OT_2"] = quote_offered(game["moneyline"]["away"])
            game["wide"]["odds_HomeAway_FT_including_OT_2_MEDIANA"] = quote_consensus(game["moneyline"]["away"])
        return

    if any(token in mercado for token in ("overunder", "totaldecorridas", "totalruns", "total")) and linha is not None:
        if "over" in pick_key:
            set_best_quote(game["totals"][line_key], "over", quote)
            game["wide"][f"odds_OverUnder_FT_including_OT_{line_key}_Over"] = quote_offered(game["totals"][line_key]["over"])
            game["wide"][f"odds_OverUnder_FT_including_OT_{line_key}_Over_MEDIANA"] = quote_consensus(game["totals"][line_key]["over"])
        elif "under" in pick_key:
            set_best_quote(game["totals"][line_key], "under", quote)
            game["wide"][f"odds_OverUnder_FT_including_OT_{line_key}_Under"] = quote_offered(game["totals"][line_key]["under"])
            game["wide"][f"odds_OverUnder_FT_including_OT_{line_key}_Under_MEDIANA"] = quote_consensus(game["totals"][line_key]["under"])
        return

    if any(token in mercado for token in ("handicap", "runline", "asian")) and linha is not None:
        side = "home" if is_pick_team(pick, home) else "away" if is_pick_team(pick, away) else None
        if not side:
            return
        key = format_signed_line(linha)
        set_best_quote(game["handicaps"][key], side, quote)
        game["handicaps"][key][f"{side}_line"] = linha


def build_odds_quote(row: dict[str, Any]) -> dict[str, Any] | None:
    offered = parse_float(row.get("odd_melhor")) or parse_float(row.get("odd"))
    consensus = parse_float(row.get("odd_mediana")) or parse_float(row.get("odd_media")) or parse_float(row.get("odd"))
    if not offered or offered <= 1:
        return None
    if not consensus or consensus <= 1:
        consensus = offered
    return {
        "offered": offered,
        "consensus": consensus,
        "best": offered,
        "bookmaker": clean(row.get("bookmaker_melhor")) or clean(row.get("bookmaker")),
        "raw_odd": parse_float(row.get("odd")),
        "median": parse_float(row.get("odd_mediana")),
        "average": parse_float(row.get("odd_media")),
    }


def quote_offered(value: Any) -> float | None:
    if isinstance(value, dict):
        return parse_float(value.get("offered") or value.get("best") or value.get("odd"))
    return parse_float(value)


def quote_consensus(value: Any) -> float | None:
    if isinstance(value, dict):
        return parse_float(value.get("consensus") or value.get("median") or value.get("offered") or value.get("odd"))
    return parse_float(value)


def quote_bookmaker(value: Any) -> str:
    if isinstance(value, dict):
        return clean(value.get("bookmaker"))
    return ""


def set_best_quote(target: dict[str, Any], key: str, quote: dict[str, Any]) -> None:
    current = target.get(key)
    current_offered = quote_offered(current)
    next_offered = quote_offered(quote)
    if next_offered is None:
        return
    if current_offered is None or next_offered > current_offered:
        target[key] = quote


def set_best(target: dict[str, Any], key: str, odd: float) -> None:
    current = target.get(key)
    if current is None or odd > current:
        target[key] = odd


def extrair_sigla_arquivo_baseball(arquivo: Path) -> str:
    nome = arquivo.stem.upper()

    prefixos_para_remover = [
        "DADOS_BASE_",
        "DADOS_BASEBALL_",
        "BASEBALL_",
        "BASE_",
        "DADOS_",
        "DADOS_BASE",
        "DADOS_BASEBALL",
        "BASEBALL",
        "BASE",
        "DADOS",
    ]

    for prefixo in prefixos_para_remover:
        if nome.startswith(prefixo):
            nome = nome.replace(prefixo, "", 1)

    nome = nome.replace(" ", "_").replace("-", "_")
    partes = [p for p in nome.split("_") if p]

    if partes:
        return partes[-1].upper()

    return nome.upper()


def localizar_arquivo_historico(ano: int, sigla: str) -> Path:
    sigla = str(sigla).upper().strip()
    year_dir = HIST_DIR / str(ano)

    if not year_dir.exists():
        raise FileNotFoundError(f"Pasta histórica não encontrada: {year_dir}")

    candidatos = [
        year_dir / f"dados_base_{sigla}.csv",
        year_dir / f"dados_base_{sigla.lower()}.csv",
        year_dir / f"DADOS_BASE_{sigla}.csv",
        year_dir / f"DADOS_BASE_{sigla.lower()}.csv",
        year_dir / f"dados_baseball_{sigla}.csv",
        year_dir / f"dados_baseball_{sigla.lower()}.csv",
        year_dir / f"DADOS_BASEBALL_{sigla}.csv",
        year_dir / f"DADOS_BASEBALL_{sigla.lower()}.csv",
        year_dir / f"baseball_{sigla}.csv",
        year_dir / f"baseball_{sigla.lower()}.csv",
        year_dir / f"BASEBALL_{sigla}.csv",
        year_dir / f"base_{sigla}.csv",
        year_dir / f"base_{sigla.lower()}.csv",
        year_dir / f"BASE_{sigla}.csv",
        year_dir / f"dados_{sigla}.csv",
        year_dir / f"dados_{sigla.lower()}.csv",
        year_dir / f"DADOS_{sigla}.csv",
        year_dir / f"{sigla}.csv",
        year_dir / f"{sigla.lower()}.csv",
    ]

    for candidato in candidatos:
        if candidato.exists() and candidato.is_file():
            return candidato

    for arquivo in sorted(year_dir.glob("*.csv")):
        if extrair_sigla_arquivo_baseball(arquivo) == sigla:
            return arquivo

    arquivos_disponiveis = ", ".join([p.name for p in sorted(year_dir.glob("*.csv"))[:20]])

    raise FileNotFoundError(
        f"Base histórica ausente para {sigla} em {ano}. "
        f"Nenhum CSV compatível encontrado em {year_dir}. "
        f"Primeiros arquivos disponíveis: {arquivos_disponiveis}"
    )


def load_team_stats(sigla: str, season: int, cutoff_date: str | None = None) -> TeamStats:
    rows: list[dict[str, str]] = []
    rows_by_year: dict[int, list[dict[str, str]]] = {}
    missing: list[str] = []
    found_files: list[str] = []

    for year in (season - 1, season):
        try:
            path = localizar_arquivo_historico(year, sigla)
        except Exception as exc:
            missing.append(f"{year}: {exc}")
            continue

        found_files.append(str(path))

        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            year_rows = sort_and_filter_history_rows(
                list(csv.DictReader(fh)),
                year,
                cutoff_date if year == season else None,
            )
            rows_by_year[year] = year_rows
            rows.extend(year_rows)

    if not rows:
        raise RuntimeError(
            f"Base histórica ausente para {sigla}. "
            f"Arquivos/pastas buscados: {', '.join(missing)}"
        )

    scored = [value for value in (extract_runs(row, True) for row in rows) if value is not None]
    allowed = [value for value in (extract_runs(row, False) for row in rows) if value is not None]

    if not scored or not allowed:
        sample_cols = list(rows[0].keys()) if rows else []
        raise RuntimeError(
            f"Base histórica de {sigla} não possui colunas de corridas reconhecíveis. "
            f"Arquivos lidos: {', '.join(found_files)}. "
            f"Colunas encontradas: {sample_cols}"
        )

    wins = 0
    valid_results = 0
    streak = 0
    for row in rows:
        rf = extract_runs(row, True)
        ra = extract_runs(row, False)
        if rf is None or ra is None:
            continue
        valid_results += 1
        won = rf > ra
        wins += 1 if won else 0
        streak = streak + 1 if won and streak >= 0 else 1 if won else streak - 1 if streak <= 0 else -1

    current_rows = rows_by_year.get(season, [])
    previous_rows = rows_by_year.get(season - 1, [])
    last5_for = [value for value in (extract_runs(row, True) for row in current_rows[-5:]) if value is not None] or scored[-5:] or scored
    last5_against = [value for value in (extract_runs(row, False) for row in current_rows[-5:]) if value is not None] or allowed[-5:] or allowed
    temporal_for = temporal_runs_average(current_rows, previous_rows, scored=True, fallback=mean(scored))
    temporal_against = temporal_runs_average(current_rows, previous_rows, scored=False, fallback=mean(allowed))
    return TeamStats(
        sigla=sigla,
        games=len(scored),
        avg_for=mean(scored),
        avg_against=mean(allowed),
        win_rate=wins / valid_results if valid_results else 0.5,
        last5_for=mean(last5_for),
        last5_against=mean(last5_against),
        streak=streak,
        current_rows=current_rows,
        previous_rows=previous_rows,
        all_rows=rows,
        temporal_for=temporal_for,
        temporal_against=temporal_against,
        current_games=len(current_rows),
        previous_games=len(previous_rows),
        cutoff_date=cutoff_date,
    )


def sort_and_filter_history_rows(
    rows: list[dict[str, str]],
    year: int,
    cutoff_date: str | None,
) -> list[dict[str, str]]:
    cutoff = parse_history_date(cutoff_date, year) if cutoff_date else None
    materialized: list[tuple[datetime | None, int, dict[str, str]]] = []
    for index, row in enumerate(rows):
        row_date = parse_history_date(get_row_value(row, "Date"), year)
        if cutoff is not None and (row_date is None or row_date >= cutoff):
            continue
        materialized.append((row_date, index, row))
    materialized.sort(key=lambda item: (item[0] or datetime(year, 1, 1), item[1]))
    return [row for _date, _index, row in materialized]


def parse_history_date(value: Any, year: int) -> datetime | None:
    text = clean(value).replace(",", " ")
    text = re.sub(r"\s+\(\d+\)$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%A %b %d %Y",
        "%A %B %d %Y",
        "%b %d %Y",
        "%B %d %Y",
        "%A %b %d",
        "%A %B %d",
        "%a %b %d",
        "%b %d",
        "%B %d",
    ):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed if "%Y" in fmt else parsed.replace(year=year)
        except ValueError:
            continue
    return None


def exponential_recent_average(values: list[float], half_life: float = RECENT_HALF_LIFE_GAMES) -> float:
    if not values:
        return 0.0
    decay = math.log(2.0) / max(1.0, half_life)
    weights = [math.exp(-decay * age) for age in range(len(values) - 1, -1, -1)]
    return sum(value * weight for value, weight in zip(values, weights)) / sum(weights)


def temporal_runs_average(
    current_rows: list[dict[str, str]],
    previous_rows: list[dict[str, str]],
    *,
    scored: bool,
    fallback: float,
) -> float:
    current = [value for value in (extract_runs(row, scored) for row in current_rows) if value is not None]
    previous = [value for value in (extract_runs(row, scored) for row in previous_rows) if value is not None]
    recent = current[-RECENT_GAMES_WINDOW:]
    components = {
        "current": mean(current) if current else None,
        "recent": exponential_recent_average(recent) if recent else None,
        "previous": mean(previous) if previous else None,
    }
    available_weight = sum(
        TEMPORAL_WEIGHTS[key] for key, value in components.items() if value is not None
    )
    if available_weight <= 0:
        return fallback
    return sum(
        float(value) * TEMPORAL_WEIGHTS[key]
        for key, value in components.items()
        if value is not None
    ) / available_weight


def load_league_average_runs(season: int, cutoff_date: str | None = None) -> float:
    return _load_league_average_runs_cached(str(HIST_DIR), season, cutoff_date or "")


@lru_cache(maxsize=64)
def _load_league_average_runs_cached(hist_dir: str, season: int, cutoff_date: str) -> float:
    global HIST_DIR
    original_hist_dir = HIST_DIR
    HIST_DIR = Path(hist_dir)
    current_values: list[float] = []
    previous_values: list[float] = []
    try:
        for sigla in sorted(set(MLB_TEAMS.values())):
            for year, target in ((season, current_values), (season - 1, previous_values)):
                try:
                    path = localizar_arquivo_historico(year, sigla)
                except Exception:
                    continue
                with path.open("r", encoding="utf-8-sig", newline="") as fh:
                    rows = sort_and_filter_history_rows(
                        list(csv.DictReader(fh)),
                        year,
                        cutoff_date if year == season and cutoff_date else None,
                    )
                target.extend(
                    value for value in (extract_runs(row, True) for row in rows) if value is not None
                )
    finally:
        HIST_DIR = original_hist_dir

    prior = mean(previous_values) if previous_values else MLB_LEAGUE_RUNS_PRIOR
    if not current_values:
        return prior
    return (
        len(current_values) * mean(current_values) + LEAGUE_PRIOR_STRENGTH * prior
    ) / (len(current_values) + LEAGUE_PRIOR_STRENGTH)


def calculate_expected_runs(
    home: TeamStats,
    away: TeamStats,
    league_runs: float,
) -> tuple[float, float, dict[str, float]]:
    league_runs = max(2.5, min(7.0, league_runs or MLB_LEAGUE_RUNS_PRIOR))
    home_for = home.temporal_for if home.temporal_for is not None else home.avg_for
    home_against = home.temporal_against if home.temporal_against is not None else home.avg_against
    away_for = away.temporal_for if away.temporal_for is not None else away.avg_for
    away_against = away.temporal_against if away.temporal_against is not None else away.avg_against

    def factor(value: float) -> float:
        return max(0.60, min(1.50, value / league_runs))

    home_attack = factor(home_for)
    away_attack = factor(away_for)
    home_defense = factor(home_against)
    away_defense = factor(away_against)
    expected_home = league_runs * (home_attack**0.55) * (away_defense**0.45) * HOME_RUN_FACTOR
    expected_away = league_runs * (away_attack**0.55) * (home_defense**0.45) * AWAY_RUN_FACTOR
    expected_home = max(0.2, min(12.0, expected_home))
    expected_away = max(0.2, min(12.0, expected_away))
    return expected_home, expected_away, {
        "league_runs": league_runs,
        "home_temporal_for": home_for,
        "home_temporal_against": home_against,
        "away_temporal_for": away_for,
        "away_temporal_against": away_against,
        "home_attack_factor": home_attack,
        "away_attack_factor": away_attack,
        "home_defense_factor": home_defense,
        "away_defense_factor": away_defense,
        "expected_home": expected_home,
        "expected_away": expected_away,
        "overdispersion": RUNS_OVERDISPERSION,
    }


@lru_cache(maxsize=1)
def load_probability_calibration() -> dict[str, Any]:
    if not CALIBRATION_PATH.exists():
        return {}
    try:
        with CALIBRATION_PATH.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def apply_market_calibration(market: str, probability: float) -> tuple[float, dict[str, Any]]:
    config = load_probability_calibration().get(normalize_key(market), {})
    active = bool(config.get("active"))
    out_of_sample = bool(config.get("out_of_sample"))
    sample_size = int(config.get("sample_size") or 0)
    if not active or not out_of_sample or sample_size < 100:
        return probability, {
            "status": "identity_insufficient_oos_sample",
            "sample_size": sample_size,
        }
    intercept = float(config.get("intercept", 0.0))
    slope = float(config.get("slope", 1.0))
    clipped = max(1e-6, min(1 - 1e-6, probability))
    logit = math.log(clipped / (1 - clipped))
    calibrated = 1 / (1 + math.exp(-(intercept + slope * logit)))
    return max(0.01, min(0.99, calibrated)), {
        "status": "platt_logit_oos",
        "sample_size": sample_size,
        "intercept": intercept,
        "slope": slope,
    }


def selection_thesis_key(pick: dict[str, Any]) -> str:
    market = normalize_key(pick.get("mercado"))
    selection = clean(pick.get("pick"))
    if "total" in market:
        return "over" if "over" in selection.lower() else "under"
    if "handicap" in market:
        line = clean(pick.get("linha"))
        return normalize_key(selection[: -len(line)] if line and selection.endswith(line) else selection)
    return normalize_key(selection)


def limit_correlated_market_selections(
    picks: list[dict[str, Any]],
    limit: int = MAX_MARKET_SELECTIONS_PER_GAME,
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for pick in picks:
        grouped[normalize_key(pick.get("mercado"))].append(pick)

    selected: list[dict[str, Any]] = []
    for market_picks in grouped.values():
        ranked = sorted(
            market_picks,
            key=lambda item: (
                float(item.get("edge") or 0.0),
                float(item.get("probabilidade_final") or 0.0),
            ),
            reverse=True,
        )
        if not ranked:
            continue
        primary = ranked[0]
        thesis = selection_thesis_key(primary)
        correlated = [item for item in ranked[1:] if selection_thesis_key(item) == thesis]
        chosen = [primary, *correlated[: max(0, limit - 1)]]
        for index, item in enumerate(chosen, start=1):
            item["selection_rank"] = index
            item["selection_role"] = "PRINCIPAL" if index == 1 else "ALTERNATIVA"
            item["selection_group"] = thesis
        selected.extend(chosen)
    return selected


def generate_game_picks(
    game: dict[str, Any],
    home: TeamStats,
    away: TeamStats,
    game_context: str,
    handicap_audit_rows: list[dict[str, Any]] | None = None,
    league_runs: float | None = None,
) -> list[dict[str, Any]]:
    league_runs = league_runs or MLB_LEAGUE_RUNS_PRIOR
    expected_home, expected_away, lambda_diagnostics = calculate_expected_runs(
        home, away, league_runs
    )
    picks: list[dict[str, Any]] = []

    home_win_sim, away_win_sim, tie_regulation = win_probabilities_overdispersed(
        expected_home, expected_away
    )
    add_moneyline_pick(
        picks,
        game,
        home,
        away,
        "home",
        home_win_sim,
        game_context,
        lambda_diagnostics={**lambda_diagnostics, "tie_regulation": tie_regulation},
    )
    add_moneyline_pick(
        picks,
        game,
        home,
        away,
        "away",
        away_win_sim,
        game_context,
        lambda_diagnostics={**lambda_diagnostics, "tie_regulation": tie_regulation},
    )

    for line_key, odds in game["totals"].items():
        line = parse_float(line_key.replace("_", "."))
        if line is None:
            continue
        over_sim = total_runs_probability_overdispersed(expected_home, expected_away, line, "over")
        under_sim = total_runs_probability_overdispersed(expected_home, expected_away, line, "under")
        hist_over, over_sample, over_warnings = historical_total_probability(home, away, line, "over")
        hist_under, under_sample, under_warnings = historical_total_probability(home, away, line, "under")
        add_total_pick(
            picks,
            game,
            "Over",
            line,
            odds.get("over"),
            over_sim,
            hist_over,
            odds.get("under"),
            game_context,
            over_sample,
            over_warnings,
            lambda_diagnostics,
        )
        add_total_pick(
            picks,
            game,
            "Under",
            line,
            odds.get("under"),
            under_sim,
            hist_under,
            odds.get("over"),
            game_context,
            under_sample,
            under_warnings,
            lambda_diagnostics,
        )

    if not HANDICAP_ENABLED_MLB_V1_1 and not HANDICAP_SHADOW_ENABLED:
        return limit_correlated_market_selections(picks)
    for candidate in iter_handicap_candidates(game):
        add_handicap_pick(
            picks,
            game,
            home,
            away,
            candidate["side"],
            candidate["line"],
            candidate["odd"],
            candidate.get("other_odd"),
            expected_home,
            expected_away,
            game_context,
            handicap_audit_rows,
            market_odd=candidate.get("market_odd"),
            other_market_odd=candidate.get("other_market_odd"),
            bookmaker_melhor=candidate.get("bookmaker_melhor"),
        )

    return limit_correlated_market_selections(picks)


def add_moneyline_pick(
    picks: list[dict[str, Any]],
    game: dict[str, Any],
    home: TeamStats,
    away: TeamStats,
    side: str,
    sim_prob: float,
    game_context: str,
    lambda_diagnostics: dict[str, float] | None = None,
) -> None:
    quote = game["moneyline"].get(side)
    odd = quote_offered(quote)
    if not odd:
        return
    other_quote = game["moneyline"].get("away" if side == "home" else "home")
    other_odd = quote_offered(other_quote)
    if not other_odd:
        return
    market_odd = quote_consensus(quote) or odd
    other_market_odd = quote_consensus(other_quote) or other_odd
    vig_prob = no_vig_probability(market_odd, other_market_odd)
    hist_home = matchup_win_probability(home.win_rate, home.games, away.win_rate, away.games)
    hist_prob = hist_home if side == "home" else 1.0 - hist_home
    raw_prob = weighted({"vit": hist_prob, "sim": sim_prob, "vig": vig_prob}, PROB_ML_WEIGHTS)
    prob, calibration = apply_market_calibration("moneyline", raw_prob)
    team = game["home"] if side == "home" else game["away"]
    append_if_ev(
        picks,
        game,
        "Moneyline",
        team,
        "",
        odd,
        prob,
        game_context,
        f"Sim Win%: {sim_prob:.2%}",
        {
            "prob_hist": hist_prob,
            "prob_sim": sim_prob,
            "prob_no_vig": vig_prob,
            "odd_consenso": market_odd,
            "odd_oposta_consenso": other_market_odd,
            "odd_melhor": odd,
            "bookmaker_melhor": quote_bookmaker(quote),
            "sample_size_hist": (home.games if side == "home" else away.games),
            "warnings": [],
            "prob_raw": raw_prob,
            "calibration": calibration,
            "lambda_diagnostics": lambda_diagnostics or {},
        },
        min_edge=MIN_EDGE_MONEYLINE,
    )


def add_total_pick(
    picks: list[dict[str, Any]],
    game: dict[str, Any],
    side: str,
    line: float,
    odd: Any,
    sim_prob: float,
    hist_prob: float,
    other_odd: Any,
    game_context: str,
    sample_size_hist: int,
    warnings: list[str],
    lambda_diagnostics: dict[str, float] | None = None,
) -> None:
    quote = odd
    other_quote = other_odd
    odd = quote_offered(quote)
    other_odd = quote_offered(other_quote)
    if not odd:
        return
    if not other_odd:
        return
    market_odd = quote_consensus(quote) or odd
    other_market_odd = quote_consensus(other_quote) or other_odd
    vig_prob = no_vig_probability(market_odd, other_market_odd)
    raw_prob = weighted({"hist": hist_prob, "sim": sim_prob, "vig": vig_prob}, PROB_OU_WEIGHTS)
    prob, calibration = apply_market_calibration("totals", raw_prob)
    append_if_ev(
        picks,
        game,
        "Total de Corridas",
        f"{side} {line:g}",
        f"{line:g}",
        odd,
        prob,
        game_context,
        f"Probabilidade simulada {side}: {sim_prob:.2%}",
        {
            "prob_hist": hist_prob,
            "prob_sim": sim_prob,
            "prob_no_vig": vig_prob,
            "odd_consenso": market_odd,
            "odd_oposta_consenso": other_market_odd,
            "odd_melhor": odd,
            "bookmaker_melhor": quote_bookmaker(quote),
            "sample_size_hist": sample_size_hist,
            "warnings": warnings,
            "prob_raw": raw_prob,
            "calibration": calibration,
            "lambda_diagnostics": lambda_diagnostics or {},
        },
        min_edge=MIN_EDGE_TOTALS,
    )


def add_handicap_pick_legacy_disabled(
    picks: list[dict[str, Any]],
    game: dict[str, Any],
    team: str,
    line: float,
    odd: float | None,
    sim_prob: float,
    diff: float,
    game_context: str,
) -> None:
    if not odd:
        return
    if not HANDICAP_ENABLED_MLB_V1_1:
        return
    hist_prob = 1.0 if diff + line > 0 else 0.0
    vig_prob = implied_probability(odd)
    prob = weighted({"hist": hist_prob, "sim": sim_prob, "vig": vig_prob}, HANDICAP_WEIGHTS)
    line_text = format_signed_line(line)
    append_if_ev(
        picks,
        game,
        "Handicap Asiático",
        f"{team} {line_text}",
        line_text,
        odd,
        prob,
        game_context,
        f"Probabilidade simulada de cobertura: {sim_prob:.2%}",
        {
            "prob_hist": hist_prob,
            "prob_sim": sim_prob,
            "prob_no_vig": vig_prob,
            "sample_size_hist": 0,
            "warnings": ["handicap_bloqueado_v1_1_overconfidence_backtest"],
        },
    )

def iter_handicap_candidates(game: dict[str, Any]) -> list[dict[str, Any]]:
    by_side_line: dict[tuple[str, float], dict[str, Any]] = {}
    for odds in game.get("handicaps", {}).values():
        for side in ("home", "away"):
            quote = odds.get(side)
            odd = quote_offered(quote)
            line = odds.get(f"{side}_line")
            if odd is None or line is None:
                continue
            by_side_line[(side, float(line))] = {
                "side": side,
                "line": float(line),
                "odd": float(odd),
                "market_odd": quote_consensus(quote) or float(odd),
                "bookmaker_melhor": quote_bookmaker(quote),
            }

    candidates: list[dict[str, Any]] = []
    for (side, line), item in sorted(by_side_line.items(), key=lambda pair: (pair[0][0], pair[0][1])):
        other_side = "away" if side == "home" else "home"
        other = by_side_line.get((other_side, -line))
        candidates.append(
            {
                **item,
                "other_odd": other.get("odd") if other else None,
                "other_market_odd": other.get("market_odd") if other else None,
            }
        )
    return candidates


def add_handicap_pick(
    picks: list[dict[str, Any]],
    game: dict[str, Any],
    home: TeamStats,
    away: TeamStats,
    side: str,
    line: float,
    odd: float | None,
    other_odd: float | None,
    expected_home: float,
    expected_away: float,
    game_context: str,
    handicap_audit_rows: list[dict[str, Any]] | None = None,
    market_odd: float | None = None,
    other_market_odd: float | None = None,
    bookmaker_melhor: str = "",
) -> None:
    if not HANDICAP_ENABLED_MLB_V1_1 and not HANDICAP_SHADOW_ENABLED:
        return

    warnings = [
        "handicap_mlb_v2_operationally_disabled"
        if not HANDICAP_ENABLED_MLB_V1_1
        else "handicap_mlb_v2_controlled_activation"
    ]
    team_name = game["home"] if side == "home" else game["away"]
    team_stats = home if side == "home" else away
    expected_margin = expected_home - expected_away if side == "home" else expected_away - expected_home
    expected_margin_home = expected_home - expected_away
    expected_margin_away = expected_away - expected_home
    run_diff_edge = team_stats.avg_for - team_stats.avg_against
    line_text = format_signed_line(line)
    base_audit = {
        "data": game["data"],
        "jogo": game["jogo"],
        "mandante": game["home"],
        "visitante": game["away"],
        "pick": f"{team_name} {line_text}",
        "linha": line,
        "odd": odd,
        "odd_mediana": market_odd,
        "odd_melhor": odd,
        "bookmaker_melhor": bookmaker_melhor,
        "expected_home": expected_home,
        "expected_away": expected_away,
        "expected_margin_home": expected_margin_home,
        "expected_margin_away": expected_margin_away,
        "score_distribution": "Negative Binomial",
        "runs_overdispersion": RUNS_OVERDISPERSION,
        "warnings": ";".join(warnings),
    }

    def audit(reason: str, passed: bool = False, extra: dict[str, Any] | None = None) -> None:
        if handicap_audit_rows is None:
            return
        activation_status = HANDICAP_SELECTED_CONTROLLED if passed else reason
        handicap_audit_rows.append(
            {
                **base_audit,
                "model_version": BASEBALL_MLB_HANDICAP_MODEL_VERSION,
                "mode": "controlled_activation" if HANDICAP_ENABLED_MLB_V1_1 else "shadow_blocked",
                "published": passed,
                "activation_status": activation_status,
                "prob_hist": "",
                "prob_sim": "",
                "prob_no_vig": "",
                "prob_final": "",
                "odd_justa": "",
                "edge": "",
                "sample_size_hist": "",
                "passou_filtros": passed,
                "motivo_descarte": "" if passed else reason,
                **(extra or {}),
            }
        )

    if odd is None or odd <= 1:
        audit("INVALID_ODD")
        return
    if not is_allowed_handicap_line(line):
        audit("HANDICAP_LINE_NOT_SUPPORTED")
        return
    if other_odd is None or other_odd <= 1:
        audit("HANDICAP_NO_PAIRED_ODDS")
        return
    if line < 0 and expected_margin < abs(line) * 0.65:
        audit("NEGATIVE_LINE_MARGIN_TOO_LOW")
        return
    if line < 0 and run_diff_edge < 0:
        audit("NEGATIVE_LINE_TEAM_RUN_DIFF_NEGATIVE")
        return
    if line > 0 and -expected_margin > 2.25:
        audit("POSITIVE_LINE_TOO_WEAK")
        return

    hist = historical_handicap_cover_rate(team_stats, line)
    hist_prob = float(hist["cover_rate_shrunk"])
    sim_prob = handicap_cover_probability_overdispersed(expected_home, expected_away, side, line)
    market_odd = market_odd or odd
    other_market_odd = other_market_odd or other_odd
    vig_prob = no_vig_probability(market_odd, other_market_odd)
    prob = weighted({"hist": hist_prob, "sim": sim_prob, "vig": vig_prob}, PROB_HC_WEIGHTS)
    odd_valor = 1 / prob if prob > 0 else 0.0
    edge = (odd * prob - 1) * 100
    common_audit = {
        "prob_hist": hist_prob,
        "prob_sim": sim_prob,
        "prob_no_vig": vig_prob,
        "odd_consenso": market_odd,
        "odd_oposta_consenso": other_market_odd,
        "odd_melhor": odd,
        "bookmaker_melhor": bookmaker_melhor,
        "prob_final": prob,
        "odd_justa": odd_valor,
        "edge": edge,
        "sample_size_hist": hist["sample_size_hist"],
        "covers_historicos": hist["covers"],
        "losses_historicos": hist["losses"],
        "cover_rate_raw": hist["cover_rate_raw"],
        "cover_rate_shrunk": hist["cover_rate_shrunk"],
        "score_distribution": "Negative Binomial",
        "runs_overdispersion": RUNS_OVERDISPERSION,
    }

    if prob < HANDICAP_MIN_PROB:
        audit("HANDICAP_PROB_BELOW_MIN", extra=common_audit)
        return
    if prob >= HANDICAP_MAX_PROB:
        audit("HANDICAP_PROB_ABOVE_MAX", extra=common_audit)
        return
    if not (odd > odd_valor and odd > 1.25 and odd <= 2.00):
        audit("HANDICAP_NOT_EV_PLUS_OR_ODD_OUT_OF_RANGE", extra=common_audit)
        return
    if edge < HANDICAP_MIN_EDGE:
        audit("HANDICAP_EDGE_BELOW_MIN", extra=common_audit)
        return
    if not HANDICAP_ENABLED_MLB_V1_1:
        audit("HANDICAP_SHADOW_ONLY", extra=common_audit)
        return

    technical = build_handicap_technical_context(
        game=game,
        pick=f"{team_name} {line_text}",
        line=line,
        odd=odd,
        odd_valor=odd_valor,
        edge=edge,
        prob=prob,
        hist=hist,
        sim_prob=sim_prob,
        vig_prob=vig_prob,
        expected_home=expected_home,
        expected_away=expected_away,
        home=home,
        away=away,
        other_odd=other_odd,
        market_odd=market_odd,
        other_market_odd=other_market_odd,
        warnings=warnings,
    )
    audit("", passed=True, extra=common_audit)
    append_if_ev(
        picks,
        game,
        "Handicap Asiatico",
        f"{team_name} {line_text}",
        line_text,
        odd,
        prob,
        game_context,
        f"Handicap MLB controlled activation: probabilidade simulada de cobertura {sim_prob:.2%}",
        {
            "prob_hist": hist_prob,
            "prob_sim": sim_prob,
            "prob_no_vig": vig_prob,
            "odd_consenso": market_odd,
            "odd_oposta_consenso": other_market_odd,
            "odd_melhor": odd,
            "bookmaker_melhor": bookmaker_melhor,
            "sample_size_hist": hist["sample_size_hist"],
            "warnings": warnings,
        },
        min_prob=HANDICAP_MIN_PROB,
        max_prob=HANDICAP_MAX_PROB,
        min_edge=HANDICAP_MIN_EDGE,
        extra_fields={
            "modelo_versao": BASEBALL_MLB_HANDICAP_MODEL_VERSION,
            "model_version": BASEBALL_MLB_HANDICAP_MODEL_VERSION,
            "activation_status": HANDICAP_SELECTED_CONTROLLED,
            "odd_justa": round(odd_valor, 3),
            "dados_tecnicos": f"{game_context}\n{technical}",
            "contexto_adicional": game_context,
            "observacoes": technical,
        },
    )


def append_if_ev(
    picks: list[dict[str, Any]],
    game: dict[str, Any],
    mercado: str,
    pick: str,
    linha: str,
    odd: float,
    prob: float,
    game_context: str,
    extra: str,
    diagnostics: dict[str, Any] | None = None,
    min_prob: float = 0.0,
    max_prob: float = OVERCONFIDENCE_PROB_CUTOFF,
    min_edge: float = 0.0,
    extra_fields: dict[str, Any] | None = None,
) -> bool:
    if prob <= 0:
        return False
    if prob < min_prob:
        return False
    if prob >= max_prob:
        return False
    odd_valor = 1 / prob
    edge = (odd * prob - 1) * 100
    if not (odd > odd_valor and odd > 1.25 and odd <= 2.00):
        return False
    if edge < min_edge:
        return False
    diagnostics = diagnostics or {}
    warnings = diagnostics.get("warnings") or []
    calibration = diagnostics.get("calibration") or {}
    lambda_diagnostics = diagnostics.get("lambda_diagnostics") or {}
    market_odd = parse_float(diagnostics.get("odd_consenso"))
    best_odd = parse_float(diagnostics.get("odd_melhor")) or odd
    bookmaker_melhor = clean(diagnostics.get("bookmaker_melhor"))
    debug_text = (
        f" modelo_versao={MODEL_VERSION}; prob_hist={float(diagnostics.get('prob_hist', 0.0)):.4f};"
        f" prob_sim={float(diagnostics.get('prob_sim', 0.0)):.4f};"
        f" prob_no_vig={float(diagnostics.get('prob_no_vig', 0.0)):.4f};"
        f" prob_raw={float(diagnostics.get('prob_raw', prob)):.4f};"
        f" odd_mercado_base={(market_odd or odd):.3f};"
        f" prob_final={prob:.4f}; sample_size_hist={int(diagnostics.get('sample_size_hist') or 0)};"
        f" calibracao={clean(calibration.get('status')) or 'identity'};"
        f" lambda_home={float(lambda_diagnostics.get('expected_home', 0.0)):.3f};"
        f" lambda_away={float(lambda_diagnostics.get('expected_away', 0.0)):.3f};"
        f" media_liga={float(lambda_diagnostics.get('league_runs', 0.0)):.3f};"
        f" warnings={','.join(str(item) for item in warnings) if warnings else 'nenhum'}."
    )
    observacoes = (
        f"Modelo Baseball MLB. {extra}. Odd ofertada {odd:.3f}; odd valor {odd_valor:.3f}; "
        f"odd mercado base {(market_odd or odd):.3f}; probabilidade pre-IA {prob * 100:.2f}%; edge {edge:.2f}%. "
        "Starter, bullpen, parque e clima nao incorporados; validar no Preview/IA sem dupla contagem."
        f"{debug_text}"
    )
    picks.append(
        {
            "data": game["data"],
            "hora": game["hora"],
            "esporte": "Baseball",
            "liga": game.get("liga") or "MLB",
            "jogo": game["jogo"],
            "mandante": game["home"],
            "visitante": game["away"],
            "mercado": mercado,
            "pick": pick,
            "linha": linha,
            "modelo_versao": MODEL_VERSION,
            "odd": round(odd, 3),
            "odd_ofertada": round(odd, 3),
            "odd_melhor": round(best_odd, 3),
            "odd_mediana": round(market_odd, 3) if market_odd else round(odd, 3),
            "odd_mercado_base": round(market_odd, 3) if market_odd else round(odd, 3),
            "bookmaker_melhor": bookmaker_melhor,
            "odd_valor": round(odd_valor, 3),
            "probabilidade": round(prob * 100, 2),
            "probabilidade_final": round(prob * 100, 2),
            "probabilidade_pre_ia": round(prob * 100, 2),
            "probabilidade_estagio": "PRE_IA",
            "starter_incorporado": False,
            "bullpen_incorporado": False,
            "park_factor_incorporado": False,
            "weather_incorporado": False,
            "requer_preview_ia": True,
            "calibration_status": clean(calibration.get("status")) or "identity",
            "edge": round(edge, 2),
            "stake": 0.5,
            "dados_tecnicos": f"{game_context}\n{observacoes}",
            "contexto_adicional": game_context,
            "parecer_validacao": "AGUARDAR_VALIDAÇÃO",
            "observacoes": observacoes,
        }
    )
    if extra_fields:
        picks[-1].update(extra_fields)
    return True


def build_game_context(game: dict[str, Any], home: TeamStats, away: TeamStats, season: int) -> str:
    league_runs = load_league_average_runs(season, normalize_date(game.get("data")))
    expected_home, expected_away, lambda_diagnostics = calculate_expected_runs(
        home, away, league_runs
    )
    total_expected = expected_home + expected_away
    delta_rpi = home.win_rate - away.win_rate
    home_record = season_record(home.current_rows)
    away_record = season_record(away.current_rows)
    home_rank = latest_value(home.current_rows, "Rank") or "-"
    away_rank = latest_value(away.current_rows, "Rank") or "-"
    home_division = MLB_TEAM_DIVISION.get(home.sigla, "MLB")
    away_division = MLB_TEAM_DIVISION.get(away.sigla, "MLB")
    home_win_base, away_win_base, tie_regulation = win_probabilities_overdispersed(
        expected_home, expected_away
    )
    home_win_prob = home_win_base * 100
    away_win_prob = away_win_base * 100
    home_diff = home.avg_for - home.avg_against
    away_diff = away.avg_for - away.avg_against
    insight = "Confronto equilibrado"
    if abs(delta_rpi) >= 0.080:
        insight = f"Vantagem relevante para {game['home'] if delta_rpi > 0 else game['away']}"
    elif abs(delta_rpi) >= 0.035:
        insight = f"Leve vantagem para {game['home'] if delta_rpi > 0 else game['away']}"

    return "\n".join(
        [
            "--- CONFRONTO ---",
            f"{game['home']} (W-{home_record['wins']}/L-{home_record['losses']}/WL-{home_record['win_rate']:.3f}) - {home_rank} {home_division} Division",
            "vs",
            f"{game['away']} (W-{away_record['wins']}/L-{away_record['losses']}/WL-{away_record['win_rate']:.3f}) - {away_rank} {away_division} Division",
            f"Data/Horário: {game['data']} / {game['hora']}",
            "",
            f"Jogo {max(home_record['games'], away_record['games']) + 1} da temporada regular",
            "",
            "--- Probabilidade de Vitória ---",
            f"{game['home']}: {home_win_prob:.1f}%",
            f"{game['away']}: {away_win_prob:.1f}%",
            f"Empate apos 9 entradas antes do condicionamento: {tie_regulation * 100:.1f}%",
            f"--- H2H ({season} + {season - 1}) ---",
            build_h2h_section(game, home, away, season),
            "",
            "--- ÚLTIMOS 5 JOGOS NO LOCAL ---",
            build_last5_section(game, home, away, season),
            "",
            "--- DADOS TÉCNICOS ---",
            "Streak:",
            f"   {game['home']} {format_streak(home)} | {game['away']} {format_streak(away)}",
            "",
            "RPI:",
            f"   {game['home']} {home.win_rate:.3f} | {game['away']} {away.win_rate:.3f}",
            f"   Delta RPI: {delta_rpi:.3f}",
            "",
            "Insights do Delta RPI:",
            f"   {insight}",
            "Médias e Expectativas de Corridas",
            f"   {game['home']}: Marcadas = {home.avg_for:.2f} | Sofridas = {home.avg_against:.2f}",
            f"   {game['away']}: Marcadas = {away.avg_for:.2f} | Sofridas = {away.avg_against:.2f}",
            f"   Media temporal {game['home']}: Marcadas = {float(home.temporal_for or home.avg_for):.2f} | Sofridas = {float(home.temporal_against or home.avg_against):.2f}",
            f"   Media temporal {game['away']}: Marcadas = {float(away.temporal_for or away.avg_for):.2f} | Sofridas = {float(away.temporal_against or away.avg_against):.2f}",
            f"   Media da liga usada = {lambda_diagnostics['league_runs']:.3f}",
            f"   Distribuicao = Negative Binomial | Sobredispersao = {RUNS_OVERDISPERSION:.3f}",
            f"   Expectativa de Total de Corridas = {total_expected:.2f} | Min = {max(0.0, total_expected - 6.5):.1f} | Max = {total_expected + 6.5:.1f}",
            "",
            "Diferencial de Corridas:",
            f"   {game['home']}: {home_diff:+.2f}",
            f"   {game['away']}: {away_diff:+.2f}",
            f"   Delta de Corridas: {home_diff - away_diff:+.2f}",
        ]
    )


def apply_shrinkage(prob_observed: float, n: int, prior: float = HISTORICAL_PRIOR, prior_strength: float = HISTORICAL_PRIOR_STRENGTH) -> float:
    if n <= 0:
        return prior
    return ((n * prob_observed) + (prior_strength * prior)) / (n + prior_strength)


def matchup_win_probability(
    home_win_rate: float,
    home_games: int,
    away_win_rate: float,
    away_games: int,
) -> float:
    home_strength = apply_shrinkage(home_win_rate, home_games)
    away_strength = apply_shrinkage(away_win_rate, away_games)
    denominator = home_strength + away_strength - (2 * home_strength * away_strength)
    if denominator <= 0:
        return 0.5
    probability = (home_strength - home_strength * away_strength) / denominator
    return max(0.01, min(0.99, probability))


def temporal_event_rate(
    current_rows: list[dict[str, str]],
    previous_rows: list[dict[str, str]],
    event: Any,
) -> tuple[float, int]:
    def values_for(rows: list[dict[str, str]]) -> list[float]:
        values: list[float] = []
        for row in rows:
            outcome = event(row)
            if outcome is None:
                continue
            values.append(1.0 if outcome else 0.0)
        return values

    current_values = values_for(current_rows)
    previous_values = values_for(previous_rows)
    recent_values = current_values[-RECENT_GAMES_WINDOW:]
    components = {
        "current": mean(current_values) if current_values else None,
        "recent": exponential_recent_average(recent_values) if recent_values else None,
        "previous": mean(previous_values) if previous_values else None,
    }
    available_weight = sum(
        TEMPORAL_WEIGHTS[key] for key, value in components.items() if value is not None
    )
    if available_weight <= 0:
        return HISTORICAL_PRIOR, 0
    observed = sum(
        float(value) * TEMPORAL_WEIGHTS[key]
        for key, value in components.items()
        if value is not None
    ) / available_weight
    sample_size = len(current_values) + len(previous_values)
    return observed, sample_size


def historical_total_probability(home: TeamStats, away: TeamStats, line: float, side: str) -> tuple[float, int, list[str]]:
    def total_for_row(row: dict[str, str]) -> float | None:
        runs_for = extract_runs(row, True)
        runs_against = extract_runs(row, False)
        if runs_for is None or runs_against is None:
            return None
        return runs_for + runs_against

    warnings: list[str] = []
    normalized_side = normalize_key(side)
    if normalized_side not in {"over", "under"}:
        warnings.append("hist_total_side_invalido_prior_050")
        return HISTORICAL_PRIOR, 0, warnings

    def event(row: dict[str, str]) -> bool | None:
        total = total_for_row(row)
        if total is None:
            return None
        return total > line if normalized_side == "over" else total < line

    home_prob, home_sample = temporal_event_rate(home.current_rows, home.previous_rows, event)
    away_prob, away_sample = temporal_event_rate(away.current_rows, away.previous_rows, event)
    sample_size = home_sample + away_sample
    if sample_size == 0:
        warnings.append("hist_total_fallback_prior_050")
        return HISTORICAL_PRIOR, 0, warnings
    hist_observed = (
        (home_prob * home_sample) + (away_prob * away_sample)
    ) / sample_size
    hist_prob = apply_shrinkage(hist_observed, sample_size)
    if sample_size < 10:
        warnings.append("hist_total_amostra_baixa_shrinkage")
    elif sample_size >= 20:
        warnings.append("hist_total_amostra_confiavel")
    return hist_prob, sample_size, warnings


def is_allowed_handicap_line(line: float) -> bool:
    return any(math.isclose(float(line), allowed, abs_tol=1e-9) for allowed in HANDICAP_ALLOWED_LINES)


def historical_handicap_cover_rate(
    team: TeamStats,
    line: float,
    prior: float = HISTORICAL_PRIOR,
    prior_strength: float = HISTORICAL_PRIOR_STRENGTH,
) -> dict[str, Any]:
    covers = 0
    losses = 0
    for row in team.all_rows:
        runs_for = extract_runs(row, True)
        runs_against = extract_runs(row, False)
        if runs_for is None or runs_against is None:
            continue
        if runs_for - runs_against + line > 0:
            covers += 1
        else:
            losses += 1

    sample_size = covers + losses
    cover_rate_raw = covers / sample_size if sample_size else prior

    def covered(row: dict[str, str]) -> bool | None:
        runs_for = extract_runs(row, True)
        runs_against = extract_runs(row, False)
        if runs_for is None or runs_against is None:
            return None
        return runs_for - runs_against + line > 0

    temporal_rate_raw, temporal_sample = temporal_event_rate(
        team.current_rows, team.previous_rows, covered
    )
    temporal_observed = temporal_rate_raw if temporal_sample else cover_rate_raw
    cover_rate_shrunk = apply_shrinkage(
        temporal_observed,
        temporal_sample or sample_size,
        prior=prior,
        prior_strength=prior_strength,
    )
    return {
        "sample_size_hist": temporal_sample or sample_size,
        "covers": covers,
        "losses": losses,
        "cover_rate_raw": cover_rate_raw,
        "cover_rate_shrunk": cover_rate_shrunk,
        "prior": prior,
        "prior_strength": prior_strength,
    }


def build_handicap_technical_context(
    game: dict[str, Any],
    pick: str,
    line: float,
    odd: float,
    odd_valor: float,
    edge: float,
    prob: float,
    hist: dict[str, Any],
    sim_prob: float,
    vig_prob: float,
    expected_home: float,
    expected_away: float,
    home: TeamStats,
    away: TeamStats,
    other_odd: float,
    market_odd: float,
    other_market_odd: float,
    warnings: list[str],
) -> str:
    expected_margin_home = expected_home - expected_away
    expected_margin_away = expected_away - expected_home
    return "\n".join(
        [
            "--- HANDICAP / RUN LINE MLB V1.1 CONTROLLED ACTIVATION ---",
            f"Mercado: Handicap / Run Line",
            f"Pick: {pick}",
            f"Linha: {format_signed_line(line)}",
            f"Odd ofertada: {odd:.3f}",
            f"Odd mercado base: {market_odd:.3f}",
            f"Odd justa: {odd_valor:.3f}",
            f"Edge: {edge:.2f}%",
            f"Probabilidade final: {prob * 100:.2f}%",
            f"Prob hist: {float(hist['cover_rate_shrunk']):.4f}",
            f"Prob sim: {sim_prob:.4f}",
            f"Prob no-vig: {vig_prob:.4f}",
            f"Pesos: hist={PROB_HC_WEIGHTS['hist']:.2f}; sim={PROB_HC_WEIGHTS['sim']:.2f}; vig={PROB_HC_WEIGHTS['vig']:.2f}",
            f"Sample hist: {int(hist['sample_size_hist'])}",
            f"Covers historicos: {int(hist['covers'])}",
            f"Losses historicos: {int(hist['losses'])}",
            f"Cover rate raw: {float(hist['cover_rate_raw']):.4f}",
            f"Cover rate shrinkage: {float(hist['cover_rate_shrunk']):.4f}",
            f"Expected home: {expected_home:.3f}",
            f"Expected away: {expected_away:.3f}",
            f"Expected margin home: {expected_margin_home:+.3f}",
            f"Expected margin away: {expected_margin_away:+.3f}",
            f"Total expected: {expected_home + expected_away:.3f}",
            f"{game['home']} medias: marcadas={home.avg_for:.2f}; sofridas={home.avg_against:.2f}; diff={home.avg_for - home.avg_against:+.2f}",
            f"{game['away']} medias: marcadas={away.avg_for:.2f}; sofridas={away.avg_against:.2f}; diff={away.avg_for - away.avg_against:+.2f}",
            f"No-vig pair: odd_pick_base={market_odd:.3f}; odd_oposta_base={other_market_odd:.3f}; odd_pick_ofertada={odd:.3f}; odd_oposta_ofertada={other_odd:.3f}",
            f"Warnings: {', '.join(warnings) if warnings else 'nenhum'}",
            "mode: controlled_activation",
            f"model_version: {BASEBALL_MLB_HANDICAP_MODEL_VERSION}",
        ]
    )


def season_record(rows: list[dict[str, str]]) -> dict[str, float]:
    wins = 0
    losses = 0
    for row in rows:
        result = get_row_value(row, "W/L").upper()
        if result.startswith("W"):
            wins += 1
        elif result.startswith("L"):
            losses += 1
        else:
            rf = extract_runs(row, True)
            ra = extract_runs(row, False)
            if rf is None or ra is None:
                continue
            wins += 1 if rf > ra else 0
            losses += 1 if rf <= ra else 0
    games = wins + losses
    return {"wins": wins, "losses": losses, "games": games, "win_rate": wins / games if games else 0.0}


def build_h2h_section(game: dict[str, Any], home: TeamStats, away: TeamStats, season: int) -> str:
    sections: list[str] = []
    for year, rows in ((season, home.current_rows), (season - 1, home.previous_rows)):
        matches = [row for row in rows if normalize_key(get_row_value(row, "Opp")) == normalize_key(away.sigla)]
        sections.append(f"{year}:")
        if not matches:
            sections.append("Nenhum confronto encontrado.")
            sections.append("")
            continue

        home_wins = 0
        away_wins = 0
        home_runs: list[float] = []
        away_runs: list[float] = []
        totals: list[float] = []

        for idx, row in enumerate(matches, start=1):
            rf = extract_runs(row, True) or 0.0
            ra = extract_runs(row, False) or 0.0
            total = rf + ra
            totals.append(total)
            if rf > ra:
                home_wins += 1
            else:
                away_wins += 1
            if is_away_game(row):
                home_runs.append(rf)
                away_runs.append(ra)
                matchup = f"{game['away']} (Casa) vs {game['home']} (Fora) - ({int(ra)}-{int(rf)})"
            else:
                home_runs.append(rf)
                away_runs.append(ra)
                matchup = f"{game['home']} (Casa) vs {game['away']} (Fora) - ({int(rf)}-{int(ra)})"
            sections.append(f"jogo {idx}: {get_row_value(row, 'Date') or '-'}")
            sections.append(f"  {matchup} | Total de Corridas = {int(total)}")

        sections.append("")
        sections.append(f"Total de jogos {year}: {len(matches)}")
        sections.append(f"Vitórias {game['home']}: {home_wins} | Vitórias {game['away']}: {away_wins}")
        sections.append(
            f"Médias de Corridas (H2H): {game['home']}= {mean(home_runs):.2f} | "
            f"{game['away']}= {mean(away_runs):.2f} | Média Total: {mean(totals):.2f}"
        )
        sections.append("")
    return "\n".join(sections).rstrip()


def build_last5_section(game: dict[str, Any], home: TeamStats, away: TeamStats, season: int) -> str:
    home_games = [row for row in home.current_rows if not is_away_game(row)][-5:]
    away_games = [row for row in away.current_rows if is_away_game(row)][-5:]
    lines = [f"{game['home']}:"]
    lines.extend(format_recent_game(row, season) for row in home_games)
    if not home_games:
        lines.append("  Nenhum jogo recente em casa encontrado.")
    lines.append("")
    lines.append(f"{game['away']}:")
    lines.extend(format_recent_game(row, season) for row in away_games)
    if not away_games:
        lines.append("  Nenhum jogo recente fora encontrado.")
    return "\n".join(lines)


def format_recent_game(row: dict[str, str], year: int) -> str:
    rf = extract_runs(row, True) or 0.0
    ra = extract_runs(row, False) or 0.0
    result = get_row_value(row, "W/L") or ("W" if rf > ra else "L")
    opp = get_row_value(row, "Opp") or "OPP"
    date_text = format_baseball_date(get_row_value(row, "Date"), year)
    return f"  {date_text} vs {opp} - {result[:1]} ({int(rf)}-{int(ra)}) | Total Corridas = {int(rf + ra)}"


def format_baseball_date(value: str, year: int) -> str:
    text = clean(value)
    for fmt in ("%A %b %d", "%b %d", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            parsed = datetime.strptime(text, fmt)
            if "%Y" not in fmt:
                parsed = parsed.replace(year=year)
            return parsed.strftime("%d/%m/%Y")
        except ValueError:
            pass
    return text


def format_streak(stats: TeamStats) -> str:
    latest = latest_value(stats.current_rows, "Streak")
    if latest:
        return latest
    if stats.streak > 0:
        return f"W{stats.streak}"
    if stats.streak < 0:
        return f"L{abs(stats.streak)}"
    return "-"


def latest_value(rows: list[dict[str, str]], column: str) -> str:
    for row in reversed(rows):
        value = get_row_value(row, column)
        if value:
            return value
    return ""


def get_row_value(row: dict[str, str], column: str) -> str:
    target = normalize_key(column)
    for key, value in row.items():
        if normalize_key(key) == target:
            return clean(value)
    return ""


def is_away_game(row: dict[str, str]) -> bool:
    return any(clean(value) == "@" for value in row.values())


def write_output_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = [
        "data",
        "hora",
        "esporte",
        "liga",
        "jogo",
        "mandante",
        "visitante",
        "mercado",
        "pick",
        "linha",
        "modelo_versao",
        "odd_ofertada",
        "odd_mediana",
        "odd_mercado_base",
        "odd_melhor",
        "bookmaker_melhor",
        "odd_valor",
        "probabilidade_final",
        "probabilidade_pre_ia",
        "probabilidade_estagio",
        "selection_role",
        "selection_rank",
        "edge",
        "observacoes",
    ]
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column) for column in columns})


def write_handicap_audit_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = [
        "data",
        "jogo",
        "mandante",
        "visitante",
        "pick",
        "linha",
        "odd",
        "odd_mediana",
        "odd_melhor",
        "bookmaker_melhor",
        "prob_hist",
        "prob_sim",
        "prob_no_vig",
        "prob_final",
        "odd_justa",
        "edge",
        "sample_size_hist",
        "covers_historicos",
        "losses_historicos",
        "cover_rate_raw",
        "cover_rate_shrunk",
        "expected_home",
        "expected_away",
        "expected_margin_home",
        "expected_margin_away",
        "score_distribution",
        "runs_overdispersion",
        "passou_filtros",
        "motivo_descarte",
        "warnings",
    ]
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def build_handicap_shadow_diagnostics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    published = (
        [row for row in rows if bool(row.get("passou_filtros"))]
        if HANDICAP_ENABLED_MLB_V1_1
        else []
    )
    discarded = [row for row in rows if not bool(row.get("passou_filtros"))]
    discard_reasons: dict[str, int] = defaultdict(int)
    for row in discarded:
        reason = str(row.get("motivo_descarte") or "UNKNOWN")
        discard_reasons[reason] += 1

    return {
        "enabled": HANDICAP_ENABLED_MLB_V1_1,
        "mode": "controlled_activation" if HANDICAP_ENABLED_MLB_V1_1 else "shadow_blocked",
        "model_version": BASEBALL_MLB_HANDICAP_MODEL_VERSION,
        "published": bool(published),
        "published_count": len(published),
        "discarded_count": len(discarded),
        "diagnostics": rows,
        "summary": {
            "published_count": len(published),
            "discarded_count": len(discarded),
            "discard_reasons": dict(discard_reasons),
            "controlled_activation": HANDICAP_CONTROLLED_ACTIVATION_MLB_V1_1,
            "shadow_enabled": HANDICAP_SHADOW_ENABLED,
            "selected_reason": HANDICAP_SELECTED_CONTROLLED,
        },
    }


def extract_runs(row: dict[str, str], scored: bool) -> float | None:
    candidates = (
        ["runs_for", "corridas_marcadas", "pontos_marcados", "team_score", "score_for", "rf", "R"]
        if scored
        else ["runs_against", "corridas_sofridas", "pontos_sofridos", "opponent_score", "score_against", "ra", "RA"]
    )
    lowered = {normalize_key(k): v for k, v in row.items()}
    for candidate in candidates:
        value = lowered.get(normalize_key(candidate))
        parsed = parse_float(value)
        if parsed is not None:
            return parsed
    return None


def team_sigla(name: str) -> str | None:
    if name in MLB_TEAMS:
        return MLB_TEAMS[name]
    normalized = normalize_key(name)
    for team, sigla in MLB_TEAMS.items():
        if normalize_key(team) == normalized:
            return sigla
    if re.fullmatch(r"[A-Z]{2,3}", name.strip()):
        return name.strip()
    return None


def infer_season(games: list[dict[str, Any]]) -> int:
    for game in games:
        date_value = game.get("data") or game.get("date")
        try:
            return datetime.strptime(str(date_value), "%Y-%m-%d").year
        except ValueError:
            continue
    return datetime.utcnow().year


def normalize_date(value: Any) -> str:
    text = clean(value)
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return text


def normalize_time(value: Any) -> str:
    match = re.search(r"(\d{1,2}):(\d{2})", clean(value))
    return f"{int(match.group(1)):02d}:{match.group(2)}" if match else ""


def normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", clean(value).lower())


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def parse_float(value: Any) -> float | None:
    text = clean(value).replace(",", ".")
    if not text:
        return None
    match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def is_pick_team(pick: str, team: str) -> bool:
    return normalize_key(pick) == normalize_key(team) or normalize_key(team) in normalize_key(pick)


def format_line(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:g}".replace(".", "_")


def format_signed_line(value: float | None) -> str:
    if value is None:
        return ""
    return f"+{value:g}" if value > 0 else f"{value:g}"


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def implied_probability(odd: float | None) -> float:
    return 1 / odd if odd and odd > 1 else 0.0


def no_vig_probability(odd: float | None, other_odd: float | None) -> float:
    own = implied_probability(odd)
    other = implied_probability(other_odd)
    total = own + other
    return own / total if total > 0 else own


def weighted(values: dict[str, float], weights: dict[str, float]) -> float:
    return max(0.01, min(0.99, sum(values.get(key, 0.0) * weight for key, weight in weights.items())))


def poisson_pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * (lam**k) / math.factorial(k)


def poisson_cdf(k: int, lam: float) -> float:
    return sum(poisson_pmf(i, lam) for i in range(max(0, k) + 1))


def negative_binomial_pmf(k: int, mean_value: float, dispersion: float = RUNS_OVERDISPERSION) -> float:
    if k < 0 or mean_value <= 0:
        return 0.0
    if dispersion <= 1e-12:
        return poisson_pmf(k, mean_value)
    size = 1.0 / dispersion
    success_probability = size / (size + mean_value)
    log_probability = (
        math.lgamma(k + size)
        - math.lgamma(size)
        - math.lgamma(k + 1)
        + size * math.log(success_probability)
        + k * math.log1p(-success_probability)
    )
    return math.exp(log_probability)


def score_distribution(
    mean_value: float,
    dispersion: float = RUNS_OVERDISPERSION,
    max_runs: int = MAX_DISTRIBUTION_RUNS,
) -> list[float]:
    probabilities = [negative_binomial_pmf(k, mean_value, dispersion) for k in range(max_runs + 1)]
    mass = sum(probabilities)
    if mass <= 0:
        return [1.0, *([0.0] * max_runs)]
    return [probability / mass for probability in probabilities]


def win_probabilities_overdispersed(
    home_lam: float,
    away_lam: float,
    dispersion: float = RUNS_OVERDISPERSION,
) -> tuple[float, float, float]:
    home_distribution = score_distribution(home_lam, dispersion)
    away_distribution = score_distribution(away_lam, dispersion)
    home_win = 0.0
    away_win = 0.0
    tie = 0.0
    for home_runs, p_home in enumerate(home_distribution):
        for away_runs, p_away in enumerate(away_distribution):
            score_probability = p_home * p_away
            if home_runs > away_runs:
                home_win += score_probability
            elif away_runs > home_runs:
                away_win += score_probability
            else:
                tie += score_probability
    decided = home_win + away_win
    if decided <= 0:
        return 0.5, 0.5, tie
    return home_win / decided, away_win / decided, tie


def total_runs_probability_overdispersed(
    home_lam: float,
    away_lam: float,
    line: float,
    side: str,
    dispersion: float = RUNS_OVERDISPERSION,
) -> float:
    normalized_side = normalize_key(side)
    home_distribution = score_distribution(home_lam, dispersion)
    away_distribution = score_distribution(away_lam, dispersion)
    probability = 0.0
    for home_runs, p_home in enumerate(home_distribution):
        for away_runs, p_away in enumerate(away_distribution):
            total = home_runs + away_runs
            if normalized_side == "over" and total > line:
                probability += p_home * p_away
            elif normalized_side == "under" and total < line:
                probability += p_home * p_away
    return max(0.01, min(0.99, probability))


def win_probability_poisson(home_lam: float, away_lam: float, max_runs: int = 20) -> float:
    del max_runs
    home_win, _away_win, _tie = win_probabilities_overdispersed(
        home_lam, away_lam, dispersion=0.0
    )
    return home_win


def handicap_cover_probability_overdispersed(
    expected_home: float,
    expected_away: float,
    side: str,
    line: float,
    dispersion: float = RUNS_OVERDISPERSION,
    max_runs: int = MAX_DISTRIBUTION_RUNS,
) -> float:
    normalized_side = str(side).strip().lower()
    if normalized_side not in {"home", "away"}:
        raise ValueError("side deve ser 'home' ou 'away'")

    home_distribution = score_distribution(expected_home, dispersion, max_runs)
    away_distribution = score_distribution(expected_away, dispersion, max_runs)
    prob = 0.0
    for home_runs, p_home in enumerate(home_distribution):
        for away_runs, p_away in enumerate(away_distribution):
            score_prob = p_home * p_away
            margin = home_runs - away_runs if normalized_side == "home" else away_runs - home_runs
            if margin + line > 0:
                prob += score_prob
    return max(0.01, min(0.99, prob))


def handicap_cover_probability_poisson(
    expected_home: float,
    expected_away: float,
    side: str,
    line: float,
    max_runs: int = MAX_DISTRIBUTION_RUNS,
) -> float:
    """Compatibility wrapper for callers that still use the legacy name."""
    return handicap_cover_probability_overdispersed(
        expected_home,
        expected_away,
        side,
        line,
        dispersion=RUNS_OVERDISPERSION,
        max_runs=max_runs,
    )


def handicap_probability(team_lam: float, opponent_lam: float, line: float, max_runs: int = 20) -> float:
    del max_runs
    team_distribution = score_distribution(team_lam, RUNS_OVERDISPERSION)
    opponent_distribution = score_distribution(opponent_lam, RUNS_OVERDISPERSION)
    prob = 0.0
    for team_runs, p_team in enumerate(team_distribution):
        for opp_runs, p_opponent in enumerate(opponent_distribution):
            if team_runs + line > opp_runs:
                prob += p_team * p_opponent
    return max(0.01, min(0.99, prob))


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(clean_json(payload), ensure_ascii=False))


def clean_json(value: Any) -> Any:
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, dict):
        return {key: clean_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_json(item) for item in value]
    return value


if __name__ == "__main__":
    main()
