from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Any


MARKET_NAMES = {
    "1x2": "1X2",
    "home-away": "Home/Away",
    "moneyline": "Home/Away",
    "over-under": "Over/Under",
    "ah": "Asian Handicap",
    "asian-handicap": "Asian Handicap",
    "handicap": "Asian Handicap",
    "bts": "Ambos Marcam",
    "both-teams-score": "Ambos Marcam",
    "double": "Dupla Chance",
    "double-chance": "Dupla Chance",
}

BASEBALL_TEAM_NAME_ALIASES = {
    "Oakland Athletics": "Athletics",
}


def to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        text = str(value).strip().replace(",", ".")
        if text.startswith("+"):
            text = text[1:]
        return float(text)
    except ValueError:
        return None


def is_half_point_line(value: Any) -> bool:
    number = to_float(value)
    if number is None:
        return False
    fraction = abs(number) % 1
    return abs(fraction - 0.5) < 1e-9


def _fmt_line(value: float | None) -> str | None:
    if value is None:
        return None
    return f"{value:g}"


def _odd(value: Any) -> float | None:
    number = to_float(value)
    return number if number and number > 1 else None


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _avg(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def _std(values: list[float]) -> float:
    return statistics.pstdev(values) if len(values) > 1 else 0.0


def _game_value(game: dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = game.get(key)
        if value not in (None, ""):
            return value
    return default


def _is_baseball_context(raw: dict[str, Any], game: dict[str, Any]) -> bool:
    sport = str(_game_value(game, "sport", "esporte", default=raw.get("sport") or raw.get("esporte") or "")).lower()
    league = str(_game_value(game, "league", "liga", default=raw.get("league") or raw.get("liga") or "")).lower()
    return "baseball" in sport or "mlb" in league


def _is_wnba_context(raw: dict[str, Any], game: dict[str, Any]) -> bool:
    sport = str(_game_value(game, "sport", "esporte", default=raw.get("sport") or raw.get("esporte") or "")).lower()
    league = str(_game_value(game, "league", "liga", default=raw.get("league") or raw.get("liga") or "")).lower()
    return "basketball" in sport and "wnba" in league


def _normalize_baseball_team_name(value: Any) -> str:
    text = str(value or "").strip()
    return BASEBALL_TEAM_NAME_ALIASES.get(text, text)


def _normalize_wnba_team_name(value: Any) -> str:
    text = str(value or "").strip()
    if text.endswith(" F"):
        return f"{text[:-2]} W"
    return text


def _normalize_baseball_text(value: Any) -> str:
    text = str(value or "").strip()
    for original, replacement in BASEBALL_TEAM_NAME_ALIASES.items():
        text = text.replace(original, replacement)
    return text


def _base_row(raw: dict[str, Any], game: dict[str, Any]) -> dict[str, Any]:
    game_id = str(_game_value(game, "game_id", "id", default=""))
    sport = str(_game_value(game, "sport", "esporte", default=raw.get("sport") or raw.get("esporte") or "Baseball"))
    league = str(_game_value(game, "league", "liga", default=raw.get("league") or raw.get("liga") or "MLB"))
    raw_home = str(_game_value(game, "home_team", "home", "mandante", default="")).strip()
    raw_away = str(_game_value(game, "away_team", "away", "visitante", default="")).strip()
    home = raw_home
    away = raw_away
    if _is_baseball_context(raw, game):
        home = _normalize_baseball_team_name(home)
        away = _normalize_baseball_team_name(away)
    if _is_wnba_context(raw, game):
        home = _normalize_wnba_team_name(home)
        away = _normalize_wnba_team_name(away)
    source_url = str(_game_value(game, "match_url", "url", "link", default=""))
    jogo = str(_game_value(game, "jogo", default=f"{home} vs {away}".strip()))
    if _is_baseball_context(raw, game):
        jogo = _normalize_baseball_text(jogo) or f"{home} vs {away}".strip()
    if _is_wnba_context(raw, game):
        jogo = jogo.replace(raw_home, home).replace(raw_away, away) or f"{home} vs {away}".strip()
    return {
        "source": "OddsAgora",
        "fonte": "OddsAgora",
        "sport": sport,
        "esporte": sport,
        "league": league,
        "liga": league,
        "game_id": game_id,
        "date": _game_value(game, "date", "data", default=""),
        "data": _game_value(game, "date", "data", default=""),
        "time": _game_value(game, "time", "hora", default=""),
        "hora": _game_value(game, "time", "hora", default=""),
        "home_team": home,
        "mandante": home,
        "away_team": away,
        "visitante": away,
        "jogo": jogo,
        "period": "FT incluindo PR",
        "capturado_em": raw.get("created_at") or datetime.now(timezone.utc).isoformat(),
        "raw_ref": {
            "game_id": game_id,
            "source_url": source_url,
        },
    }


def _market_payload(game: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    markets = game.get("markets")
    if not isinstance(markets, dict):
        return []
    for key in keys:
        value = markets.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _append_moneyline(rows: list[dict[str, Any]], raw: dict[str, Any], game: dict[str, Any]) -> None:
    base = _base_row(raw, game)
    for item in _market_payload(game, "1x2", "home-away", "moneyline"):
        bookmaker = str(item.get("bookmaker") or item.get("book") or "")
        market_key = "1x2" if item.get("draw_odd") or item.get("X") else "home-away"
        options = [
            ("home", base["home_team"], item.get("home_odd") or item.get("odd_home") or item.get("1")),
        ]
        if market_key == "1x2":
            options.append(("draw", "Empate", item.get("draw_odd") or item.get("odd_draw") or item.get("X")))
        options.append(("away", base["away_team"], item.get("away_odd") or item.get("odd_away") or item.get("2")))
        for side, pick, odd_value in options:
            odd = _odd(odd_value)
            if odd is None:
                continue
            rows.append(
                {
                    **base,
                    "market": MARKET_NAMES[market_key],
                    "mercado": MARKET_NAMES[market_key],
                    "side": side,
                    "pick": pick,
                    "line": None,
                    "linha": None,
                    "odd": odd,
                    "bookmaker": bookmaker,
                    "payout": item.get("payout"),
                    "movement": item.get("movement"),
                    "raw_ref": {**base["raw_ref"], "market": market_key, "row": item},
                }
            )


def _append_totals(rows: list[dict[str, Any]], raw: dict[str, Any], game: dict[str, Any]) -> None:
    base = _base_row(raw, game)
    for item in _market_payload(game, "over-under"):
        line = to_float(item.get("line") or item.get("total") or item.get("linha"))
        if not is_half_point_line(line):
            continue
        bookmaker = str(item.get("bookmaker") or item.get("book") or "")
        for side, label, odd_value in (
            ("over", "Over", item.get("odd_over") or item.get("over") or item.get("Over")),
            ("under", "Under", item.get("odd_under") or item.get("under") or item.get("Under")),
        ):
            odd = _odd(odd_value)
            if odd is None:
                continue
            line_text = _fmt_line(line)
            rows.append(
                {
                    **base,
                    "market": MARKET_NAMES["over-under"],
                    "mercado": MARKET_NAMES["over-under"],
                    "side": side,
                    "pick": f"{label} {line_text}",
                    "line": line,
                    "linha": line_text,
                    "odd": odd,
                    "bookmaker": bookmaker,
                    "payout": item.get("payout"),
                    "movement": item.get("movement"),
                    "raw_ref": {**base["raw_ref"], "market": "over-under", "row": item},
                }
            )


def _append_handicap(rows: list[dict[str, Any]], raw: dict[str, Any], game: dict[str, Any]) -> None:
    base = _base_row(raw, game)
    for item in _market_payload(game, "ah", "asian-handicap", "handicap"):
        home_line = to_float(item.get("line") or item.get("handicap") or item.get("linha"))
        if not is_half_point_line(home_line):
            continue
        bookmaker = str(item.get("bookmaker") or item.get("book") or "")
        away_line = -home_line if home_line is not None else None
        for side, pick, line, odd_value in (
            ("home", base["home_team"], home_line, item.get("home_odd") or item.get("odd_home") or item.get("1")),
            ("away", base["away_team"], away_line, item.get("away_odd") or item.get("odd_away") or item.get("2")),
        ):
            odd = _odd(odd_value)
            if odd is None:
                continue
            line_text = _fmt_line(line)
            rows.append(
                {
                    **base,
                    "market": MARKET_NAMES["ah"],
                    "mercado": MARKET_NAMES["ah"],
                    "side": side,
                    "pick": f"{pick} {line_text}",
                    "line": line,
                    "linha": line_text,
                    "odd": odd,
                    "bookmaker": bookmaker,
                    "payout": item.get("payout"),
                    "movement": item.get("movement"),
                    "raw_ref": {**base["raw_ref"], "market": "ah", "row": item},
                }
            )


def _append_bts(rows: list[dict[str, Any]], raw: dict[str, Any], game: dict[str, Any]) -> None:
    base = _base_row(raw, game)
    for item in _market_payload(game, "bts", "both-teams-score"):
        bookmaker = str(item.get("bookmaker") or item.get("book") or "")
        for side, pick, odd_value in (
            ("yes", "Sim", item.get("yes_odd") or item.get("yes") or item.get("Sim")),
            ("no", "Não", item.get("no_odd") or item.get("no") or item.get("Nao") or item.get("Não")),
        ):
            odd = _odd(odd_value)
            if odd is None:
                continue
            rows.append(
                {
                    **base,
                    "market": MARKET_NAMES["bts"],
                    "mercado": MARKET_NAMES["bts"],
                    "side": side,
                    "pick": pick,
                    "line": None,
                    "linha": None,
                    "odd": odd,
                    "bookmaker": bookmaker,
                    "payout": item.get("payout"),
                    "movement": item.get("movement"),
                    "raw_ref": {**base["raw_ref"], "market": "bts", "row": item},
                }
            )


def _append_double_chance(rows: list[dict[str, Any]], raw: dict[str, Any], game: dict[str, Any]) -> None:
    base = _base_row(raw, game)
    for item in _market_payload(game, "double", "double-chance"):
        bookmaker = str(item.get("bookmaker") or item.get("book") or "")
        for side, pick, odd_value in (
            ("home_draw", "1X", item.get("home_draw_odd") or item.get("1X") or item.get("1x")),
            ("away_draw", "X2", item.get("away_draw_odd") or item.get("X2") or item.get("x2")),
            ("home_away", "12", item.get("home_away_odd") or item.get("12")),
        ):
            odd = _odd(odd_value)
            if odd is None:
                continue
            rows.append(
                {
                    **base,
                    "market": MARKET_NAMES["double"],
                    "mercado": MARKET_NAMES["double"],
                    "side": side,
                    "pick": pick,
                    "line": None,
                    "linha": None,
                    "odd": odd,
                    "bookmaker": bookmaker,
                    "payout": item.get("payout"),
                    "movement": item.get("movement"),
                    "raw_ref": {**base["raw_ref"], "market": "double", "row": item},
                }
            )


def _pair_key(row: dict[str, Any]) -> tuple[Any, ...]:
    line = row.get("line")
    if row.get("market") == MARKET_NAMES["ah"] and line is not None:
        line = abs(float(line))
    return (row.get("game_id"), row.get("market"), line, row.get("bookmaker"))


def _attach_consensus(rows: list[dict[str, Any]]) -> None:
    pair_probs: dict[tuple[Any, ...], dict[str, list[float]]] = {}
    overrounds: dict[tuple[Any, ...], list[float]] = {}
    by_pair: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for row in rows:
        by_pair.setdefault(_pair_key(row), []).append(row)

    for key, group in by_pair.items():
        sides = {str(row.get("side")): row for row in group}
        if len(sides) < 2:
            continue
        odds = {side: float(row["odd"]) for side, row in sides.items() if row.get("odd")}
        if len(odds) < 2:
            continue
        raw_probs = {side: 1 / odd for side, odd in odds.items()}
        total = sum(raw_probs.values())
        if total <= 0:
            continue
        market_key = key[:3]
        overrounds.setdefault(market_key, []).append(total)
        for side, prob in raw_probs.items():
            pair_probs.setdefault(market_key, {}).setdefault(side, []).append(prob / total)

    for row in rows:
        market_key = _pair_key(row)[:3]
        side = str(row.get("side"))
        probs = pair_probs.get(market_key, {}).get(side, [])
        rounds = overrounds.get(market_key, [])
        row["market_prob_consensus_avg"] = _avg(probs)
        row["market_prob_consensus_median"] = _median(probs)
        row["market_overround_avg"] = _avg(rounds)
        row["market_overround_median"] = _median(rounds)
        row["probabilidade_implicita_media"] = row["market_prob_consensus_avg"]
        row["probabilidade_implicita_mediana"] = row["market_prob_consensus_median"]
        row["margem_mercado_media"] = row["market_overround_avg"]
        row["margem_mercado_mediana"] = row["market_overround_median"]


def _attach_aggregates(rows: list[dict[str, Any]]) -> None:
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for row in rows:
        key = (row.get("game_id"), row.get("market"), row.get("line"), row.get("side"), row.get("pick"))
        groups.setdefault(key, []).append(row)

    for group in groups.values():
        odds = [float(row["odd"]) for row in group if row.get("odd")]
        if not odds:
            continue
        best = max(group, key=lambda row: float(row.get("odd") or 0))
        for row in group:
            row["bookmakers_count"] = len({item.get("bookmaker") for item in group if item.get("bookmaker")})
            row["odd_best"] = float(best["odd"])
            row["bookmaker_best"] = best.get("bookmaker")
            row["odd_avg"] = _avg(odds)
            row["odd_median"] = _median(odds)
            row["odd_min"] = min(odds)
            row["odd_max"] = max(odds)
            row["odd_std"] = _std(odds)
            row["odds_available"] = len(odds)
            row["casas_count"] = row["bookmakers_count"]
            row["odd_melhor"] = row["odd_best"]
            row["bookmaker_melhor"] = row["bookmaker_best"]
            row["odd_media"] = row["odd_avg"]
            row["odd_mediana"] = row["odd_median"]
            row["odd_minima"] = row["odd_min"]
            row["odd_maxima"] = row["odd_max"]
            row["odd_desvio_padrao"] = row["odd_std"]
            row["odds_disponiveis"] = row["odds_available"]


def normalize_oddsagora_raw(raw: dict[str, Any], job_id: str | None = None) -> dict[str, Any]:
    games = raw.get("games") if isinstance(raw.get("games"), list) else []
    rows: list[dict[str, Any]] = []
    for game in [item for item in games if isinstance(item, dict)]:
        _append_moneyline(rows, raw, game)
        _append_totals(rows, raw, game)
        _append_handicap(rows, raw, game)
        _append_bts(rows, raw, game)
        _append_double_chance(rows, raw, game)

    _attach_consensus(rows)
    _attach_aggregates(rows)

    status = "CONCLUIDA"
    mensagem = "Coleta OddsAgora concluida."
    if not games:
        status = "WARNING"
        mensagem = "Nenhum jogo encontrado na liga/data selecionada."
    elif not rows:
        status = "WARNING"
        mensagem = "Jogos encontrados, mas nenhuma odd extraida."

    return {
        "job_id": job_id or raw.get("job_id") or "",
        "source": "OddsAgora",
        "status": status,
        "mensagem": mensagem,
        "total_linhas": len(rows),
        "linhas": rows,
        "summary": {
            "games_count": len(games),
            "markets_count": len({row.get("market") for row in rows}),
            "odds_count": len(rows),
        },
    }
