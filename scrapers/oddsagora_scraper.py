from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import logging
import os
import re
import time
import urllib.request
from datetime import date, datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

try:
    from scrapers.oddsagora_url import ODDSAGORA_BASE_URL, ODDSAGORA_MLB_URL, build_oddsagora_market_url, extract_oddsagora_game_id
except ModuleNotFoundError:
    from oddsagora_url import ODDSAGORA_BASE_URL, ODDSAGORA_MLB_URL, build_oddsagora_market_url, extract_oddsagora_game_id


DEFAULT_ODDSAGORA_MARKETS = ["home-away", "over-under", "ah"]
DEFAULT_ODDSAGORA_FOOTBALL_MARKETS = ["1x2", "over-under", "ah", "bts", "double"]
DEFAULT_ODDSAGORA_HOCKEY_MARKETS = ["1x2", "home-away", "over-under", "ah", "bts"]
DEFAULT_ODDSAGORA_LEAGUES = {
    "football": [
        "https://www.oddsagora.com.br/football/germany/2-bundesliga",
        "https://www.oddsagora.com.br/football/germany/bundesliga",
        "https://www.oddsagora.com.br/football/austria/bundesliga",
        "https://www.oddsagora.com.br/football/brazil/brasileirao-betano",
        "https://www.oddsagora.com.br/football/china/superliga",
        "https://www.oddsagora.com.br/football/denmark/superliga",
        "https://www.oddsagora.com.br/football/england/campeonato-ingles",
        "https://www.oddsagora.com.br/football/england/2-divisao",
        "https://www.oddsagora.com.br/football/finland/veikkausliiga",
        "https://www.oddsagora.com.br/football/france/ligue-1",
        "https://www.oddsagora.com.br/football/france/ligue-2",
        "https://www.oddsagora.com.br/football/ireland/divisao-premier",
        "https://www.oddsagora.com.br/football/italy/serie-a",
        "https://www.oddsagora.com.br/football/italy/serie-b",
        "https://www.oddsagora.com.br/football/mexico/liga-mx",
        "https://www.oddsagora.com.br/football/netherlands/eredivisie",
        "https://www.oddsagora.com.br/football/norway/serie-de-elite/",
        "https://www.oddsagora.com.br/football/poland/ekstraklasa",
        "https://www.oddsagora.com.br/football/portugal/liga-portugal",
        "https://www.oddsagora.com.br/football/romania/superliga/",
        "https://www.oddsagora.com.br/football/scotland/primeira-liga/",
        "https://www.oddsagora.com.br/football/spain/laliga/",
        "https://www.oddsagora.com.br/football/spain/laliga2/",
        "https://www.oddsagora.com.br/football/sweden/allsvenskan",
        "https://www.oddsagora.com.br/football/switzerland/superliga/",
        "https://www.oddsagora.com.br/football/turkey/super-lig/",
        "https://www.oddsagora.com.br/football/usa/mls/",
    ],
    "basketball": [
        "https://www.oddsagora.com.br/basketball/usa/wnba/",
        "https://www.oddsagora.com.br/basketball/usa/nba/",
    ],
    "baseball": [ODDSAGORA_MLB_URL],
    "hockey": ["https://www.oddsagora.com.br/hockey/usa/nhl/"],
    "american-football": [
        "https://www.oddsagora.com.br/american-football/usa/nfl/",
        "https://www.oddsagora.com.br/american-football/usa/ncaa/",
    ],
}
SPORT_LABELS = {
    "football": "Football",
    "basketball": "Basketball",
    "baseball": "Baseball",
    "hockey": "Hockey",
    "american-football": "American Football",
}
ODDSAGORA_BET_TYPE_BY_MARKET = {
    "1x2": 1,
    "home-away": 3,
    "moneyline": 3,
    "over-under": 2,
    "ah": 5,
    "asian-handicap": 5,
    "handicap": 5,
    "bts": 9,
    "both-teams-score": 9,
    "double": 4,
    "double-chance": 4,
}
ODDSAGORA_SCOPE_BY_SPORT_MARKET = {
    "football": {
        "1x2": 2,
        "home-away": 2,
        "moneyline": 2,
        "over-under": 2,
        "ah": 2,
        "asian-handicap": 2,
        "handicap": 2,
        "bts": 2,
        "both-teams-score": 2,
        "double": 2,
        "double-chance": 2,
    },
    "hockey": {
        "1x2": 2,
        "bts": 5,
        "both-teams-score": 5,
    },
}
ODDSAGORA_ENCRYPTION_KEY = "J*8sQ!p$7aD_fR2yW@gHn*3bVp#sAdLd_k"
ODDSAGORA_ENCRYPTION_SALT = b"5b9a8f2c3e6d1a4b7c8e9d0f1a2b3c4d"
BLOCKED_HTML_TERMS = ("cloudflare", "captcha", "access denied", "bloqueado", "verify you are human")
MONTHS_PT = {
    "jan": 1,
    "fev": 2,
    "mar": 3,
    "abr": 4,
    "mai": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "set": 9,
    "out": 10,
    "nov": 11,
    "dez": 12,
}
ODDSAGORA_LOCAL_TZ = ZoneInfo("America/Sao_Paulo")

logger = logging.getLogger(__name__)


def _sport_key(esporte: Any) -> str:
    text = str(esporte or "").strip().lower().replace("_", "-")
    if text in {"futebol", "soccer"}:
        return "football"
    if text in {"american football", "american-football", "nfl", "ncaa"}:
        return "american-football"
    if text in {"basket", "basketball", "nba", "wnba"}:
        return "basketball"
    if text in {"baseball", "mlb"} or "baseball" in text:
        return "baseball"
    if text in {"hockey", "nhl"}:
        return "hockey"
    return text


def _sport_key_from_url(url: str) -> str:
    match = re.search(r"oddsagora\.com\.br/([^/]+)/", str(url or ""), flags=re.IGNORECASE)
    return match.group(1).lower() if match else ""


def _sport_label(esporte: Any, league_url: str = "") -> str:
    key = _sport_key_from_url(league_url) or _sport_key(esporte)
    return SPORT_LABELS.get(key, str(esporte or "").strip() or key.title())


def _league_label_from_url(url: str) -> str:
    parts = [part for part in re.sub(r"https?://[^/]+/?", "", str(url or "")).split("/") if part]
    if len(parts) < 3:
        return parts[-1].upper() if parts else ""
    country = parts[1].replace("-", " ").title()
    league = parts[2].replace("-", " ").title()
    return f"{country} - {league}"


def _h2h_marker(sport_key: str) -> str:
    return f"/{sport_key}/h2h/" if sport_key else "/h2h/"


def _default_markets_for_sport(sport_key: str) -> list[str]:
    if sport_key == "football":
        return list(DEFAULT_ODDSAGORA_FOOTBALL_MARKETS)
    if sport_key == "hockey":
        return list(DEFAULT_ODDSAGORA_HOCKEY_MARKETS)
    return list(DEFAULT_ODDSAGORA_MARKETS)


def _scope_id_for_market(template: dict[str, Any], market: str, match_url: str = "") -> int | str:
    sport_key = _sport_key_from_url(match_url)
    market_key = str(market or "").casefold()
    scoped = ODDSAGORA_SCOPE_BY_SPORT_MARKET.get(sport_key, {}).get(market_key)
    if scoped is not None:
        return scoped
    return template.get("scope_id") or 1


class LeagueLinkParser(HTMLParser):
    def __init__(self, sport_key: str = ""):
        super().__init__()
        self.sport_key = sport_key
        self.links: list[dict[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if href and _h2h_marker(self.sport_key) in href:
            self._href = href
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self._href:
            return
        title = _clean_text(" ".join(self._text))
        self.links.append({"href": self._href, "title": title})
        self._href = None
        self._text = []


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows: list[dict[str, Any]] = []
        self.links: list[dict[str, str]] = []
        self.title = ""
        self._in_title = False
        self._row: list[dict[str, Any]] | None = None
        self._cell: dict[str, Any] | None = None
        self._href: str | None = None
        self._href_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = {"text": [], "hrefs": []}
        elif tag == "a":
            href = attrs_dict.get("href")
            if href:
                self._href = href
                self._href_text = []
                if self._cell is not None:
                    self._cell["hrefs"].append(href)
        elif tag == "img" and self._cell is not None:
            label = attrs_dict.get("alt") or attrs_dict.get("title")
            if label:
                self._cell["text"].append(label)

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._cell is not None:
            self._cell["text"].append(data)
        if self._href is not None:
            self._href_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._cell["text"] = _clean_text(" ".join(self._cell["text"]))
            self._row.append(self._cell)
            self._cell = None
        elif tag == "tr" and self._row is not None:
            cells = [cell for cell in self._row if cell.get("text") or cell.get("hrefs")]
            if cells:
                self.rows.append(
                    {
                        "cells": [cell.get("text", "") for cell in cells],
                        "hrefs": [href for cell in cells for href in cell.get("hrefs", [])],
                    }
                )
            self._row = None
        elif tag == "a" and self._href is not None:
            self.links.append({"href": self._href, "title": _clean_text(" ".join(self._href_text))})
            self._href = None
            self._href_text = []


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _log(logs: list[dict[str, Any]], event: str, **values: Any) -> None:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "event": event, **values}
    logs.append(entry)
    logger.info("oddsagora.%s %s", event, json.dumps(values, ensure_ascii=False, default=str))


def _http_timeout_seconds() -> float:
    try:
        value = float(os.getenv("ODDSAGORA_HTTP_TIMEOUT_SECONDS", "12"))
    except (TypeError, ValueError):
        value = 12.0
    return max(3.0, value)


def _html_fallback_enabled() -> bool:
    return str(os.getenv("ODDSAGORA_HTML_FALLBACK", "")).strip().casefold() in {"1", "true", "yes", "on"}


def _fetch_text(url: str, extra_headers: dict[str, str] | None = None) -> tuple[str, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ASP Insights OddsAgora scraper",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    }
    if extra_headers:
        headers.update(extra_headers)
    request = urllib.request.Request(
        url,
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=_http_timeout_seconds()) as response:
        text = response.read().decode("utf-8", errors="replace")
        return text, response.geturl()


def _fetch_html(url: str) -> tuple[str, str]:
    return _fetch_text(url)


def _absolute_url(href: str) -> str:
    if href.startswith("http"):
        return href
    return f"{ODDSAGORA_BASE_URL}{href if href.startswith('/') else f'/{href}'}"


def _html_blocked_reason(html: str) -> str | None:
    lowered = html.casefold()
    for term in BLOCKED_HTML_TERMS:
        if term in lowered:
            return term
    return None


def _parse_html(html: str) -> TableParser:
    parser = TableParser()
    parser.feed(html)
    return parser


def _fallback_year(data_inicio: str = "", data_fim: str = "") -> int:
    for value in (data_inicio, data_fim):
        match = re.search(r"\b(20\d{2})\b", str(value or ""))
        if match:
            return int(match.group(1))
    return datetime.now().year


def _parse_date_text(text: str, fallback_year: int) -> str:
    value = _clean_text(text)
    match = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", value)
    if match:
        day, month, year = map(int, match.groups())
        return date(year, month, day).isoformat()
    match = re.search(r"\b(\d{1,2})\s+([A-Za-zÀ-ÿ]{3})\.?\s*(20\d{2})?\b", value, flags=re.IGNORECASE)
    if not match:
        return ""
    day = int(match.group(1))
    month = MONTHS_PT.get(match.group(2).casefold()[:3])
    year = int(match.group(3) or fallback_year)
    if not month:
        return ""
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return ""


def _date_in_range(value: str, data_inicio: str, data_fim: str) -> bool:
    if not value:
        return True
    start = data_inicio[:10] if data_inicio else ""
    end = data_fim[:10] if data_fim else ""
    if start and value < start:
        return False
    if end and value > end:
        return False
    return True


def _looks_like_date_label(text: str) -> bool:
    return bool(re.search(r"\b(Hoje|Amanha|Amanh[ãa]|Ontem|\d{1,2}\s+[A-Za-zÀ-ÿ]{3}|\d{1,2}/\d{1,2}/20\d{2})\b", text, re.IGNORECASE))


def _time_index(cells: list[str]) -> int | None:
    for index, cell in enumerate(cells):
        if re.search(r"^\d{1,2}:\d{2}$", cell):
            return index
    return None


def _numbers(text: str) -> list[float]:
    values: list[float] = []
    for raw in re.findall(r"(?<!\d)[+-]?\d+(?:[,.]\d+)?(?!\d)", str(text or "")):
        try:
            values.append(float(raw.replace(",", ".")))
        except ValueError:
            continue
    return values


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).strip().replace(",", "."))
    except ValueError:
        return None


def _first_odd(text: str) -> float | None:
    for number in _numbers(text):
        if 1.01 <= number <= 100:
            return number
    return None


def _first_line(text: str) -> float | None:
    for number in _numbers(text):
        if -100 <= number <= 100:
            return number
    return None


def _payout(text: str) -> float | None:
    match = re.search(r"(\d+(?:[,.]\d+)?)\s*%", str(text or ""))
    return float(match.group(1).replace(",", ".")) if match else None


def _bookmaker_name(text: str) -> str:
    cleaned = re.sub(r"\b(i|info)\b", " ", _clean_text(text), flags=re.IGNORECASE)
    parts = cleaned.split()
    if len(parts) >= 2 and parts[0].casefold() == parts[1].casefold():
        return parts[0]
    return _clean_text(cleaned)


def _market_dicts(markets: list[str]) -> dict[str, list[dict[str, Any]]]:
    return {market: [] for market in markets}


def _game_key(game: dict[str, Any]) -> str:
    return str(game.get("game_id") or game.get("match_url") or f"{game.get('date')}|{game.get('time')}|{game.get('home_team')}|{game.get('away_team')}")


def _parse_title(title: str, fallback_year: int) -> tuple[str, str, str]:
    text = _clean_text(title)
    parsed_date = ""
    date_match = re.search(r"\s+-\s+(.+)$", text)
    if date_match:
        parsed_date = _parse_date_text(date_match.group(1), fallback_year)
        text = text[: date_match.start()].strip()
    if " vs " in text:
        home, away = text.split(" vs ", 1)
    else:
        home, away = text, ""
    return home.strip(), away.strip(), parsed_date


def _game_from_link(link: dict[str, str], markets: list[str], fallback_year: int, sport_key: str, sport_label: str, league_label: str) -> dict[str, Any] | None:
    href = link.get("href") or ""
    if _h2h_marker(sport_key) not in href:
        return None
    match_url = _absolute_url(href)
    home, away, parsed_date = _parse_title(link.get("title") or "", fallback_year)
    game_id = extract_oddsagora_game_id(match_url) or match_url.rstrip("/").rsplit("/", 1)[-1]
    return {
        "game_id": game_id,
        "date": parsed_date,
        "time": "",
        "home_team": home,
        "away_team": away,
        "match_url": match_url,
        "league": league_label,
        "sport": sport_label,
        "market_urls": {market: build_oddsagora_market_url(match_url, market) for market in markets},
        "markets": _market_dicts(markets),
    }


def _game_from_row(row: dict[str, Any], current_date: str, markets: list[str], sport_key: str, sport_label: str, league_label: str) -> dict[str, Any] | None:
    cells = [_clean_text(cell) for cell in row.get("cells", []) if _clean_text(cell)]
    time_pos = _time_index(cells)
    if time_pos is None:
        return None
    team_cells = [cell for cell in cells[time_pos + 1 :] if not _first_odd(cell) and "%" not in cell]
    if len(team_cells) < 2:
        return None
    home = team_cells[0]
    away = team_cells[1]
    h2h_links = [href for href in row.get("hrefs", []) if _h2h_marker(sport_key) in href]
    match_url = _absolute_url(h2h_links[0]) if h2h_links else ""
    game_id = extract_oddsagora_game_id(match_url) or (match_url.rstrip("/").rsplit("/", 1)[-1] if match_url else f"{home}-{away}-{current_date}")
    game_markets = _market_dicts(markets)
    trailing = " ".join(cells[time_pos + 3 :])
    odds = [_first_odd(cell) for cell in cells[time_pos + 3 :]]
    odds = [odd for odd in odds if odd is not None]
    if len(odds) >= 2 and "home-away" in game_markets:
        game_markets["home-away"].append({"bookmaker": "OddsAgora", "home_odd": odds[0], "away_odd": odds[1], "source": "league_table"})
    if len(odds) >= 3 and "1x2" in game_markets:
        game_markets["1x2"].append({"bookmaker": "OddsAgora", "home_odd": odds[0], "draw_odd": odds[1], "away_odd": odds[2], "source": "league_table"})
    values = [value for value in _numbers(trailing) if value > 1]
    if not game_markets.get("home-away") and len(values) >= 2 and "home-away" in game_markets:
        game_markets["home-away"].append({"bookmaker": "OddsAgora", "home_odd": values[0], "away_odd": values[1], "source": "league_table"})
    if not game_markets.get("1x2") and len(values) >= 3 and "1x2" in game_markets:
        game_markets["1x2"].append({"bookmaker": "OddsAgora", "home_odd": values[0], "draw_odd": values[1], "away_odd": values[2], "source": "league_table"})
    return {
        "game_id": game_id,
        "date": current_date,
        "time": cells[time_pos],
        "home_team": home,
        "away_team": away,
        "match_url": match_url,
        "league": league_label,
        "sport": sport_label,
        "market_urls": {market: build_oddsagora_market_url(match_url, market) for market in markets} if match_url else {},
        "markets": game_markets,
    }


def _iter_json_objects(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _iter_json_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_json_objects(child)


def _team_name(value: Any) -> str:
    if isinstance(value, dict):
        return _clean_text(value.get("name") or value.get("alternateName") or value.get("url") or "")
    if isinstance(value, str):
        return _clean_text(value)
    return ""


def _split_event_name(name: str) -> tuple[str, str]:
    text = _clean_text(name)
    for separator in (" - ", " vs "):
        if separator in text:
            home, away = text.split(separator, 1)
            return home.strip(), away.strip()
    return text, ""


def _local_start_date_time(value: Any) -> tuple[str, str]:
    text = _clean_text(value)
    if not text:
        return "", ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return "", ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    local = parsed.astimezone(ODDSAGORA_LOCAL_TZ)
    return local.date().isoformat(), local.strftime("%H:%M")


def _game_from_json_ld_event(event: dict[str, Any], markets: list[str], sport_key: str, sport_label: str, league_label: str) -> dict[str, Any] | None:
    url = _clean_text(event.get("url") or "")
    start_date = event.get("startDate")
    if _h2h_marker(sport_key) not in url or not start_date:
        return None
    match_url = _absolute_url(url).rstrip("/")
    game_id = extract_oddsagora_game_id(match_url)
    if not game_id:
        return None
    home = _team_name(event.get("homeTeam"))
    away = _team_name(event.get("awayTeam"))
    if not home or not away:
        home, away = _split_event_name(str(event.get("name") or ""))
    local_date, local_time = _local_start_date_time(start_date)
    return {
        "game_id": game_id,
        "date": local_date,
        "time": local_time,
        "home_team": home,
        "away_team": away,
        "match_url": match_url,
        "league": league_label,
        "sport": sport_label,
        "market_urls": {market: build_oddsagora_market_url(match_url, market) for market in markets},
        "markets": _market_dicts(markets),
    }


def _games_from_json_ld(html: str, markets: list[str], data_inicio: str, data_fim: str, logs: list[dict[str, Any]], sport_key: str, sport_label: str, league_label: str) -> list[dict[str, Any]]:
    games_by_key: dict[str, dict[str, Any]] = {}
    scripts = re.findall(r"<script\b[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", html, flags=re.IGNORECASE | re.DOTALL)
    candidates = 0
    for raw_script in scripts:
        script = unescape(raw_script).strip()
        if not script:
            continue
        try:
            payload = json.loads(script)
        except json.JSONDecodeError as exc:
            _log(logs, "league_json_ld_decode_failed", error=str(exc))
            continue
        for event in _iter_json_objects(payload):
            game = _game_from_json_ld_event(event, markets, sport_key, sport_label, league_label)
            if not game:
                continue
            candidates += 1
            if not _date_in_range(str(game.get("date") or ""), data_inicio, data_fim):
                _log(
                    logs,
                    "league_json_ld_game_skipped_out_of_range",
                    game_id=game.get("game_id"),
                    date=game.get("date"),
                    time=game.get("time"),
                    name=event.get("name"),
                )
                continue
            games_by_key[_game_key(game)] = game
    games = list(games_by_key.values())
    _log(logs, "league_json_ld_parse_finished", scripts=len(scripts), candidates=candidates, games_count=len(games))
    return games


def parse_league_html(
    league_url: str,
    html: str,
    markets: list[str],
    *,
    data_inicio: str = "",
    data_fim: str = "",
    logs: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    logs = logs if logs is not None else []
    sport_key = _sport_key_from_url(league_url) or "baseball"
    sport_label = _sport_label("", league_url)
    league_label = _league_label_from_url(league_url)
    fallback_year = _fallback_year(data_inicio, data_fim)
    table_parser = _parse_html(html)
    link_parser = LeagueLinkParser(sport_key)
    link_parser.feed(html)
    games_by_key: dict[str, dict[str, Any]] = {}
    current_date = ""

    _log(logs, "league_parse_started", league_url=league_url, rows=len(table_parser.rows), h2h_links=len(link_parser.links))

    structured_games = _games_from_json_ld(html, markets, data_inicio, data_fim, logs, sport_key, sport_label, league_label)
    for game in structured_games:
        games_by_key[_game_key(game)] = game

    for row in table_parser.rows:
        cells = [_clean_text(cell) for cell in row.get("cells", []) if _clean_text(cell)]
        joined = " ".join(cells)
        parsed_label_date = _parse_date_text(joined, fallback_year) if _looks_like_date_label(joined) else ""
        if parsed_label_date and _time_index(cells) is None:
            current_date = parsed_label_date
            _log(logs, "league_date_label", label=joined, parsed_date=current_date)
            continue
        game = _game_from_row(row, current_date, markets, sport_key, sport_label, league_label)
        if not game:
            continue
        if not _date_in_range(str(game.get("date") or ""), data_inicio, data_fim):
            _log(logs, "league_game_skipped_out_of_range", game=game)
            continue
        games_by_key[_game_key(game)] = game

    for link in link_parser.links:
        if structured_games:
            _log(logs, "league_link_skipped_json_ld_authoritative", title=link.get("title"), href=link.get("href"))
            continue
        game = _game_from_link(link, markets, fallback_year, sport_key, sport_label, league_label)
        if not game:
            continue
        if not _date_in_range(str(game.get("date") or ""), data_inicio, data_fim):
            _log(logs, "league_link_skipped_out_of_range", title=link.get("title"), href=link.get("href"))
            continue
        key = _game_key(game)
        if key in games_by_key:
            existing = games_by_key[key]
            for field in ("date", "time", "home_team", "away_team", "match_url"):
                if not existing.get(field) and game.get(field):
                    existing[field] = game[field]
            if not existing.get("market_urls") and game.get("market_urls"):
                existing["market_urls"] = game["market_urls"]
            continue
        games_by_key[key] = game

    games = list(games_by_key.values())
    _log(logs, "league_parse_finished", league_url=league_url, games_count=len(games), urls=[game.get("match_url") for game in games])
    return games


def _row_is_header(cells: list[str]) -> bool:
    text = " ".join(cells).casefold()
    return any(marker in text for marker in ("casas de apostas", "payout", "acima", "abaixo", "handicap", "total")) and not any(
        _bookmaker_name(cell) and _first_odd(cell) for cell in cells[:1]
    )


def _parse_moneyline_rows(rows: list[dict[str, Any]], include_draw: bool = False) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for row in rows:
        cells = [_clean_text(cell) for cell in row.get("cells", []) if _clean_text(cell)]
        if len(cells) < 3 or _row_is_header(cells):
            continue
        bookmaker = _bookmaker_name(cells[0])
        odds = [_first_odd(cell) for cell in cells[1:]]
        odds = [odd for odd in odds if odd is not None]
        if bookmaker and include_draw and len(odds) >= 3:
            parsed.append({"bookmaker": bookmaker, "home_odd": odds[0], "draw_odd": odds[1], "away_odd": odds[2], "payout": _payout(" ".join(cells))})
        elif bookmaker and len(odds) >= 2:
            parsed.append({"bookmaker": bookmaker, "home_odd": odds[0], "away_odd": odds[1], "payout": _payout(" ".join(cells))})
    return parsed


def _parse_totals_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    current_line: float | None = None
    for row in rows:
        cells = [_clean_text(cell) for cell in row.get("cells", []) if _clean_text(cell)]
        if not cells:
            continue
        joined = " ".join(cells)
        if "acima/abaixo" in joined.casefold():
            current_line = _first_line(joined)
            continue
        if _row_is_header(cells):
            continue
        bookmaker = _bookmaker_name(cells[0])
        line = _first_line(cells[1]) if len(cells) > 1 else None
        line = line if line is not None else current_line
        odds = [_first_odd(cell) for cell in cells[2:]]
        odds = [odd for odd in odds if odd is not None]
        if bookmaker and line is not None and len(odds) >= 2:
            parsed.append({"bookmaker": bookmaker, "line": line, "odd_over": odds[0], "odd_under": odds[1], "payout": _payout(joined)})
    return parsed


def _parse_handicap_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    current_line: float | None = None
    for row in rows:
        cells = [_clean_text(cell) for cell in row.get("cells", []) if _clean_text(cell)]
        if not cells:
            continue
        joined = " ".join(cells)
        if "handicap asi" in joined.casefold():
            current_line = _first_line(joined)
            continue
        if _row_is_header(cells):
            continue
        bookmaker = _bookmaker_name(cells[0])
        line = _first_line(cells[1]) if len(cells) > 1 else None
        line = line if line is not None else current_line
        odds = [_first_odd(cell) for cell in cells[2:]]
        odds = [odd for odd in odds if odd is not None]
        if bookmaker and line is not None and len(odds) >= 2:
            parsed.append({"bookmaker": bookmaker, "line": line, "home_odd": odds[0], "away_odd": odds[1], "payout": _payout(joined)})
    return parsed


def parse_market_html(html: str, market: str) -> list[dict[str, Any]]:
    rows = _parse_html(html).rows
    key = str(market or "").casefold()
    if key in ("home-away", "moneyline"):
        return _parse_moneyline_rows(rows)
    if key == "1x2":
        return _parse_moneyline_rows(rows, include_draw=True)
    if key == "over-under":
        return _parse_totals_rows(rows)
    if key in ("ah", "asian-handicap", "handicap"):
        return _parse_handicap_rows(rows)
    return []


def _decode_oddsagora_payload(value: str) -> dict[str, Any]:
    try:
        from cryptography.hazmat.primitives import padding
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    except ModuleNotFoundError as exc:
        raise RuntimeError("Dependencia cryptography ausente para decodificar payload OddsAgora.") from exc

    decoded = base64.b64decode(value.strip()).decode("ascii")
    cipher_b64, iv_hex = decoded.split(":", 1)
    ciphertext = base64.b64decode(cipher_b64)
    iv = bytes.fromhex(iv_hex)
    key = hashlib.pbkdf2_hmac("sha256", ODDSAGORA_ENCRYPTION_KEY.encode(), ODDSAGORA_ENCRYPTION_SALT, 1000, dklen=32)
    decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    raw = unpadder.update(padded) + unpadder.finalize()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def _fetch_oddsagora_json(url: str, referer: str | None = None) -> dict[str, Any]:
    headers = {
        "Accept": "application/json,text/plain,*/*",
        "X-Requested-With": "XMLHttpRequest",
    }
    if referer:
        headers["Referer"] = referer
    text, _ = _fetch_text(url, headers)
    stripped = text.strip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    return _decode_oddsagora_payload(stripped)


def _fetch_provider_names(logs: list[dict[str, Any]], referer: str | None = None) -> dict[str, str]:
    url = f"{ODDSAGORA_BASE_URL}/ajax-providers-bonus-data/0/?logged=false"
    started = time.perf_counter()
    try:
        payload = _fetch_oddsagora_json(url, referer)
    except Exception as exc:
        _log(logs, "provider_names_fetch_failed", url=url, error=str(exc))
        return {}
    data = payload.get("d") if isinstance(payload, dict) else {}
    names = data.get("providersNames") if isinstance(data, dict) else {}
    if not isinstance(names, dict):
        names = {}
    _log(logs, "provider_names_loaded", url=url, count=len(names), tempo_ms=int((time.perf_counter() - started) * 1000))
    return {str(key): str(value) for key, value in names.items()}


def _extract_match_event_template(html: str, game_id: str) -> dict[str, Any] | None:
    readable = unescape(html).replace("\\/", "/")
    pattern = rf"/match-event/(\d+)-(\d+)-{re.escape(game_id)}-(\d+)-(\d+)-([A-Za-z0-9]+)\.dat\?_="
    match = re.search(pattern, readable)
    source_game_id = game_id
    if not match:
        fallback_pattern = r"/match-event/(\d+)-(\d+)-([A-Za-z0-9]+)-(\d+)-(\d+)-([A-Za-z0-9]+)\.dat\?_="
        fallback = re.search(fallback_pattern, readable)
        if not fallback:
            return None
        version_id, sport_id, source_game_id, default_bet_type, scope_id, xhashf = fallback.groups()
    else:
        version_id, sport_id, default_bet_type, scope_id, xhashf = match.groups()
    return {
        "version_id": version_id,
        "sport_id": sport_id,
        "source_game_id": source_game_id,
        "default_bet_type": default_bet_type,
        "scope_id": scope_id,
        "xhashf": xhashf,
    }


def _match_event_url(template: dict[str, Any], game_id: str, market: str, match_url: str = "") -> str | None:
    market_key = str(market or "").casefold()
    bet_type = ODDSAGORA_BET_TYPE_BY_MARKET.get(market_key)
    if not bet_type:
        return None
    version_id = template.get("version_id") or 9
    sport_id = template.get("sport_id") or 6
    scope_id = _scope_id_for_market(template, market, match_url)
    xhashf = template.get("xhashf") or "yj650"
    return f"{ODDSAGORA_BASE_URL}/match-event/{version_id}-{sport_id}-{game_id}-{bet_type}-{scope_id}-{xhashf}.dat?_={int(time.time())}"


def _ordered_odds_values(value: Any) -> list[float]:
    raw_values: list[Any]
    if isinstance(value, dict):
        raw_values = [value[key] for key in sorted(value, key=lambda item: int(item) if str(item).lstrip("-").isdigit() else str(item))]
    elif isinstance(value, (list, tuple)):
        raw_values = list(value)
    else:
        raw_values = []
    odds: list[float] = []
    for raw in raw_values:
        odd = _first_odd(str(raw))
        if odd is not None:
            odds.append(odd)
    return odds


def _movement_value(movements: Any, provider_id: str, index: int) -> Any:
    if not isinstance(movements, dict):
        return None
    value = movements.get(provider_id)
    if isinstance(value, dict):
        return value.get(str(index))
    if isinstance(value, (list, tuple)) and index < len(value):
        return value[index]
    return None


def _active_provider(active: Any, provider_id: str) -> bool:
    if not isinstance(active, dict) or provider_id not in active:
        return True
    return bool(active.get(provider_id))


def _payout_from_odds(odds: list[float]) -> float | None:
    if len(odds) < 2 or any(odd <= 1 for odd in odds[:2]):
        return None
    return round((1 / sum(1 / odd for odd in odds[:2])) * 100, 1)


def parse_match_event_payload(payload: dict[str, Any], market: str, provider_names: dict[str, str] | None = None) -> list[dict[str, Any]]:
    data = payload.get("d") if isinstance(payload, dict) else {}
    oddsdata = data.get("oddsdata") if isinstance(data, dict) else {}
    back = oddsdata.get("back") if isinstance(oddsdata, dict) else {}
    if not isinstance(back, dict):
        return []

    provider_names = provider_names or {}
    parsed: list[dict[str, Any]] = []
    market_key = str(market or "").casefold()
    for item in back.values():
        if not isinstance(item, dict):
            continue
        line = _to_float(item.get("handicapValue"))
        odds_by_provider = item.get("odds")
        if not isinstance(odds_by_provider, dict):
            continue
        for provider_id, raw_odds in odds_by_provider.items():
            provider_key = str(provider_id)
            if not _active_provider(item.get("act"), provider_key):
                continue
            odds = _ordered_odds_values(raw_odds)
            if len(odds) < 2:
                continue
            base = {
                "bookmaker": provider_names.get(provider_key) or f"provider_{provider_key}",
                "bookmaker_id": provider_key,
                "payout": _payout_from_odds(odds),
                "source": "match_event",
            }
            if market_key == "1x2" and len(odds) >= 3:
                parsed.append(
                    {
                        **base,
                        "home_odd": odds[0],
                        "draw_odd": odds[1],
                        "away_odd": odds[2],
                        "movement": {
                            "home": _movement_value(item.get("movement"), provider_key, 0),
                            "draw": _movement_value(item.get("movement"), provider_key, 1),
                            "away": _movement_value(item.get("movement"), provider_key, 2),
                        },
                    }
                )
            elif market_key in ("bts", "both-teams-score"):
                parsed.append(
                    {
                        **base,
                        "yes_odd": odds[0],
                        "no_odd": odds[1],
                        "movement": {
                            "yes": _movement_value(item.get("movement"), provider_key, 0),
                            "no": _movement_value(item.get("movement"), provider_key, 1),
                        },
                    }
                )
            elif market_key in ("double", "double-chance") and len(odds) >= 3:
                parsed.append(
                    {
                        **base,
                        "home_draw_odd": odds[0],
                        "away_draw_odd": odds[1],
                        "home_away_odd": odds[2],
                        "movement": {
                            "home_draw": _movement_value(item.get("movement"), provider_key, 0),
                            "away_draw": _movement_value(item.get("movement"), provider_key, 1),
                            "home_away": _movement_value(item.get("movement"), provider_key, 2),
                        },
                    }
                )
            elif market_key in ("home-away", "moneyline"):
                parsed.append(
                    {
                        **base,
                        "home_odd": odds[0],
                        "away_odd": odds[1],
                        "movement": {
                            "home": _movement_value(item.get("movement"), provider_key, 0),
                            "away": _movement_value(item.get("movement"), provider_key, 1),
                        },
                    }
                )
            elif market_key == "over-under" and line is not None:
                parsed.append(
                    {
                        **base,
                        "line": line,
                        "odd_over": odds[0],
                        "odd_under": odds[1],
                        "movement": {
                            "over": _movement_value(item.get("movement"), provider_key, 0),
                            "under": _movement_value(item.get("movement"), provider_key, 1),
                        },
                    }
                )
            elif market_key in ("ah", "asian-handicap", "handicap") and line is not None:
                parsed.append(
                    {
                        **base,
                        "line": line,
                        "home_odd": odds[0],
                        "away_odd": odds[1],
                        "movement": {
                            "home": _movement_value(item.get("movement"), provider_key, 0),
                            "away": _movement_value(item.get("movement"), provider_key, 1),
                        },
                    }
                )
    return parsed


def _save_debug_file(debug_path: Path | None, relative: str, content: str) -> None:
    if not debug_path:
        return
    path = debug_path / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _extract_market_pages(
    games: list[dict[str, Any]],
    logs: list[dict[str, Any]],
    debug_path: Path | None,
    provider_names: dict[str, str] | None = None,
) -> int:
    odds_count = 0
    for game in games:
        game_id = str(game.get("game_id") or "unknown")
        market_urls = game.get("market_urls") if isinstance(game.get("market_urls"), dict) else {}
        match_url = str(game.get("match_url") or "")
        match_html = ""
        template: dict[str, Any] | None = None
        if match_url:
            started = time.perf_counter()
            try:
                match_html, final_match_url = _fetch_html(match_url)
                _save_debug_file(debug_path, f"html/{game_id}_match.html", match_html)
                template = _extract_match_event_template(match_html, game_id)
                _log(
                    logs,
                    "match_page_opened",
                    game_id=game_id,
                    url=match_url,
                    final_url=final_match_url,
                    html_bytes=len(match_html.encode("utf-8")),
                    endpoint_template=template,
                    tempo_ms=int((time.perf_counter() - started) * 1000),
                )
            except Exception as exc:
                _log(logs, "match_page_fetch_failed", game_id=game_id, url=match_url, error=str(exc))
        for market, url in market_urls.items():
            if not url:
                continue
            started = time.perf_counter()
            endpoint_url = _match_event_url(template, game_id, str(market), match_url) if template else None
            attempted_endpoint = False
            endpoint_failed = False
            if endpoint_url:
                attempted_endpoint = True
                try:
                    payload = _fetch_oddsagora_json(endpoint_url, match_url)
                    _save_debug_file(debug_path, f"json/{game_id}_{market}.json", json.dumps(payload, ensure_ascii=False, indent=2))
                    rows = parse_match_event_payload(payload, str(market), provider_names)
                    if rows:
                        markets = game.setdefault("markets", {})
                        existing = markets.get(market) if isinstance(markets.get(market), list) else []
                        markets[market] = existing + rows
                        odds_count += len(rows)
                    _log(
                        logs,
                        "market_event_parse_finished",
                        game_id=game_id,
                        market=market,
                        endpoint_url=endpoint_url,
                        rows_count=len(rows),
                        tempo_ms=int((time.perf_counter() - started) * 1000),
                    )
                    if rows:
                        continue
                except Exception as exc:
                    endpoint_failed = True
                    _log(logs, "market_event_fetch_failed", game_id=game_id, market=market, endpoint_url=endpoint_url, error=str(exc))
            if attempted_endpoint and not _html_fallback_enabled():
                _log(
                    logs,
                    "market_html_fallback_skipped",
                    game_id=game_id,
                    market=market,
                    endpoint_url=endpoint_url,
                    reason="match_event_failed" if endpoint_failed else "empty_match_event",
                    tempo_ms=int((time.perf_counter() - started) * 1000),
                )
                continue
            try:
                html, final_url = _fetch_html(str(url))
            except Exception as exc:
                _log(logs, "market_fetch_failed", game_id=game_id, market=market, url=url, error=str(exc))
                continue
            _save_debug_file(debug_path, f"html/{game_id}_{market}.html", html)
            blocked = _html_blocked_reason(html)
            if blocked:
                _log(logs, "market_blocked_html", game_id=game_id, market=market, blocked_reason=blocked, final_url=final_url)
                continue
            rows = parse_market_html(html, str(market))
            if rows:
                markets = game.setdefault("markets", {})
                existing = markets.get(market) if isinstance(markets.get(market), list) else []
                markets[market] = existing + rows
                odds_count += len(rows)
            _log(
                logs,
                "market_parse_finished",
                game_id=game_id,
                market=market,
                url=url,
                final_url=final_url,
                html_bytes=len(html.encode("utf-8")),
                rows_count=len(rows),
                tempo_ms=int((time.perf_counter() - started) * 1000),
            )
    return odds_count


def executar_scraper_oddsagora(
    *,
    job_id: str = "",
    esporte: str = "Baseball",
    data_inicio: str = "",
    data_fim: str = "",
    mercados: list[str] | None = None,
    leagues: list[str] | None = None,
    debug: bool = False,
    debug_dir: str | None = None,
    output: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    logs: list[dict[str, Any]] = []
    requested_sport_key = _sport_key(esporte)
    default_markets = _default_markets_for_sport(requested_sport_key)
    effective_markets = [m for m in (mercados or default_markets) if m] or default_markets
    league_urls = leagues or DEFAULT_ODDSAGORA_LEAGUES.get(requested_sport_key, [ODDSAGORA_MLB_URL])
    games: list[dict[str, Any]] = []
    debug_path = Path(debug_dir) if debug and debug_dir else None
    if debug_path:
        debug_path.mkdir(parents=True, exist_ok=True)

    _log(
        logs,
        "scraper_started",
        job_id=job_id,
        esporte=esporte,
        leagues=league_urls,
        mercados_efetivos=effective_markets,
        http_timeout_seconds=_http_timeout_seconds(),
        html_fallback_enabled=_html_fallback_enabled(),
    )
    blocked_reason = None
    for league_url in league_urls:
        started = time.perf_counter()
        try:
            html, final_url = _fetch_html(league_url)
        except Exception as exc:
            _log(logs, "league_fetch_failed", league_url=league_url, error=str(exc))
            continue
        parser = _parse_html(html)
        title = _clean_text(parser.title)
        _save_debug_file(debug_path, "league.html", html)
        blocked_reason = _html_blocked_reason(html)
        _log(
            logs,
            "league_opened",
            league_url=league_url,
            final_url=final_url,
            title=title,
            html_bytes=len(html.encode("utf-8")),
            blocked_reason=blocked_reason,
            tempo_ms=int((time.perf_counter() - started) * 1000),
        )
        if blocked_reason:
            continue
        parsed_games = parse_league_html(
            league_url,
            html,
            effective_markets,
            data_inicio=data_inicio,
            data_fim=data_fim,
            logs=logs,
        )
        games.extend(parsed_games)

    seen: set[str] = set()
    unique_games: list[dict[str, Any]] = []
    for game in games:
        key = _game_key(game)
        if key in seen:
            continue
        seen.add(key)
        unique_games.append(game)
    games = unique_games

    provider_names = _fetch_provider_names(logs, games[0].get("match_url") if games else None) if games else {}
    page_odds_count = _extract_market_pages(games, logs, debug_path, provider_names) if games else 0
    raw_odds_count = sum(len(rows) for game in games for rows in (game.get("markets") or {}).values() if isinstance(rows, list))
    status = "ok"
    mensagem = "Coleta OddsAgora concluida."
    if blocked_reason and not games:
        status = "WARNING"
        mensagem = "OddsAgora retornou pagina de bloqueio/captcha em vez da lista de jogos."
    elif not games:
        status = "WARNING"
        mensagem = "Nenhum jogo encontrado na pagina da liga OddsAgora."
    elif raw_odds_count == 0:
        status = "WARNING"
        mensagem = "Jogos encontrados, mas nenhuma odd extraida."

    _log(
        logs,
        "scraper_finished",
        status=status,
        games_count=len(games),
        page_market_rows=page_odds_count,
        odds_count=raw_odds_count,
        mensagem=mensagem,
    )
    raw = {
        "job_id": job_id,
        "source": "OddsAgora",
        "sport": esporte,
        "league": ", ".join(_league_label_from_url(url) for url in league_urls if _league_label_from_url(url)),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "mensagem": mensagem,
        "games": games,
        "jogos": games,
        "logs": logs,
        "summary": {
            "games_count": len(games),
            "markets_count": len(effective_markets),
            "odds_count": raw_odds_count,
        },
    }
    if output:
        Path(output).write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    return raw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", default="")
    parser.add_argument("--esporte", default="Baseball")
    parser.add_argument("--data-inicio", default="")
    parser.add_argument("--data-fim", default="")
    parser.add_argument("--liga", default="")
    parser.add_argument("--league", action="append", default=[])
    parser.add_argument("--mercado", action="append", default=[])
    parser.add_argument("--output", default="")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--debug-dir", default="")
    args = parser.parse_args()
    result = executar_scraper_oddsagora(
        job_id=args.job_id,
        esporte=args.esporte,
        data_inicio=args.data_inicio,
        data_fim=args.data_fim,
        mercados=args.mercado,
        leagues=args.league or ([args.liga] if args.liga else None),
        debug=args.debug,
        debug_dir=args.debug_dir or None,
        output=args.output or None,
    )
    if not args.output:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
