from __future__ import annotations

import base64
import html
import json
import os
import re
import time
from pathlib import Path
from typing import Any


_ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def safe_name(value: Any) -> str:
    text = str(value or "unknown").strip() or "unknown"
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text)[:120]


def is_debug_enabled(params: dict[str, Any]) -> bool:
    explicit = params.get("debug")
    if explicit is not None:
        return bool(explicit)
    env_value = str(os.getenv("FLASHSCORE_DEBUG") or os.getenv("SCRAPER_DEBUG") or "").strip().lower()
    if env_value in {"1", "true", "yes", "sim", "on"}:
        return True
    esporte = str(params.get("esporte") or "").strip().lower()
    return "baseball" in esporte or esporte == "mlb"


class ScraperDebugContext:
    def __init__(self, job_id: str, base_dir: Path, enabled: bool = True):
        self.job_id = job_id
        self.enabled = enabled
        self.root_dir = base_dir
        self.job_dir = self.root_dir / f"job_{safe_name(job_id)}"
        self.html_dir = self.job_dir / "html"
        self.screenshot_dir = self.job_dir / "screenshots"
        self.started = time.perf_counter()
        if self.enabled:
            self.html_dir.mkdir(parents=True, exist_ok=True)
            self.screenshot_dir.mkdir(parents=True, exist_ok=True)

    def log(self, event: str, **data: Any) -> None:
        if not self.enabled:
            return
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "job_id": self.job_id,
            "event": event,
            **data,
        }
        with (self.job_dir / "events.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")

    def save_json(self, name: str, data: Any) -> Path | None:
        if not self.enabled:
            return None
        path = self.job_dir / f"{safe_name(name)}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        return path

    def save_html(self, name: str, title: str, data: Any, *, root_copy: bool = False) -> Path | None:
        if not self.enabled:
            return None
        body = html.escape(json.dumps(data, ensure_ascii=False, indent=2, default=str))
        content = (
            "<!doctype html><html><head><meta charset=\"utf-8\">"
            f"<title>{html.escape(title)}</title></head><body>"
            f"<h1>{html.escape(title)}</h1><pre>{body}</pre></body></html>"
        )
        path = self.html_dir / f"{safe_name(name)}.html"
        path.write_text(content, encoding="utf-8")
        if root_copy:
            root_path = self.root_dir / f"{safe_name(name)}.html"
            root_path.write_text(content, encoding="utf-8")
        return path

    def save_placeholder_screenshot(self, mid: str, market: str) -> Path | None:
        if not self.enabled:
            return None
        path = self.screenshot_dir / f"{safe_name(mid)}_{safe_name(market)}.png"
        path.write_bytes(_ONE_PIXEL_PNG)
        return path

    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)


def iter_raw_games(raw_data: Any) -> list[dict[str, Any]]:
    if isinstance(raw_data, list):
        return [item for item in raw_data if isinstance(item, dict)]
    if not isinstance(raw_data, dict):
        return []

    jogos = raw_data.get("jogos")
    if isinstance(jogos, list) and jogos:
        return [item for item in jogos if isinstance(item, dict)]

    games = raw_data.get("games")
    if isinstance(games, list) and games:
        return [item for item in games if isinstance(item, dict)]

    default = raw_data.get("_default")
    if isinstance(default, dict):
        return [item for item in default.values() if isinstance(item, dict)]

    for key in ("data", "result", "results", "items"):
        value = raw_data.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _game_url(game: dict[str, Any]) -> str:
    for key in ("url", "link", "match_url", "fixture_url", "href"):
        value = game.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _game_title(game: dict[str, Any]) -> str:
    for key in ("jogo", "title", "name", "match", "event"):
        value = game.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    home = str(game.get("mandante") or game.get("home") or "").strip()
    away = str(game.get("visitante") or game.get("away") or "").strip()
    return f"{home} vs {away}".strip(" vs")


def _market_rows(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        rows = []
        for nested in value.values():
            if isinstance(nested, list):
                rows.extend(nested)
            elif isinstance(nested, dict):
                rows.extend(_market_rows(nested))
        return rows
    return []


def extract_debug_metrics(raw_data: Any, normalized_data: Any) -> dict[str, Any]:
    games = iter_raw_games(raw_data)
    markets: dict[str, dict[str, Any]] = {}
    bookmaker_names: set[str] = set()

    for game in games:
        odds = game.get("odds")
        if isinstance(odds, dict):
            for market_name, market_payload in odds.items():
                rows = _market_rows(market_payload)
                item = markets.setdefault(str(market_name), {"rows": 0, "bookmakers": set()})
                item["rows"] += len(rows)
                for row in rows:
                    if isinstance(row, list) and row:
                        book = str(row[0] or "").strip()
                    elif isinstance(row, dict):
                        book = str(row.get("bookmaker") or row.get("book") or "").strip()
                    else:
                        book = ""
                    if book:
                        item["bookmakers"].add(book)
                        bookmaker_names.add(book)

        legacy_markets = game.get("mercados")
        if isinstance(legacy_markets, list):
            for row in legacy_markets:
                if not isinstance(row, dict):
                    continue
                market_name = str(row.get("mercado") or "unknown")
                item = markets.setdefault(market_name, {"rows": 0, "bookmakers": set()})
                item["rows"] += 1
                book = str(row.get("bookmaker") or "").strip()
                if book:
                    item["bookmakers"].add(book)
                    bookmaker_names.add(book)

    normalized_rows = []
    if isinstance(normalized_data, dict) and isinstance(normalized_data.get("linhas"), list):
        normalized_rows = normalized_data["linhas"]

    market_summary = []
    for name, data in sorted(markets.items()):
        market_summary.append(
            {
                "nome": name,
                "bookmakers": len(data["bookmakers"]),
                "linhas": data["rows"],
            }
        )

    return {
        "fixtures_encontrados": len(games),
        "jogos_abertos": len([game for game in games if _game_url(game)]),
        "mercados_encontrados": len(markets),
        "mercados": market_summary,
        "bookmakers_encontrados": len(bookmaker_names),
        "odds_extraidas": len(normalized_rows),
    }


def log_raw_debug(
    ctx: ScraperDebugContext,
    raw_data: Any,
    normalized_data: Any,
    *,
    extract_match_id: Any = None,
) -> dict[str, Any]:
    metrics = extract_debug_metrics(raw_data, normalized_data)
    games = iter_raw_games(raw_data)
    ctx.log("fixtures_result", selectors=["external_scraper"], quantidade_partidas=metrics["fixtures_encontrados"])

    if not games:
        ctx.save_html(
            "fixtures_empty",
            "FlashScore fixtures vazio",
            {
                "mensagem": "Nenhuma partida foi encontrada no payload bruto retornado pelo scraper.",
                "raw_preview": raw_data,
            },
        )

    for index, game in enumerate(games, start=1):
        url = _game_url(game)
        mid = extract_match_id(url) if extract_match_id and url else None
        legacy_id = None
        if url and "?" in url:
            legacy_id = extract_match_id(url.split("?", 1)[0]) if extract_match_id else None
        match_key = mid or legacy_id or game.get("id") or index
        ctx.log(
            "match_opened",
            url=url,
            match_id_antigo=legacy_id,
            mid=mid,
            titulo=_game_title(game),
        )
        ctx.save_html(
            f"job_{ctx.job_id}_match_{match_key}",
            f"Raw match source {match_key}",
            game,
            root_copy=True,
        )

    ctx.log(
        "markets_found",
        quantidade=metrics["mercados_encontrados"],
        mercados=[item["nome"] for item in metrics["mercados"]],
    )
    for market in metrics["mercados"]:
        ctx.log(
            "market_detail",
            nome=market["nome"],
            seletor_utilizado="external_scraper",
            bookmakers_encontrados=market["bookmakers"],
            linhas=market["linhas"],
        )
        if market["bookmakers"] == 0:
            market_name = market["nome"]
            mid = "unknown"
            ctx.save_placeholder_screenshot(mid, market_name)
            ctx.save_html(
                f"{mid}_{market_name}",
                f"Mercado sem bookmakers: {market_name}",
                {"mercado": market, "observacao": "Screenshot real indisponivel fora do scraper Selenium."},
            )

    ctx.log("final_summary", **metrics, tempo_total_ms=ctx.elapsed_ms())
    return metrics
