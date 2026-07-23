from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from typing import Any, Mapping


FULL_PROFILE = "full"
BASIC_PROFILE = "basic"

_YOUTH_PATTERN = re.compile(
    r"(?:\bu[\s._-]?\d{2}\b|\bunder[\s._-]?\d{2}\b|\byouth\b|\bjuniors?\b|\bacademy\b|\bprimavera\b)"
)
_RESERVE_PATTERN = re.compile(r"\b(?:reserve|reserves|reserva|reservas)\b")

# Canonical analytical storage is intentionally narrower than the raw archive.
# The raw provider response remains replayable, while normalized odds focus on
# the sources and market families used by ASP Insights.
PREFERRED_BOOKMAKERS = frozenset(
    {"bet365", "1xbet", "unibet", "william-hill", "stake-com", "betsson", "betway"}
)
SUPPORTED_ODDS_FAMILIES = {
    "football": frozenset(
        {"moneyline", "total", "both_teams_to_score", "first_team_to_score", "handicap", "corners_total"}
    ),
    "baseball": frozenset({"moneyline", "total", "run_line"}),
    "basketball": frozenset({"moneyline", "total", "spread"}),
}

_BASEBALL_COMPETITIONS = frozenset(
    _normalized_name
    for _normalized_name in (
        "mlb",
        "ncaa division i",
        "college world series",
    )
)
_BASKETBALL_COMPETITIONS = frozenset(
    _normalized_name
    for _normalized_name in (
        "wnba", "nba women", "nba", "nba cup", "nba g league", "nba summer league",
        "ncaa", "ncaa women", "nit", "cbi", "big3", "nbb", "euroleague", "eurocup",
        "basketball champions league", "fiba europe cup", "aba league", "bnxt league", "enbl",
        "eurobasket", "acb", "lnb", "bbl", "lega a", "basket league", "super ligi", "nbl",
        "cba", "b league", "kbl", "lkl", "liga a", "cebl", "fiba world cup",
        "fiba world cup women", "olympic games", "olympic games women", "fiba americup",
        "fiba asia cup", "afrobasket", "bal", "bcl americas", "liga sudamericana",
        "pan american games",
    )
)

_QUARANTINED_BASKETBALL_STANDINGS_IDS = frozenset({"11847"})
_QUARANTINED_BASKETBALL_STANDINGS_NAMES = frozenset({"wnba", "nba women"})


@dataclass(frozen=True)
class FootballCollectionDecision:
    profile: str
    reason: str
    league_name: str

    @property
    def allows_detailed_fanout(self) -> bool:
        return self.profile == FULL_PROFILE


def _normalized(value: Any) -> str:
    folded = unicodedata.normalize("NFKD", str(value or ""))
    ascii_text = "".join(character for character in folded if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", " ", ascii_text.casefold()).strip()


def allows_canonical_odds(
    sport: str,
    bookmaker_token: str,
    market_family: str,
    odds_type: str,
) -> bool:
    """Return whether a quote belongs in canonical analytical tables.

    Live markets are retained in the raw archive but are not normalized until
    ASP Insights has a live-betting product. Unknown type is accepted because
    some prematch provider payloads omit the type discriminator.
    """

    return canonical_odds_rejection_reason(
        sport,
        bookmaker_token,
        market_family,
        odds_type,
    ) is None


def canonical_odds_rejection_reason(
    sport: str,
    bookmaker_token: str,
    market_family: str,
    odds_type: str,
) -> str | None:
    """Explain why a provider market is excluded from canonical odds.

    Phase 8D uses these stable reason tokens for operational diagnostics. Raw
    payloads remain archived regardless of the canonical decision.
    """

    normalized_bookmaker = bookmaker_token.casefold().replace(".", "-")
    if normalized_bookmaker not in PREFERRED_BOOKMAKERS:
        return "bookmaker_missing"
    if (
        market_family not in SUPPORTED_ODDS_FAMILIES.get(sport, frozenset())
        or odds_type not in {"prematch", "unknown"}
    ):
        return "market_missing"
    return None


def allows_detailed_match_fanout(sport: str, match: Mapping[str, Any]) -> bool:
    """Limit expensive match detail fan-out to the approved competition catalog."""

    league = match.get("league")
    if isinstance(league, Mapping):
        league_name = league.get("name") or league.get("shortName") or league.get("abbreviation")
    else:
        league_name = league
    normalized = _normalized(league_name)
    if sport == "baseball":
        return normalized in _BASEBALL_COMPETITIONS
    if sport == "basketball":
        return normalized in _BASKETBALL_COMPETITIONS
    return True


def is_quarantined_basketball_standings(
    league: Mapping[str, Any] | None,
    *,
    requested_league_id: Any = None,
) -> bool:
    """Return whether Highlightly standings are unsafe for canonical use.

    League 11847 repeatedly returned a 30-row WNBA document containing one
    unrelated team identity.  Match, statistics and odds endpoints remain
    enabled; only this provider standings contract is quarantined.
    """

    league = league or {}
    league_id = league.get("id") if isinstance(league, Mapping) else None
    league_name = league.get("name") if isinstance(league, Mapping) else None
    return (
        str(league_id if league_id is not None else requested_league_id)
        in _QUARANTINED_BASKETBALL_STANDINGS_IDS
        or _normalized(league_name) in _QUARANTINED_BASKETBALL_STANDINGS_NAMES
    )


def football_collection_decision(match: Mapping[str, Any]) -> FootballCollectionDecision:
    league = match.get("league")
    if isinstance(league, Mapping):
        league_name = str(league.get("name") or league.get("shortName") or "").strip()
    else:
        league_name = str(league or "").strip()
    normalized = _normalized(league_name)

    # Unknown competition names stay on the complete profile. This avoids
    # silently losing useful domains when the provider changes payload shape.
    if not normalized:
        return FootballCollectionDecision(FULL_PROFILE, "unknown_league_conservative_full", league_name)
    if "friendl" in normalized:
        return FootballCollectionDecision(BASIC_PROFILE, "friendly", league_name)
    if _YOUTH_PATTERN.search(normalized):
        return FootballCollectionDecision(BASIC_PROFILE, "youth", league_name)
    if _RESERVE_PATTERN.search(normalized):
        return FootballCollectionDecision(BASIC_PROFILE, "reserve", league_name)
    return FootballCollectionDecision(FULL_PROFILE, "senior_competition", league_name)
