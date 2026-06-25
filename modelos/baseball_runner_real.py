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
from pathlib import Path
from typing import Any

HIST_DIR = Path(os.getenv("BASEBALL_HIST_DIR", "/home/ubuntu/jupyter/dados_baseball"))

MODEL_VERSION = "MLB_V1_1"
HANDICAP_ENABLED_MLB_V1_1 = True
HANDICAP_SHADOW_MODE_MLB_V1_1 = True
HANDICAP_MARKET_STATUS_MLB_V1_1 = "HANDICAP_FUNCTIONAL_NOT_VALIDATED"
HISTORICAL_PRIOR = 0.50
HISTORICAL_PRIOR_STRENGTH = 10.0
OVERCONFIDENCE_PROB_CUTOFF = 0.70

PROB_ML_WEIGHTS = {"vit": 0.30, "sim": 0.40, "vig": 0.30}
PROB_OU_WEIGHTS = {"hist": 0.30, "sim": 0.40, "vig": 0.30}
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
        stats_cache: dict[str, TeamStats] = {}
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

            home_stats = stats_cache.setdefault(home_sigla, load_team_stats(home_sigla, season))
            away_stats = stats_cache.setdefault(away_sigla, load_team_stats(away_sigla, season))
            game_context = build_game_context(game, home_stats, away_stats, season)
            context_parts.append(game_context)
            prognosticos.extend(generate_game_picks(game, home_stats, away_stats, game_context, handicap_audit_rows))

        write_output_csv(output_path, prognosticos)
        write_handicap_audit_csv(HANDICAP_AUDIT_PATH, handicap_audit_rows)
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
    odd = parse_float(row.get("odd"))
    if not odd or odd <= 1:
        return

    home = game["home"]
    away = game["away"]
    pick_key = normalize_key(pick)
    line_key = format_line(linha)

    if any(token in mercado for token in ("moneyline", "homeaway", "vencedor")):
        if is_pick_team(pick, home):
            set_best(game["moneyline"], "home", odd)
            game["wide"]["odds_HomeAway_FT_including_OT_1"] = game["moneyline"]["home"]
        elif is_pick_team(pick, away):
            set_best(game["moneyline"], "away", odd)
            game["wide"]["odds_HomeAway_FT_including_OT_2"] = game["moneyline"]["away"]
        return

    if any(token in mercado for token in ("overunder", "totaldecorridas", "totalruns", "total")) and linha is not None:
        if "over" in pick_key:
            set_best(game["totals"][line_key], "over", odd)
            game["wide"][f"odds_OverUnder_FT_including_OT_{line_key}_Over"] = game["totals"][line_key]["over"]
        elif "under" in pick_key:
            set_best(game["totals"][line_key], "under", odd)
            game["wide"][f"odds_OverUnder_FT_including_OT_{line_key}_Under"] = game["totals"][line_key]["under"]
        return

    if any(token in mercado for token in ("handicap", "runline", "asian")) and linha is not None:
        side = "home" if is_pick_team(pick, home) else "away" if is_pick_team(pick, away) else None
        if not side:
            return
        key = format_signed_line(linha)
        set_best(game["handicaps"][key], side, odd)
        game["handicaps"][key][f"{side}_line"] = linha


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


def load_team_stats(sigla: str, season: int) -> TeamStats:
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
            year_rows = list(csv.DictReader(fh))
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

    last5_for = scored[-5:] or scored
    last5_against = allowed[-5:] or allowed
    return TeamStats(
        sigla=sigla,
        games=len(scored),
        avg_for=mean(scored),
        avg_against=mean(allowed),
        win_rate=wins / valid_results if valid_results else 0.5,
        last5_for=mean(last5_for),
        last5_against=mean(last5_against),
        streak=streak,
        current_rows=rows_by_year.get(season, []),
        previous_rows=rows_by_year.get(season - 1, []),
        all_rows=rows,
    )


def generate_game_picks(
    game: dict[str, Any],
    home: TeamStats,
    away: TeamStats,
    game_context: str,
    handicap_audit_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    expected_home = max(0.2, (home.avg_for * 0.55) + (away.avg_against * 0.45))
    expected_away = max(0.2, (away.avg_for * 0.55) + (home.avg_against * 0.45))
    total_expected = expected_home + expected_away
    diff = expected_home - expected_away
    picks: list[dict[str, Any]] = []

    home_win_sim = win_probability_poisson(expected_home, expected_away)
    away_win_sim = 1 - home_win_sim
    add_moneyline_pick(picks, game, home, away, "home", home_win_sim, game_context)
    add_moneyline_pick(picks, game, home, away, "away", away_win_sim, game_context)

    for line_key, odds in game["totals"].items():
        line = parse_float(line_key.replace("_", "."))
        if line is None:
            continue
        over_sim = 1 - poisson_cdf(math.floor(line), total_expected)
        under_sim = poisson_cdf(math.floor(line), total_expected)
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
        )

    if not HANDICAP_ENABLED_MLB_V1_1:
        return picks
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
        )

    return picks


def add_moneyline_pick(
    picks: list[dict[str, Any]],
    game: dict[str, Any],
    home: TeamStats,
    away: TeamStats,
    side: str,
    sim_prob: float,
    game_context: str,
) -> None:
    odd = game["moneyline"].get(side)
    if not odd:
        return
    other_odd = game["moneyline"].get("away" if side == "home" else "home")
    if not other_odd:
        return
    vig_prob = no_vig_probability(odd, other_odd)
    hist_prob = home.win_rate if side == "home" else away.win_rate
    prob = weighted({"vit": hist_prob, "sim": sim_prob, "vig": vig_prob}, PROB_ML_WEIGHTS)
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
            "sample_size_hist": (home.games if side == "home" else away.games),
            "warnings": [],
        },
    )


def add_total_pick(
    picks: list[dict[str, Any]],
    game: dict[str, Any],
    side: str,
    line: float,
    odd: float | None,
    sim_prob: float,
    hist_prob: float,
    other_odd: float | None,
    game_context: str,
    sample_size_hist: int,
    warnings: list[str],
) -> None:
    if not odd:
        return
    if not other_odd:
        return
    vig_prob = no_vig_probability(odd, other_odd)
    prob = weighted({"hist": hist_prob, "sim": sim_prob, "vig": vig_prob}, PROB_OU_WEIGHTS)
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
            "sample_size_hist": sample_size_hist,
            "warnings": warnings,
        },
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
            odd = odds.get(side)
            line = odds.get(f"{side}_line")
            if odd is None or line is None:
                continue
            by_side_line[(side, float(line))] = {"side": side, "line": float(line), "odd": float(odd)}

    candidates: list[dict[str, Any]] = []
    for (side, line), item in sorted(by_side_line.items(), key=lambda pair: (pair[0][0], pair[0][1])):
        other_side = "away" if side == "home" else "home"
        other = by_side_line.get((other_side, -line))
        candidates.append({**item, "other_odd": other.get("odd") if other else None})
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
) -> None:
    if not HANDICAP_ENABLED_MLB_V1_1:
        return

    warnings = ["handicap_mlb_v1_1_shadow_funcional_nao_validado"]
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
        "expected_home": expected_home,
        "expected_away": expected_away,
        "expected_margin_home": expected_margin_home,
        "expected_margin_away": expected_margin_away,
        "warnings": ";".join(warnings),
    }

    def audit(reason: str, passed: bool = False, extra: dict[str, Any] | None = None) -> None:
        if handicap_audit_rows is None:
            return
        handicap_audit_rows.append(
            {
                **base_audit,
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
    sim_prob = handicap_cover_probability_poisson(expected_home, expected_away, side, line)
    vig_prob = no_vig_probability(odd, other_odd)
    prob = weighted({"hist": hist_prob, "sim": sim_prob, "vig": vig_prob}, PROB_HC_WEIGHTS)
    odd_valor = 1 / prob if prob > 0 else 0.0
    edge = (odd * prob - 1) * 100
    common_audit = {
        "prob_hist": hist_prob,
        "prob_sim": sim_prob,
        "prob_no_vig": vig_prob,
        "prob_final": prob,
        "odd_justa": odd_valor,
        "edge": edge,
        "sample_size_hist": hist["sample_size_hist"],
        "covers_historicos": hist["covers"],
        "losses_historicos": hist["losses"],
        "cover_rate_raw": hist["cover_rate_raw"],
        "cover_rate_shrunk": hist["cover_rate_shrunk"],
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
        f"Handicap MLB shadow: probabilidade simulada de cobertura {sim_prob:.2%}",
        {
            "prob_hist": hist_prob,
            "prob_sim": sim_prob,
            "prob_no_vig": vig_prob,
            "sample_size_hist": hist["sample_size_hist"],
            "warnings": warnings,
        },
        min_prob=HANDICAP_MIN_PROB,
        max_prob=HANDICAP_MAX_PROB,
        min_edge=HANDICAP_MIN_EDGE,
        extra_fields={
            "shadow_mode": HANDICAP_SHADOW_MODE_MLB_V1_1,
            "market_status": HANDICAP_MARKET_STATUS_MLB_V1_1,
            "model_version": MODEL_VERSION,
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
    debug_text = (
        f" modelo_versao={MODEL_VERSION}; prob_hist={float(diagnostics.get('prob_hist', 0.0)):.4f};"
        f" prob_sim={float(diagnostics.get('prob_sim', 0.0)):.4f};"
        f" prob_no_vig={float(diagnostics.get('prob_no_vig', 0.0)):.4f};"
        f" prob_final={prob:.4f}; sample_size_hist={int(diagnostics.get('sample_size_hist') or 0)};"
        f" warnings={','.join(str(item) for item in warnings) if warnings else 'nenhum'}."
    )
    observacoes = (
        f"Modelo Baseball MLB. {extra}. Odd ofertada {odd:.3f}; odd valor {odd_valor:.3f}; "
        f"probabilidade final {prob * 100:.2f}%; edge {edge:.2f}%.{debug_text}"
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
            "odd_valor": round(odd_valor, 3),
            "probabilidade": round(prob * 100, 2),
            "probabilidade_final": round(prob * 100, 2),
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
    expected_home = (home.avg_for * 0.55) + (away.avg_against * 0.45)
    expected_away = (away.avg_for * 0.55) + (home.avg_against * 0.45)
    total_expected = expected_home + expected_away
    delta_rpi = home.win_rate - away.win_rate
    home_record = season_record(home.current_rows)
    away_record = season_record(away.current_rows)
    home_rank = latest_value(home.current_rows, "Rank") or "-"
    away_rank = latest_value(away.current_rows, "Rank") or "-"
    home_division = MLB_TEAM_DIVISION.get(home.sigla, "MLB")
    away_division = MLB_TEAM_DIVISION.get(away.sigla, "MLB")
    home_win_prob = win_probability_poisson(expected_home, expected_away) * 100
    away_win_prob = 100 - home_win_prob
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


def historical_total_probability(home: TeamStats, away: TeamStats, line: float, side: str) -> tuple[float, int, list[str]]:
    totals: list[float] = []
    for row in [*home.all_rows, *away.all_rows]:
        runs_for = extract_runs(row, True)
        runs_against = extract_runs(row, False)
        if runs_for is None or runs_against is None:
            continue
        totals.append(runs_for + runs_against)

    sample_size = len(totals)
    warnings: list[str] = []
    if sample_size == 0:
        warnings.append("hist_total_fallback_prior_050")
        return HISTORICAL_PRIOR, 0, warnings

    normalized_side = normalize_key(side)
    if normalized_side == "over":
        hits = sum(1 for total in totals if total > line)
    elif normalized_side == "under":
        hits = sum(1 for total in totals if total < line)
    else:
        warnings.append("hist_total_side_invalido_prior_050")
        return HISTORICAL_PRIOR, sample_size, warnings

    prob_raw = hits / sample_size
    if sample_size < 10:
        warnings.append("hist_total_amostra_baixa_shrinkage")
    elif sample_size >= 20:
        warnings.append("hist_total_amostra_confiavel")
    return apply_shrinkage(prob_raw, sample_size), sample_size, warnings


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
    cover_rate_shrunk = apply_shrinkage(cover_rate_raw, sample_size, prior=prior, prior_strength=prior_strength)
    return {
        "sample_size_hist": sample_size,
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
    warnings: list[str],
) -> str:
    expected_margin_home = expected_home - expected_away
    expected_margin_away = expected_away - expected_home
    return "\n".join(
        [
            "--- HANDICAP / RUN LINE MLB V1.1 SHADOW ---",
            f"Mercado: Handicap / Run Line",
            f"Pick: {pick}",
            f"Linha: {format_signed_line(line)}",
            f"Odd ofertada: {odd:.3f}",
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
            f"No-vig pair: odd_pick={odd:.3f}; odd_oposta={other_odd:.3f}",
            f"Warnings: {', '.join(warnings) if warnings else 'nenhum'}",
            f"shadow_mode: {HANDICAP_SHADOW_MODE_MLB_V1_1}",
            f"market_status: {HANDICAP_MARKET_STATUS_MLB_V1_1}",
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
        "odd_valor",
        "probabilidade_final",
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
        "passou_filtros",
        "motivo_descarte",
        "warnings",
    ]
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


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


def win_probability_poisson(home_lam: float, away_lam: float, max_runs: int = 20) -> float:
    prob = 0.0
    for home_runs in range(max_runs + 1):
        p_home = poisson_pmf(home_runs, home_lam)
        for away_runs in range(max_runs + 1):
            if home_runs > away_runs:
                prob += p_home * poisson_pmf(away_runs, away_lam)
    return max(0.01, min(0.99, prob))


def handicap_cover_probability_poisson(expected_home: float, expected_away: float, side: str, line: float, max_runs: int = 20) -> float:
    normalized_side = str(side).strip().lower()
    if normalized_side not in {"home", "away"}:
        raise ValueError("side deve ser 'home' ou 'away'")

    prob = 0.0
    for home_runs in range(max_runs + 1):
        p_home = poisson_pmf(home_runs, expected_home)
        for away_runs in range(max_runs + 1):
            score_prob = p_home * poisson_pmf(away_runs, expected_away)
            margin = home_runs - away_runs if normalized_side == "home" else away_runs - home_runs
            if margin + line > 0:
                prob += score_prob
    return max(0.01, min(0.99, prob))


def handicap_probability(team_lam: float, opponent_lam: float, line: float, max_runs: int = 20) -> float:
    prob = 0.0
    for team_runs in range(max_runs + 1):
        p_team = poisson_pmf(team_runs, team_lam)
        for opp_runs in range(max_runs + 1):
            if team_runs + line > opp_runs:
                prob += p_team * poisson_pmf(opp_runs, opponent_lam)
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
