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
