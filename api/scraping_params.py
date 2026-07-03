from __future__ import annotations

import os
from typing import Any


DEFAULT_FLASHSCORE_BASEBALL_MARKETS = [
    "home-away/ft-including-ot",
    "over-under/ft-including-ot",
    "asian-handicap/ft-including-ot",
]
DEFAULT_ODDSAGORA_BASEBALL_MARKETS = ["home-away", "over-under", "ah"]
ODDSAGORA_MLB_URL = "https://www.oddsagora.com.br/baseball/usa/mlb/"


def _is_baseball(esporte: Any) -> bool:
    text = str(esporte or "").strip().lower()
    return text in {"baseball", "mlb"} or "baseball" in text


def normalize_scraping_params(params: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(params)
    source = str(normalized.get("source") or normalized.get("fonte") or "").strip()
    if not source and _is_baseball(normalized.get("esporte")):
        source = os.getenv("ODDS_SOURCE", "oddsagora")
    if source:
        normalized["source"] = "OddsAgora" if source.lower() == "oddsagora" else "FlashScore"

    mercados = [str(item).strip() for item in (normalized.get("mercados") or []) if str(item).strip()]
    if _is_baseball(normalized.get("esporte")) and not mercados:
        if str(normalized.get("source") or "").lower() == "oddsagora":
            mercados = list(DEFAULT_ODDSAGORA_BASEBALL_MARKETS)
        else:
            mercados = list(DEFAULT_FLASHSCORE_BASEBALL_MARKETS)
        normalized["mercados_padrao_aplicados"] = True
    else:
        normalized["mercados_padrao_aplicados"] = False
    normalized["mercados"] = mercados
    leagues = normalized.get("leagues") or []
    if _is_baseball(normalized.get("esporte")) and str(normalized.get("source") or "").lower() == "oddsagora":
        leagues = [
            ODDSAGORA_MLB_URL
            if "flashscore.com/baseball/usa/mlb" in str(league).lower()
            else str(league)
            for league in leagues
        ] or [ODDSAGORA_MLB_URL]
    normalized["leagues"] = leagues
    return normalized
