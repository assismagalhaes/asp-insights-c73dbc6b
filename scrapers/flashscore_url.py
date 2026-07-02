from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

FLASH_SCORE_ID_RE = re.compile(r"^[A-Za-z0-9]{6,12}$")
FLASH_SCORE_TEAM_SLUG_RE = re.compile(r"^[a-z0-9-]+-[A-Za-z0-9]{6,12}$", re.IGNORECASE)
FLASH_SCORE_SPORT_PARTS = {
    "american-football",
    "aussie-rules",
    "badminton",
    "bandy",
    "baseball",
    "basketball",
    "beach-soccer",
    "beach-volleyball",
    "boxing",
    "cricket",
    "darts",
    "field-hockey",
    "floorball",
    "football",
    "futsal",
    "golf",
    "handball",
    "hockey",
    "kabaddi",
    "mma",
    "motorsport",
    "netball",
    "rugby-league",
    "rugby-union",
    "snooker",
    "tennis",
    "volleyball",
    "water-polo",
}


def _trim(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _split_url(url: str):
    text = str(url or "").strip()
    if not text:
        return None
    if not re.match(r"^[a-z][a-z0-9+.-]*://", text, re.IGNORECASE):
        text = "https://www.flashscore.com" + (text if text.startswith("/") else f"/{text}")
    return urlsplit(text)


def extract_legacy_match_id_from_path(path: str) -> str | None:
    parts = [part for part in path.split("/") if part]
    if not parts:
        return None

    for idx, part in enumerate(parts):
        if part != "match" or idx + 1 >= len(parts):
            continue

        candidate = parts[idx + 1].strip()
        if candidate.lower() in FLASH_SCORE_SPORT_PARTS and idx + 2 < len(parts):
            candidate = parts[idx + 2].strip()

        if FLASH_SCORE_ID_RE.match(candidate) and not FLASH_SCORE_TEAM_SLUG_RE.match(candidate):
            return candidate

    for part in reversed(parts):
        if part == "odds":
            break
        if FLASH_SCORE_ID_RE.match(part) and not FLASH_SCORE_TEAM_SLUG_RE.match(part):
            return part

    return None


def extract_flashscore_match_id(url: str | None) -> str | None:
    parsed = _split_url(str(url or ""))
    if parsed is None:
        return None

    for key, value in parse_qsl(parsed.query, keep_blank_values=False):
        if key == "mid":
            mid = _trim(value)
            if mid:
                return mid

    return extract_legacy_match_id_from_path(parsed.path)


def normalize_flashscore_url(url: str | None) -> str:
    parsed = _split_url(str(url or ""))
    if parsed is None:
        return ""

    path = re.sub(r"/+", "/", parsed.path).rstrip("/")
    if not path:
        path = "/"
    elif parsed.path.endswith("/"):
        path += "/"

    mid = extract_flashscore_match_id(str(url or ""))
    query_pairs = []
    if mid:
        query_pairs.append(("mid", mid))

    return urlunsplit((parsed.scheme, parsed.netloc, path, urlencode(query_pairs), ""))


def flashscore_market_url(url: str, market: str) -> str:
    parsed = _split_url(url)
    if parsed is None:
        return ""

    parts = [part for part in parsed.path.split("/") if part]
    try:
        odds_idx = parts.index("odds")
    except ValueError:
        return normalize_flashscore_url(url)

    if odds_idx + 1 < len(parts):
        parts[odds_idx + 1] = market.strip("/")
    else:
        parts.append(market.strip("/"))

    path = "/" + "/".join(parts) + "/"
    mid = extract_flashscore_match_id(url)
    query = urlencode([("mid", mid)]) if mid else ""
    return urlunsplit((parsed.scheme, parsed.netloc, path, query, ""))
