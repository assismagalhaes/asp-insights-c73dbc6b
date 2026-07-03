from __future__ import annotations

import argparse
import json
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

try:
    from scrapers.oddsagora_url import ODDSAGORA_MLB_URL, build_oddsagora_market_url, extract_oddsagora_game_id
except ModuleNotFoundError:
    from oddsagora_url import ODDSAGORA_MLB_URL, build_oddsagora_market_url, extract_oddsagora_game_id


DEFAULT_BASEBALL_MARKETS = ["home-away", "over-under", "ah"]


class LeagueLinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links: list[dict[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if href and "/baseball/h2h/" in href:
            self._href = href
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self._href:
            return
        title = re.sub(r"\s+", " ", " ".join(self._text)).strip()
        self.links.append({"href": self._href, "title": title})
        self._href = None
        self._text = []


def _fetch_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 ASP Insights OddsAgora scraper"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def _absolute_url(href: str) -> str:
    if href.startswith("http"):
        return href
    return "https://www.oddsagora.com.br" + (href if href.startswith("/") else f"/{href}")


def _parse_title(title: str) -> tuple[str, str, str]:
    text = title.strip()
    date = ""
    date_match = re.search(r"\s+-\s+(\d{2}/\d{2}/\d{4})$", text)
    if date_match:
        date = date_match.group(1)
        text = text[: date_match.start()].strip()
    if " vs " in text:
        home, away = text.split(" vs ", 1)
    else:
        home, away = text, ""
    return home.strip(), away.strip(), date


def _parse_league_games(league_url: str, html: str, markets: list[str]) -> list[dict[str, Any]]:
    parser = LeagueLinkParser()
    parser.feed(html)
    games = []
    seen: set[str] = set()
    for link in parser.links:
        match_url = _absolute_url(link["href"])
        home, away, date = _parse_title(link["title"])
        game_id = extract_oddsagora_game_id(match_url) or match_url.rstrip("/").rsplit("/", 1)[-1]
        key = game_id or match_url
        if key in seen:
            continue
        seen.add(key)
        games.append(
            {
                "game_id": game_id,
                "date": date,
                "time": "",
                "home_team": home,
                "away_team": away,
                "match_url": match_url,
                "market_urls": {market: build_oddsagora_market_url(match_url, market) for market in markets},
                "markets": {market: [] for market in markets},
            }
        )
    return games


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
    effective_markets = [m for m in (mercados or DEFAULT_BASEBALL_MARKETS) if m] or DEFAULT_BASEBALL_MARKETS
    league_urls = leagues or [ODDSAGORA_MLB_URL]
    games: list[dict[str, Any]] = []
    debug_path = Path(debug_dir) if debug and debug_dir else None
    if debug_path:
        debug_path.mkdir(parents=True, exist_ok=True)

    for league_url in league_urls:
        html = _fetch_html(league_url)
        if debug_path:
            (debug_path / "oddsagora_league.html").write_text(html, encoding="utf-8")
        games.extend(_parse_league_games(league_url, html, effective_markets))

    raw = {
        "job_id": job_id,
        "source": "OddsAgora",
        "sport": esporte,
        "league": "MLB" if any("/mlb" in url for url in league_urls) else "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "games": games,
        "summary": {
            "games_count": len(games),
            "markets_count": len(effective_markets),
            "odds_count": 0,
        },
    }
    if output:
        Path(output).write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    return raw


def main() -> None:
    parser = argparse.ArgumentParser()
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
