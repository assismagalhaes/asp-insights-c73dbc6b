"""Data-quality guardrails for Highlightly responses."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, Iterable, Mapping


@dataclass(frozen=True)
class QualityIssue:
    code: str
    severity: str
    message: str
    context: dict[str, Any]


def audit_standings(payload: Mapping[str, Any]) -> list[QualityIssue]:
    """Detect structurally valid but semantically corrupted standings."""

    entries: list[Mapping[str, Any]] = []
    for group in payload.get("groups", []):
        if isinstance(group, Mapping):
            entries.extend(item for item in group.get("standings", []) if isinstance(item, Mapping))

    identities: list[tuple[Any, Any]] = []
    for entry in entries:
        team = entry.get("team")
        if isinstance(team, Mapping):
            identities.append((team.get("id"), team.get("name")))
    counts = Counter(identities)
    issues: list[QualityIssue] = []
    if len(entries) >= 2 and len(set(identities)) <= 1:
        issues.append(
            QualityIssue(
                code="STANDINGS_SINGLE_TEAM_REPEATED",
                severity="critical",
                message="All standings positions reference the same team identity.",
                context={"entries": len(entries), "unique_teams": len(set(identities)), "teams": list(counts)},
            )
        )
    for identity, count in counts.items():
        if count > 3:
            issues.append(
                QualityIssue(
                    code="STANDINGS_TEAM_DUPLICATED",
                    severity="high",
                    message="A team identity appears in an implausible number of standings positions.",
                    context={"team_id": identity[0], "team_name": identity[1], "occurrences": count},
                )
            )
    return issues


def audit_odds_rows(rows: Iterable[Mapping[str, Any]]) -> list[QualityIssue]:
    """Flag normalized odds that are unsafe to persist or use in models."""

    issues: list[QualityIssue] = []
    for index, row in enumerate(rows):
        raw_ref = row.get("raw_ref") if isinstance(row.get("raw_ref"), Mapping) else {}
        context = {
            "row": index,
            "match_id": raw_ref.get("match_id"),
            "bookmaker": row.get("bookmaker"),
            "market": row.get("mercado"),
            "pick": row.get("pick"),
        }
        try:
            odd = float(row.get("odd"))
        except (TypeError, ValueError):
            issues.append(QualityIssue("ODD_NOT_NUMERIC", "high", "Odd is missing or non-numeric.", context))
        else:
            if odd <= 1.0:
                issues.append(
                    QualityIssue(
                        "ODD_NOT_GREATER_THAN_ONE",
                        "high",
                        "Decimal odds must be greater than 1.00.",
                        {**context, "odd": odd},
                    )
                )
        missing = [name for name in ("mandante", "visitante", "mercado", "pick", "bookmaker") if not row.get(name)]
        if missing:
            issues.append(
                QualityIssue(
                    "ODDS_METADATA_INCOMPLETE",
                    "high",
                    "Normalized odds row is missing required metadata.",
                    {**context, "missing": missing},
                )
            )
    return issues
