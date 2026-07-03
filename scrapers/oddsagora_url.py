from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

ODDSAGORA_BASE_URL = "https://www.oddsagora.com.br"
ODDSAGORA_MLB_URL = f"{ODDSAGORA_BASE_URL}/baseball/usa/mlb/"

DEFAULT_MARKET_HASH = {
    "home-away": "home-away;1",
    "moneyline": "home-away;1",
    "over-under": "over-under;1",
    "ah": "ah;1",
    "asian-handicap": "ah;1",
    "handicap": "ah;1",
}
MARKET_HASH_BY_SPORT = {
    "football": {
        "1x2": "1X2;2",
        "home-away": "1X2;2",
        "moneyline": "1X2;2",
        "over-under": "over-under;2",
        "ah": "ah;2",
        "asian-handicap": "ah;2",
        "handicap": "ah;2",
        "bts": "bts;2",
        "both-teams-score": "bts;2",
        "double": "double;2",
        "double-chance": "double;2",
    },
    "hockey": {
        "1x2": "1X2;2",
        "home-away": "home-away;1",
        "moneyline": "home-away;1",
        "over-under": "over-under;1",
        "ah": "ah;1",
        "asian-handicap": "ah;1",
        "handicap": "ah;1",
        "bts": "bts;5",
        "both-teams-score": "bts;5",
    },
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


def _sport_key_from_path(path: str) -> str:
    parts = [part for part in str(path or "").split("/") if part]
    return parts[0].lower() if parts else ""


def _market_suffix(path: str, market: str) -> str:
    market_key = str(market or "").strip().lower()
    sport_key = _sport_key_from_path(path)
    sport_hashes = MARKET_HASH_BY_SPORT.get(sport_key, {})
    return sport_hashes.get(market_key) or DEFAULT_MARKET_HASH.get(market_key) or DEFAULT_MARKET_HASH["home-away"]


def build_oddsagora_market_url(base_match_url: str, market: str, line: str | float | None = None) -> str:
    parsed = _split_url(base_match_url)
    if parsed is None:
        return ""
    game_id = extract_oddsagora_game_id(base_match_url)
    if not game_id:
        return normalize_oddsagora_url(base_match_url)
    suffix = _market_suffix(parsed.path, market)
    if line not in (None, "") and suffix.startswith("ah;"):
        suffix = f"{suffix};{line};0"
    path = parsed.path or "/"
    if not path.endswith("/"):
        path += "/"
    return urlunsplit((parsed.scheme or "https", parsed.netloc or "www.oddsagora.com.br", path, "", f"{game_id}:{suffix}"))
