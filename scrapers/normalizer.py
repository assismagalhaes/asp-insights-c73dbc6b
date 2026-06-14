from __future__ import annotations

import re
from typing import Any


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


def normalize(raw: Any, esporte_hint: str | None = None) -> dict[str, Any]:
    games = _games(raw)
    rows: list[dict[str, Any]] = []

    for game in games:
        home = str(game.get("home") or game.get("mandante") or game.get("casa") or "")
        away = str(game.get("away") or game.get("visitante") or game.get("fora") or "")
        base = {
            "data": _date(game.get("date") or game.get("data")),
            "hora": _time(game.get("hour") or game.get("hora") or game.get("time")),
            "esporte": _sport(esporte_hint or game.get("sport") or game.get("esporte"), game),
            "liga": str(game.get("league") or game.get("liga") or ""),
            "jogo": str(game.get("jogo") or f"{home} vs {away}"),
            "mandante": home,
            "visitante": away,
            "fonte": game.get("link") or game.get("fonte"),
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
                                "raw_ref": {"game_id": game.get("id"), "market": market_name, "period": period, "header": header},
                            }
                        )

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
