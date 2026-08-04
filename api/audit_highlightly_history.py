"""Read-only Highlightly historical/statistics capability probe."""
from __future__ import annotations

import os
import sys
import time
from collections.abc import Mapping

sys.path.insert(0, os.path.dirname(__file__))
from highlightly_client import HighlightlyClient, HighlightlyError

SPORTS = ("football", "basketball", "baseball")


def items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, Mapping):
        for key in ("data", "matches", "results", "groups", "standings", "teams", "players"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def first_id(value):
    return value.get("id") if isinstance(value, Mapping) else None


def probe(client, sport, label, path, params):
    started = time.perf_counter()
    try:
        response = client.get(path, params=params)
        elapsed = (time.perf_counter() - started) * 1000
        rows = items(response.data)
        fields = sorted(rows[0].keys())[:20] if rows and isinstance(rows[0], Mapping) else []
        print(f"{sport}\t{label}\t{response.status}\t{elapsed:.0f}ms\t{len(rows)}\t{','.join(fields)}\tquota={response.rate_remaining}/{response.rate_limit}")
        return response.data
    except HighlightlyError as exc:
        elapsed = (time.perf_counter() - started) * 1000
        print(f"{sport}\t{label}\t{exc.status}\t{elapsed:.0f}ms\t0\tERROR\t{exc}")
        return None


def main():
    date = os.environ.get("HIGHLIGHTLY_AUDIT_DATE", "2026-08-01")
    client = HighlightlyClient(
        os.environ.get("HIGHLIGHTLY_API_KEY", ""),
        base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net"),
    )
    print("sport\tendpoint\tstatus\tlatency\trows\tfields\tquota")
    for sport in SPORTS:
        matches_payload = probe(client, sport, "matches", f"/{sport}/matches", {"date": date, "limit": 1})
        match = items(matches_payload)[0] if items(matches_payload) else {}
        match_id = first_id(match)
        if not match_id:
            continue
        probe(client, sport, "match_detail", f"/{sport}/matches/{match_id}", {})
        probe(client, sport, "match_statistics", f"/{sport}/statistics/{match_id}", {})
        if sport == "football":
            probe(client, sport, "box_scores", f"/{sport}/box-score/{match_id}", {})
        else:
            probe(client, sport, "box_scores", f"/{sport}/box-scores/{match_id}", {})
        home = match.get("homeTeam") or match.get("home") or {}
        team_id = first_id(home)
        if team_id:
            probe(client, sport, "team_statistics", f"/{sport}/teams/statistics/{team_id}", {})
            probe(client, sport, "last_five_games", f"/{sport}/last-five-games", {"teamId": team_id})
            if sport != "baseball":
                probe(client, sport, "player_statistics", f"/{sport}/players/{team_id}/statistics", {})


if __name__ == "__main__":
    main()
