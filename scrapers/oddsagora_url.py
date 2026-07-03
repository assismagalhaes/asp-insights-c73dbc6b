from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

ODDSAGORA_BASE_URL = "https://www.oddsagora.com.br"
ODDSAGORA_MLB_URL = f"{ODDSAGORA_BASE_URL}/baseball/usa/mlb/"

MARKET_HASH = {
    "1x2": "1x2;1",
    "home-away": "home-away;1",
    "moneyline": "home-away;1",
    "over-under": "over-under;1",
    "ah": "ah;1",
    "asian-handicap": "ah;1",
    "handicap": "ah;1",
}


def _split_url(url: str | None):
    text = str(url or "").strip()
    if not text:
        return None
    if text.startswith("/"):
        text = f"{ODDSAGORA_BASE_URL}{text}"
    return urlsplit(text)


def extract_oddsagora_game_id(url: str | None) -> str | None:
    parsed = _split_url(url)
    if parsed is None:
        return None
    fragment = parsed.fragment.strip()
    if fragment:
        return fragment.split(":", 1)[0].strip() or None
    parts = [part for part in parsed.path.split("/") if part]
    for part in reversed(parts):
        if "-" not in part:
            continue
        candidate = part.rsplit("-", 1)[-1].strip()
        if candidate:
            return candidate
    return None


def normalize_oddsagora_url(url: str | None) -> str:
    parsed = _split_url(url)
    if parsed is None:
        return ""
    path = parsed.path or "/"
    if not path.endswith("/"):
        path += "/"
    return urlunsplit((parsed.scheme or "https", parsed.netloc or "www.oddsagora.com.br", path, "", parsed.fragment))


def build_oddsagora_market_url(base_match_url: str, market: str, line: str | float | None = None) -> str:
    parsed = _split_url(base_match_url)
    if parsed is None:
        return ""
    game_id = extract_oddsagora_game_id(base_match_url)
    if not game_id:
        return normalize_oddsagora_url(base_match_url)
    market_key = str(market or "").strip().lower()
    suffix = MARKET_HASH.get(market_key, MARKET_HASH["home-away"])
    if line not in (None, "") and suffix.startswith("ah;"):
        suffix = f"{suffix};{line};0"
    path = parsed.path or "/"
    if not path.endswith("/"):
        path += "/"
    return urlunsplit((parsed.scheme or "https", parsed.netloc or "www.oddsagora.com.br", path, "", f"{game_id}:{suffix}"))
