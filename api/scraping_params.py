from __future__ import annotations

from typing import Any


DEFAULT_BASEBALL_MARKETS = [
    "home-away/ft-including-ot",
    "over-under/ft-including-ot",
    "asian-handicap/ft-including-ot",
]


def _is_baseball(esporte: Any) -> bool:
    text = str(esporte or "").strip().lower()
    return text in {"baseball", "mlb"} or "baseball" in text


def normalize_scraping_params(params: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(params)
    mercados = [str(item).strip() for item in (normalized.get("mercados") or []) if str(item).strip()]
    if _is_baseball(normalized.get("esporte")) and not mercados:
        mercados = list(DEFAULT_BASEBALL_MARKETS)
        normalized["mercados_padrao_aplicados"] = True
    else:
        normalized["mercados_padrao_aplicados"] = False
    normalized["mercados"] = mercados
    normalized["leagues"] = normalized.get("leagues") or []
    return normalized
