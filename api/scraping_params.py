from __future__ import annotations

import os
from typing import Any


DEFAULT_FLASHSCORE_BASEBALL_MARKETS = [
    "home-away/ft-including-ot",
    "over-under/ft-including-ot",
    "asian-handicap/ft-including-ot",
]
DEFAULT_ODDSAGORA_MARKETS = ["home-away", "over-under", "ah"]
DEFAULT_ODDSAGORA_FOOTBALL_MARKETS = ["1x2", "over-under", "ah"]
DEFAULT_ODDSAGORA_BASEBALL_MARKETS = DEFAULT_ODDSAGORA_MARKETS
ODDSAGORA_MLB_URL = "https://www.oddsagora.com.br/baseball/usa/mlb/"
ODDSAGORA_LEAGUES_BY_SPORT = {
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


def _is_baseball(esporte: Any) -> bool:
    text = str(esporte or "").strip().lower()
    return text in {"baseball", "mlb"} or "baseball" in text


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


def _oddsagora_default_markets(sport_key: str) -> list[str]:
    if sport_key == "football":
        return list(DEFAULT_ODDSAGORA_FOOTBALL_MARKETS)
    return list(DEFAULT_ODDSAGORA_MARKETS)


def _is_oddsagora_supported(esporte: Any) -> bool:
    return _sport_key(esporte) in ODDSAGORA_LEAGUES_BY_SPORT


def normalize_scraping_params(params: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(params)
    sport_key = _sport_key(normalized.get("esporte"))
    source = str(normalized.get("source") or normalized.get("fonte") or "").strip()
    if not source and _is_oddsagora_supported(normalized.get("esporte")):
        source = os.getenv("ODDS_SOURCE", "oddsagora")
    if source:
        normalized["source"] = "OddsAgora" if source.lower() == "oddsagora" else "FlashScore"

    mercados = [str(item).strip() for item in (normalized.get("mercados") or []) if str(item).strip()]
    if _is_oddsagora_supported(normalized.get("esporte")) and not mercados and str(normalized.get("source") or "").lower() == "oddsagora":
        mercados = _oddsagora_default_markets(sport_key)
        normalized["mercados_padrao_aplicados"] = True
    elif _is_baseball(normalized.get("esporte")) and not mercados:
        if str(normalized.get("source") or "").lower() == "oddsagora":
            mercados = list(DEFAULT_ODDSAGORA_BASEBALL_MARKETS)
        else:
            mercados = list(DEFAULT_FLASHSCORE_BASEBALL_MARKETS)
        normalized["mercados_padrao_aplicados"] = True
    else:
        normalized["mercados_padrao_aplicados"] = False
    normalized["mercados"] = mercados
    leagues = normalized.get("leagues") or []
    if _is_oddsagora_supported(normalized.get("esporte")) and str(normalized.get("source") or "").lower() == "oddsagora":
        default_leagues = ODDSAGORA_LEAGUES_BY_SPORT[sport_key]
        leagues = [
            ODDSAGORA_MLB_URL
            if "flashscore.com/baseball/usa/mlb" in str(league).lower()
            else str(league)
            for league in leagues
        ] or list(default_leagues)
    normalized["leagues"] = leagues
    return normalized
