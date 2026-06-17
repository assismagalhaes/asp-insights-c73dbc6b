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

PROB_ML_WEIGHTS = {"vit": 0.30, "sim": 0.40, "vig": 0.30}
PROB_OU_WEIGHTS = {"hist": 0.30, "sim": 0.40, "vig": 0.30}
HANDICAP_WEIGHTS = {"hist": 0.25, "sim": 0.45, "vig": 0.30}

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
            prognosticos.extend(generate_game_picks(game, home_stats, away_stats, game_context))

        write_output_csv(output_path, prognosticos)
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
            rows.extend(list(csv.DictReader(fh)))

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
    )


def generate_game_picks(game: dict[str, Any], home: TeamStats, away: TeamStats, game_context: str) -> list[dict[str, Any]]:
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
        hist_over = 1.0 if (home.avg_for + away.avg_for) > line else 0.0
        hist_under = 1.0 - hist_over
        add_total_pick(picks, game, "Over", line, odds.get("over"), over_sim, hist_over, odds.get("under"), game_context)
        add_total_pick(picks, game, "Under", line, odds.get("under"), under_sim, hist_under, odds.get("over"), game_context)

    for _line_key, odds in game["handicaps"].items():
        if "home" in odds and "home_line" in odds:
            prob = handicap_probability(expected_home, expected_away, odds["home_line"])
            add_handicap_pick(picks, game, game["home"], odds["home_line"], odds.get("home"), prob, diff, game_context)
        if "away" in odds and "away_line" in odds:
            prob = handicap_probability(expected_away, expected_home, odds["away_line"])
            add_handicap_pick(picks, game, game["away"], odds["away_line"], odds.get("away"), prob, -diff, game_context)

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
    vig_prob = no_vig_probability(odd, other_odd)
    hist_prob = home.win_rate if side == "home" else away.win_rate
    prob = weighted({"vit": hist_prob, "sim": sim_prob, "vig": vig_prob}, PROB_ML_WEIGHTS)
    team = game["home"] if side == "home" else game["away"]
    append_if_ev(picks, game, "Moneyline", team, "", odd, prob, game_context, f"Sim Win%: {sim_prob:.2%}")


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
) -> None:
    if not odd:
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
    )


def add_handicap_pick(
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
) -> None:
    if prob <= 0:
        return
    odd_valor = 1 / prob
    edge = (odd * prob - 1) * 100
    if not (odd > odd_valor and odd > 1.25 and odd <= 2.00):
        return
    observacoes = (
        f"Modelo Baseball MLB. {extra}. Odd ofertada {odd:.3f}; odd valor {odd_valor:.3f}; "
        f"probabilidade final {prob * 100:.2f}%; edge {edge:.2f}%."
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


def build_game_context(game: dict[str, Any], home: TeamStats, away: TeamStats, season: int) -> str:
    expected_home = (home.avg_for * 0.55) + (away.avg_against * 0.45)
    expected_away = (away.avg_for * 0.55) + (home.avg_against * 0.45)
    delta_rpi = home.win_rate - away.win_rate
    return (
        f"Confronto: {game['home']} vs {game['away']} ({game['data']} {game['hora']}).\n"
        f"Temporadas usadas: {season - 1}/{season}. Pesos ML={PROB_ML_WEIGHTS}; "
        f"OU={PROB_OU_WEIGHTS}; Handicap={HANDICAP_WEIGHTS}.\n"
        f"{home.sigla}: jogos={home.games}, RPI proxy={home.win_rate:.3f}, "
        f"corridas marcadas={home.avg_for:.2f}, sofridas={home.avg_against:.2f}, streak={home.streak}.\n"
        f"{away.sigla}: jogos={away.games}, RPI proxy={away.win_rate:.3f}, "
        f"corridas marcadas={away.avg_for:.2f}, sofridas={away.avg_against:.2f}, streak={away.streak}.\n"
        f"Delta RPI proxy: {delta_rpi:.3f}. Expectativa de corridas: {game['home']} {expected_home:.2f} x "
        f"{expected_away:.2f} {game['away']}; total esperado {expected_home + expected_away:.2f}."
    )


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
