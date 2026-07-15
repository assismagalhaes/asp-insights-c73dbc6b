"""Adapters from Highlightly payloads to the ASP Insights normalized row contract."""

from __future__ import annotations

from datetime import datetime
import re
from typing import Any, Iterable, Mapping


_LINE_RE = re.compile(r"(?<!\d)([+-]?\d+(?:\.\d+)?)(?!\d)")


def _team_name(team: Any) -> str:
    if not isinstance(team, Mapping):
        return ""
    return str(team.get("displayName") or team.get("name") or "").strip()


def _league_name(match: Mapping[str, Any]) -> str:
    league = match.get("league")
    if isinstance(league, Mapping):
        return str(league.get("name") or "").strip()
    return str(league or "").strip()


def _date_time(value: Any) -> tuple[str, str]:
    text = str(value or "").strip()
    if not text:
        return "", ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.date().isoformat(), parsed.strftime("%H:%M")
    except ValueError:
        return text[:10], text[11:16]


def _market_line(market: str) -> str:
    lowered = market.casefold()
    if "moneyline" in lowered or "correct score" in lowered:
        return ""
    if not any(token in lowered for token in ("total", "over/under", "spread", "handicap")):
        return ""
    matches = _LINE_RE.findall(market)
    return matches[-1] if matches else ""


def _selection_line(market: str, value: str) -> str:
    lowered = market.casefold()
    numbers = _LINE_RE.findall(market)
    if any(token in lowered for token in ("spread", "handicap")) and len(numbers) >= 2:
        side = value.strip().casefold()
        if side == "home":
            return numbers[-2]
        if side == "away":
            return numbers[-1]
    return _market_line(market)


def _pick(value: str, line: str, home: str, away: str) -> str:
    normalized = value.strip().casefold()
    if normalized == "home":
        return home
    if normalized == "away":
        return away
    if normalized == "draw":
        return "Empate"
    if normalized in {"over", "under"} and line:
        return f"{value.title()} {line}"
    return value.strip()


def normalize_odds(
    odds_payload: Mapping[str, Any],
    matches: Iterable[Mapping[str, Any]],
    *,
    sport: str,
) -> list[dict[str, Any]]:
    """Join `/odds` with `/matches` and emit ASP Insights rows.

    Highlightly odds identify only the match, so match metadata must be joined by ID.
    """

    match_index = {str(item.get("id")): item for item in matches if isinstance(item, Mapping)}
    rows: list[dict[str, Any]] = []
    for match_odds in odds_payload.get("data", []):
        if not isinstance(match_odds, Mapping):
            continue
        match_id = str(match_odds.get("matchId") or "")
        match = match_index.get(match_id, {})
        home = _team_name(match.get("homeTeam"))
        away = _team_name(match.get("awayTeam"))
        day, hour = _date_time(match.get("date"))
        country = match.get("country")
        country_name = str(country.get("name") or "") if isinstance(country, Mapping) else ""
        for market in match_odds.get("odds", []):
            if not isinstance(market, Mapping):
                continue
            market_name = str(market.get("market") or "").strip()
            bookmaker = str(market.get("bookmakerName") or market.get("bookmakerId") or "").strip()
            for selection in market.get("values", []):
                if not isinstance(selection, Mapping):
                    continue
                value = str(selection.get("value") or "")
                line = _selection_line(market_name, value)
                rows.append(
                    {
                        "data": day,
                        "hora": hour,
                        "esporte": sport,
                        "liga": _league_name(match),
                        "country": country_name,
                        "jogo": f"{home} vs {away}".strip(" vs"),
                        "mandante": home,
                        "visitante": away,
                        "mercado": market_name,
                        "pick": _pick(value, line, home, away),
                        "linha": line,
                        "odd": selection.get("odd"),
                        "bookmaker": bookmaker,
                        "fonte": "Highlightly",
                        "raw_ref": {
                            "provider": "highlightly",
                            "match_id": match_id,
                            "bookmaker_id": market.get("bookmakerId"),
                            "odds_type": market.get("type"),
                            "market": market_name,
                            "selection": value,
                        },
                    }
                )
    return rows
