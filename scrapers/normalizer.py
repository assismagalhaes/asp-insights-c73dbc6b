from __future__ import annotations

import re
from typing import Any

from scrapers.flashscore_url import extract_flashscore_match_id, normalize_flashscore_url


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None


def _date(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    br = re.match(r"^(\d{2})[/.](\d{2})[/.](\d{4})$", text)
    if br:
        return f"{br.group(3)}-{br.group(2)}-{br.group(1)}"
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
    return None


def _time(value: Any) -> str | None:
    if not value:
        return None
    m = re.search(r"(\d{1,2}):(\d{2})", str(value))
    if not m:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def _games(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if not isinstance(raw, dict):
        return []
    if isinstance(raw.get("_default"), dict):
        return [x for x in raw["_default"].values() if isinstance(x, dict)]
    for key in ("games", "jogos", "data", "result"):
        if isinstance(raw.get(key), list):
            return [x for x in raw[key] if isinstance(x, dict)]
    return [x for x in raw.values() if isinstance(x, dict)]


def _game_id(game: dict[str, Any]) -> str | None:
    explicit = game.get("id") or game.get("match_id") or game.get("game_id") or game.get("fixture_id")
    link = game.get("link") or game.get("url") or game.get("fonte")
    return extract_flashscore_match_id(str(link or "")) or (str(explicit).strip() if explicit else None)


def _sport(input_value: Any, game: dict[str, Any]) -> str | None:
    text = f"{input_value or ''} {game.get('link') or ''}".lower()
    if "basket" in text:
        return "Basketball"
    if "baseball" in text or "mlb" in text:
        return "Baseball"
    if "hockey" in text or "nhl" in text:
        return "Hockey"
    if "american-football" in text or "american football" in text or "nfl" in text:
        return "American Football"
    if "football" in text or "soccer" in text or "futebol" in text:
        return "Futebol"
    return str(input_value) if input_value else None


def _invert_line(line: str | None) -> str | None:
    if not line:
        return None
    value = _to_float(line)
    if value is None or value == 0:
        return line
    inv = -value
    return f"+{inv:g}" if inv > 0 else f"{inv:g}"


def _format_line(value: float) -> str:
    return f"+{value:g}" if value > 0 else f"{value:g}"


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _is_supported_handicap_market(market: Any, sport: Any) -> bool:
    market_text = _norm(market)
    sport_text = _norm(sport)
    if "european handicap" in market_text or "handicap europeu" in market_text or "3 vias" in market_text or "3-way" in market_text:
        return False
    if "football" in sport_text or "futebol" in sport_text:
        return "asian" in market_text or "asiatico" in market_text
    return "handicap" in market_text or "spread" in market_text or "run line" in market_text


def _outcome_side(outcome: Any, home: str, away: str, header: Any = None) -> str | None:
    header_text = _norm(header)
    if header_text in {"1", "home", "casa", "mandante"}:
        return "home"
    if header_text in {"2", "away", "fora", "visitante"}:
        return "away"
    text = _norm(outcome)
    if text in {"1", "home", "casa", "mandante"}:
        return "home"
    if text in {"2", "away", "fora", "visitante"}:
        return "away"
    home_text = _norm(home)
    away_text = _norm(away)
    if home_text and (home_text in text or text in home_text):
        return "home"
    if away_text and (away_text in text or text in away_text):
        return "away"
    return None


def _pick(market: str, header: str, home: str, away: str) -> str:
    h = header.strip()
    upper = h.upper()
    if h == "1":
        return home or "Casa"
    if h == "2":
        return away or "Fora"
    if upper == "X":
        return "Empate"
    if upper == "YES":
        return "Sim"
    if upper == "NO":
        return "Não"
    if upper == "OVER":
        return "Over"
    if upper == "UNDER":
        return "Under"
    return h or market


def _normalize_handicap_pairs(rows: list[dict[str, Any]]) -> None:
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for row in rows:
        if not _is_supported_handicap_market(row.get("mercado"), row.get("esporte")):
            continue
        line = _to_float(row.get("linha"))
        if line is None:
            _tag_handicap_row(row, "INVALID_LINE")
            continue
        key = (
            row.get("data"),
            row.get("hora"),
            row.get("esporte"),
            row.get("liga"),
            row.get("jogo"),
            row.get("mandante"),
            row.get("visitante"),
            row.get("mercado"),
            row.get("bookmaker"),
            abs(line),
        )
        groups.setdefault(key, []).append(row)

    for group_rows in groups.values():
        home_rows: list[dict[str, Any]] = []
        away_rows: list[dict[str, Any]] = []
        for row in group_rows:
            side = _outcome_side(
                row.get("pick"),
                str(row.get("mandante") or ""),
                str(row.get("visitante") or ""),
                (row.get("raw_ref") or {}).get("header") if isinstance(row.get("raw_ref"), dict) else None,
            )
            if side == "home":
                home_rows.append(row)
            elif side == "away":
                away_rows.append(row)

        if len(home_rows) != 1 or len(away_rows) != 1:
            status = "PAIR_INCOMPLETE" if len(group_rows) < 2 else "AMBIGUOUS_NOT_FIXED"
            for row in group_rows:
                _tag_handicap_row(row, status)
            continue

        home_row = home_rows[0]
        away_row = away_rows[0]
        home_line = _to_float(home_row.get("linha"))
        away_line = _to_float(away_row.get("linha"))
        if home_line is None or away_line is None:
            _tag_handicap_row(home_row, "INVALID_LINE")
            _tag_handicap_row(away_row, "INVALID_LINE")
            continue

        if abs(home_line + away_line) < 1e-12:
            _tag_handicap_row(home_row, "VALID_SYMMETRIC_PAIR")
            _tag_handicap_row(away_row, "VALID_SYMMETRIC_PAIR")
            continue

        if abs(home_line - away_line) < 1e-12:
            away_row["linha"] = _format_line(-home_line)
            _tag_handicap_row(home_row, "AWAY_LINE_NOT_INVERTED_FIXED")
            _tag_handicap_row(away_row, "AWAY_LINE_NOT_INVERTED_FIXED")
            continue

        _tag_handicap_row(home_row, "AMBIGUOUS_NOT_FIXED")
        _tag_handicap_row(away_row, "AMBIGUOUS_NOT_FIXED")


def _tag_handicap_row(row: dict[str, Any], status: str) -> None:
    raw_ref = row.get("raw_ref")
    if not isinstance(raw_ref, dict):
        raw_ref = {}
        row["raw_ref"] = raw_ref
    raw_ref["handicap_normalization_status"] = status


def normalize(raw: Any, esporte_hint: str | None = None) -> dict[str, Any]:
    games = _games(raw)
    rows: list[dict[str, Any]] = []

    for game in games:
        home = str(game.get("home") or game.get("mandante") or game.get("casa") or "")
        away = str(game.get("away") or game.get("visitante") or game.get("fora") or "")
        link = str(game.get("link") or game.get("url") or game.get("fonte") or "")
        canonical_game_id = _game_id(game)
        base = {
            "data": _date(game.get("date") or game.get("data")),
            "hora": _time(game.get("hour") or game.get("hora") or game.get("time")),
            "esporte": _sport(esporte_hint or game.get("sport") or game.get("esporte"), game),
            "liga": str(game.get("league") or game.get("liga") or ""),
            "jogo": str(game.get("jogo") or f"{home} vs {away}"),
            "mandante": home,
            "visitante": away,
            "fonte": normalize_flashscore_url(link) if link else game.get("fonte"),
        }
        odds = game.get("odds")
        if not isinstance(odds, dict):
            continue
        for market_name, periods in odds.items():
            if not isinstance(periods, dict):
                continue
            for period, table in periods.items():
                if not isinstance(table, list) or len(table) < 2 or not isinstance(table[0], list):
                    continue
                headers = [str(x) for x in table[0]]
                bookmaker_index = next((i for i, h in enumerate(headers) if "bookmaker" in h.lower()), -1)
                line_index = next((i for i, h in enumerate(headers) if re.search(r"total|handicap|line|linha", h, re.I)), -1)
                for item in table[1:]:
                    if not isinstance(item, list):
                        continue
                    bookmaker = str(item[bookmaker_index]) if bookmaker_index >= 0 and bookmaker_index < len(item) else None
                    line = str(item[line_index]) if line_index >= 0 and line_index < len(item) else None
                    for idx, header in enumerate(headers):
                        if idx in (bookmaker_index, line_index) or idx >= len(item):
                            continue
                        odd = _to_float(item[idx])
                        if odd is None:
                            continue
                        linha = _invert_line(line) if "asian handicap" in str(market_name).lower() and header == "2" else line
                        rows.append(
                            {
                                **base,
                                "mercado": str(market_name),
                                "pick": _pick(str(market_name), header, home, away),
                                "linha": linha or None,
                                "odd": odd,
                                "bookmaker": bookmaker,
                                "capturado_em": None,
                                "raw_ref": {
                                    "game_id": canonical_game_id,
                                    "market": market_name,
                                    "period": period,
                                    "header": header,
                                },
                            }
                        )

    _normalize_handicap_pairs(rows)

    dates = sorted([r["data"] for r in rows if r.get("data")])
    mercados = sorted({r["mercado"] for r in rows if r.get("mercado")})
    esportes = sorted({r["esporte"] for r in rows if r.get("esporte")})
    ligas = sorted({r["liga"] for r in rows if r.get("liga")})
    return {
        "esporte": esportes[0] if len(esportes) == 1 else esporte_hint,
        "liga": ligas[0] if len(ligas) == 1 else None,
        "data_inicio": dates[0] if dates else None,
        "data_fim": dates[-1] if dates else None,
        "mercados": mercados,
        "total_jogos": len(games),
        "total_odds": len(rows),
        "rows": rows,
    }
