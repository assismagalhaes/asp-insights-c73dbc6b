from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping

from .common import (
    NormalizationContext,
    NormalizedBatch,
    TablePatch,
    add_metric_definition,
    add_provider_mapping,
    flatten_metrics,
    items,
    slug,
    stable_id,
    typed_value,
)


_LINE = re.compile(r"(?<!\d)([+-]?\d+(?:\.\d+)?)(?!\d)")
_BOOKMAKER_TOKEN = re.compile(r"[^a-z0-9._-]+")

SUPPORTED_NORMALIZERS = frozenset({
    "football.bookmakers",
    "football.box_scores",
    "football.countries",
    "football.events",
    "football.head_to_head",
    "football.highlights",
    "football.highlight_geo_restrictions",
    "football.last_five_games",
    "football.leagues",
    "football.lineups",
    "football.matches",
    "football.odds",
    "football.players",
    "football.player_statistics",
    "football.standings",
    "football.match_statistics",
    "football.teams",
    "football.team_statistics",
})


def _external(value: Any, fallback: str) -> str:
    text = str(value if value is not None else "").strip()
    return text or fallback


def _bookmaker_token(value: Any) -> str:
    return _BOOKMAKER_TOKEN.sub("-", str(value or "").strip().casefold()).strip("-")


def _status(state: Any) -> str:
    description = str(state.get("description") if isinstance(state, Mapping) else state or "").casefold()
    if any(word in description for word in ("finished", "awarded")):
        return "finished"
    if any(word in description for word in ("first half", "second half", "extra time", "penalties", "in progress")):
        return "live"
    if any(word in description for word in ("half time", "break", "interrupted", "suspended")):
        return "paused"
    if "postponed" in description or "announced" in description:
        return "postponed"
    if any(word in description for word in ("cancelled", "abandoned")):
        return "cancelled"
    if "not started" in description:
        return "scheduled"
    return "unknown"


def _ensure_country(batch: NormalizedBatch, ctx: NormalizationContext, country: Mapping[str, Any]) -> str:
    code = _external(country.get("code"), slug(country.get("name"))).upper()
    country_id = stable_id(ctx.provider_id, ctx.sport_id, "country", code)
    batch.add(
        "sports_countries",
        {
            "id": country_id,
            "code": code,
            "name": str(country.get("name") or code),
            "flag_url": country.get("logo") or country.get("flagUrl"),
            "metadata": {"provider": "highlightly"},
        },
    )
    add_provider_mapping(batch, ctx, "country", code, country_id, country)
    return country_id


def _ensure_team(batch: NormalizedBatch, ctx: NormalizationContext, team: Mapping[str, Any]) -> str:
    external_id = _external(team.get("id"), f"name:{slug(team.get('name'))}")
    team_id = stable_id(ctx.provider_id, ctx.sport_id, "team", external_id)
    batch.add(
        "sports_teams",
        {
            "id": team_id,
            "sport_id": ctx.sport_id,
            "name": str(team.get("name") or external_id),
            "display_name": team.get("displayName") or team.get("fullName"),
            "abbreviation": team.get("abbreviation"),
            "team_type": team.get("type"),
            "logo_url": team.get("logo") or team.get("logoUrl"),
            "metadata": {key: value for key, value in team.items() if key not in {"id", "name", "displayName", "fullName", "abbreviation", "type", "logo", "logoUrl"}},
        },
    )
    add_provider_mapping(batch, ctx, "team", external_id, team_id, team)
    return team_id


def _ensure_player(
    batch: NormalizedBatch,
    ctx: NormalizationContext,
    player: Mapping[str, Any],
    *,
    team_id: str | None = None,
) -> str:
    external_id = _external(player.get("id"), f"name:{team_id or 'none'}:{slug(player.get('name') or player.get('fullName'))}")
    player_id = stable_id(ctx.provider_id, ctx.sport_id, "player", external_id)
    name = str(player.get("name") or player.get("fullName") or external_id)
    batch.add(
        "sports_players",
        {
            "id": player_id,
            "sport_id": ctx.sport_id,
            "current_team_id": team_id,
            "name": name,
            "display_name": player.get("fullName") or player.get("displayName"),
            "first_name": player.get("firstName"),
            "last_name": player.get("lastName"),
            "position": player.get("position"),
            "nationality": player.get("nationality"),
            "birth_date": player.get("dateOfBirth") or player.get("birthDate"),
            "image_url": player.get("logo") or player.get("image") or player.get("imageUrl"),
            "metadata": {key: value for key, value in player.items() if key not in {"id", "name", "fullName", "displayName", "firstName", "lastName", "position", "nationality", "dateOfBirth", "birthDate", "logo", "image", "imageUrl"}},
        },
    )
    add_provider_mapping(batch, ctx, "player", external_id, player_id, player)
    return player_id


def _ensure_competition(
    batch: NormalizedBatch,
    ctx: NormalizationContext,
    league: Mapping[str, Any],
    *,
    country_id: str | None = None,
) -> tuple[str, str | None]:
    external_id = _external(league.get("id"), f"name:{slug(league.get('name'))}")
    competition_id = stable_id(ctx.provider_id, ctx.sport_id, "competition", external_id)
    batch.add(
        "sports_competitions",
        {
            "id": competition_id,
            "sport_id": ctx.sport_id,
            "country_id": country_id,
            "name": str(league.get("name") or external_id),
            "short_name": league.get("shortName"),
            "competition_type": league.get("type"),
            "logo_url": league.get("logo"),
            "metadata": {"provider": "highlightly"},
        },
    )
    add_provider_mapping(batch, ctx, "competition", external_id, competition_id, league)
    season_value = league.get("season")
    season_id: str | None = None
    if season_value is not None:
        season_external = f"{external_id}:{season_value}"
        season_id = stable_id(ctx.provider_id, ctx.sport_id, "season", season_external)
        batch.add(
            "sports_seasons",
            {
                "id": season_id,
                "competition_id": competition_id,
                "label": str(season_value),
                "metadata": {"provider_season": season_value},
            },
        )
        add_provider_mapping(batch, ctx, "season", season_external, season_id, {"season": season_value, "leagueId": external_id})
    return competition_id, season_id


def _normalize_matches(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    batch = NormalizedBatch(received=len(items(payload)))
    for match in items(payload):
        external_id = match.get("id")
        if external_id is None:
            batch.rejected += 1
            batch.issue("MATCH_ID_MISSING", "Match payload has no provider id.", context={"match": match})
            continue
        country = match.get("country") if isinstance(match.get("country"), Mapping) else {}
        country_id = _ensure_country(batch, ctx, country) if country else None
        league = match.get("league") if isinstance(match.get("league"), Mapping) else {}
        competition_id, season_id = _ensure_competition(batch, ctx, league, country_id=country_id) if league else (None, None)
        home = match.get("homeTeam") if isinstance(match.get("homeTeam"), Mapping) else {}
        away = match.get("awayTeam") if isinstance(match.get("awayTeam"), Mapping) else {}
        home_id = _ensure_team(batch, ctx, home) if home else None
        away_id = _ensure_team(batch, ctx, away) if away else None
        match_id = stable_id(ctx.provider_id, ctx.sport_id, "match", external_id)
        state = match.get("state") if isinstance(match.get("state"), Mapping) else {}
        batch.add(
            "sports_matches",
            {
                "id": match_id,
                "sport_id": ctx.sport_id,
                "competition_id": competition_id,
                "season_id": season_id,
                "kickoff_at": match.get("date"),
                "status": _status(state),
                "provider_status": state.get("description"),
                "round_name": match.get("round"),
                "score_data": state.get("score") or {},
                "state_data": state,
            },
        )
        add_provider_mapping(batch, ctx, "match", external_id, match_id, match)
        for role, team_id in (("home", home_id), ("away", away_id)):
            if team_id:
                batch.add(
                    "sports_match_participants",
                    {
                        "id": stable_id(match_id, "participant", role),
                        "match_id": match_id,
                        "team_id": team_id,
                        "role": role,
                        "score_data": state.get("score") or {},
                    },
                )
    return batch


def _normalize_catalog(payload: Any, ctx: NormalizationContext, resource: str) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    for record in records:
        if resource == "countries":
            _ensure_country(batch, ctx, record)
        elif resource == "teams":
            _ensure_team(batch, ctx, record)
        elif resource == "players":
            team = record.get("team") if isinstance(record.get("team"), Mapping) else {}
            _ensure_player(batch, ctx, record, team_id=_ensure_team(batch, ctx, team) if team else None)
        elif resource == "leagues":
            country = record.get("country") if isinstance(record.get("country"), Mapping) else {}
            competition_id, _ = _ensure_competition(
                batch, ctx, record, country_id=_ensure_country(batch, ctx, country) if country else None
            )
            for season in record.get("seasons", []):
                if not isinstance(season, Mapping) or season.get("season") is None:
                    continue
                value = season["season"]
                external = f"{record.get('id')}:{value}"
                season_id = stable_id(ctx.provider_id, ctx.sport_id, "season", external)
                batch.add("sports_seasons", {"id": season_id, "competition_id": competition_id, "label": str(value), "metadata": season})
                add_provider_mapping(batch, ctx, "season", external, season_id, season)
        elif resource == "bookmakers":
            name = str(record.get("name") or record.get("id") or "unknown")
            normalized = _bookmaker_token(name)
            bookmaker_id = ctx.bookmaker_ids.get(normalized)
            if not bookmaker_id:
                bookmaker_id = stable_id(ctx.provider_id, ctx.sport_id, "bookmaker", record.get("id") or normalized)
                batch.add(
                    "sports_bookmakers",
                    {"id": bookmaker_id, "name": name, "normalized_name": normalized, "is_active": True, "metadata": {"provider": "highlightly"}},
                )
            add_provider_mapping(batch, ctx, "bookmaker", record.get("id") or normalized, bookmaker_id, record)
    return batch


def _market_family(name: str) -> str:
    lowered = name.casefold()
    if "both teams" in lowered:
        return "both_teams_to_score"
    if "corner" in lowered:
        return "corners_total"
    if "total" in lowered or "over/under" in lowered:
        return "total"
    if "spread" in lowered or "handicap" in lowered:
        return "handicap"
    if "result" in lowered or "moneyline" in lowered or "home/away" in lowered:
        return "moneyline"
    return slug(name)


def _line_value(market: str, selection: str) -> tuple[str, float | None]:
    numbers = _LINE.findall(market)
    if not numbers:
        return "", None
    chosen = numbers[-1]
    if any(token in market.casefold() for token in ("spread", "handicap")) and len(numbers) >= 2:
        if selection.casefold() == "home":
            chosen = numbers[-2]
        elif selection.casefold() == "away":
            chosen = numbers[-1]
    try:
        return chosen, float(chosen)
    except ValueError:
        return chosen, None


def _normalize_odds(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    for record in records:
        match_external = record.get("matchId")
        if match_external is None:
            batch.rejected += 1
            batch.issue("ODDS_MATCH_ID_MISSING", "Odds payload has no matchId.")
            continue
        match_id = stable_id(ctx.provider_id, ctx.sport_id, "match", match_external)
        for market in record.get("odds", []):
            if not isinstance(market, Mapping):
                continue
            bookmaker_name = str(market.get("bookmakerName") or market.get("bookmakerId") or "unknown")
            normalized_bookmaker = _bookmaker_token(bookmaker_name)
            bookmaker_id = ctx.bookmaker_ids.get(normalized_bookmaker)
            if not bookmaker_id:
                bookmaker_id = stable_id(ctx.provider_id, ctx.sport_id, "bookmaker", market.get("bookmakerId") or normalized_bookmaker)
                batch.add("sports_bookmakers", {"id": bookmaker_id, "name": bookmaker_name, "normalized_name": normalized_bookmaker, "is_active": True, "metadata": {"provider": "highlightly"}})
            add_provider_mapping(batch, ctx, "bookmaker", market.get("bookmakerId") or normalized_bookmaker, bookmaker_id, market)
            market_name = str(market.get("market") or "unknown")
            odds_type = str(market.get("type") or "unknown").casefold()
            if odds_type not in {"prematch", "live"}:
                odds_type = "unknown"
            market_id = stable_id(ctx.provider_id, ctx.sport_id, "market", odds_type, market_name)
            batch.add(
                "sports_market_definitions",
                {
                    "id": market_id,
                    "provider_id": ctx.provider_id,
                    "sport_id": ctx.sport_id,
                    "provider_market_key": market_name,
                    "canonical_family": _market_family(market_name),
                    "display_name": market_name,
                    "odds_type": odds_type,
                    "metadata": {"provider_type": market.get("type")},
                },
            )
            for selection in market.get("values", []):
                if not isinstance(selection, Mapping):
                    continue
                selection_name = str(selection.get("value") or "").strip()
                try:
                    decimal_odds = float(selection.get("odd"))
                except (TypeError, ValueError):
                    decimal_odds = 0
                if not selection_name or decimal_odds <= 1 or decimal_odds > 10000:
                    batch.rejected += 1
                    batch.issue(
                        "ODDS_QUOTE_INVALID",
                        "Odds selection is missing a name or has an invalid decimal price.",
                        context={"matchId": match_external, "market": market_name, "selection": selection_name, "odd": selection.get("odd")},
                    )
                    continue
                line_key, line_value = _line_value(market_name, selection_name)
                batch.odds_quotes.append(
                    {
                        "p_match_id": match_id,
                        "p_bookmaker_id": bookmaker_id,
                        "p_market_definition_id": market_id,
                        "p_selection_key": slug(selection_name),
                        "p_selection_name": selection_name,
                        "p_line_key": line_key,
                        "p_line_value": line_value,
                        "p_decimal_odds": decimal_odds,
                        "p_quote_status": "open",
                        "p_is_live": odds_type == "live",
                        "p_provider_updated_at": None,
                        "p_collected_at": ctx.captured_at,
                        "p_source_raw_object_id": ctx.raw_object_id,
                    }
                )
    return batch


def _request_match_id(ctx: NormalizationContext) -> str:
    external = ctx.request_params.get("matchId") or ctx.request_params.get("id")
    if external is None:
        raise ValueError(f"{ctx.normalizer} requires matchId or id in request_params")
    return stable_id(ctx.provider_id, ctx.sport_id, "match", external)


def _normalize_match_statistics(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    match_id = _request_match_id(ctx)
    for record in records:
        team = record.get("team") if isinstance(record.get("team"), Mapping) else {}
        if not team:
            batch.rejected += 1
            continue
        team_id = _ensure_team(batch, ctx, team)
        for statistic in record.get("statistics", []):
            if not isinstance(statistic, Mapping) or statistic.get("value") is None:
                continue
            display = str(statistic.get("displayName") or "unknown")
            metric_id = add_metric_definition(batch, ctx, resource="match_statistics", provider_key=display, display_name=display, value=statistic["value"])
            batch.add(
                "sports_match_team_stats",
                {
                    "id": stable_id(match_id, team_id, metric_id, "", ""),
                    "match_id": match_id,
                    "team_id": team_id,
                    "metric_definition_id": metric_id,
                    **typed_value(statistic["value"]),
                    "source_raw_object_id": ctx.raw_object_id,
                    "collected_at": ctx.captured_at,
                },
            )
    return batch


def _normalize_lineups(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    batch = NormalizedBatch(received=1)
    match_id = _request_match_id(ctx)
    document = items(payload)[0] if items(payload) else {}
    for side in ("homeTeam", "awayTeam"):
        team = document.get(side) if isinstance(document.get(side), Mapping) else {}
        if not team:
            continue
        team_id = _ensure_team(batch, ctx, team)
        version = hashlib.sha256(json.dumps(team, sort_keys=True, default=str).encode("utf-8")).hexdigest()
        lineup_id = stable_id(match_id, team_id, "lineup", version)
        batch.add(
            "sports_lineups",
            {
                "id": lineup_id,
                "match_id": match_id,
                "team_id": team_id,
                "version_key": version,
                "formation": team.get("formation"),
                "is_confirmed": True,
                "published_at": ctx.captured_at,
                "source_raw_object_id": ctx.raw_object_id,
            },
        )
        starters = team.get("initialLineup", [])
        for row_index, formation_row in enumerate(starters):
            player_rows = formation_row if isinstance(formation_row, list) else [formation_row]
            for order, player in enumerate(player_rows):
                if not isinstance(player, Mapping):
                    continue
                player_id = _ensure_player(batch, ctx, player, team_id=team_id)
                batch.add("sports_lineup_players", {"id": stable_id(lineup_id, player_id), "lineup_id": lineup_id, "player_id": player_id, "role": "starter", "position": player.get("position"), "shirt_number": player.get("number"), "formation_row": row_index, "formation_order": order})
        for order, player in enumerate(team.get("substitutes", [])):
            if not isinstance(player, Mapping):
                continue
            player_id = _ensure_player(batch, ctx, player, team_id=team_id)
            batch.add("sports_lineup_players", {"id": stable_id(lineup_id, player_id), "lineup_id": lineup_id, "player_id": player_id, "role": "substitute", "position": player.get("position"), "shirt_number": player.get("number"), "formation_order": order})
    return batch


def _elapsed_seconds(clock: Any) -> int | None:
    text = str(clock or "").strip().replace("'", "")
    if not text:
        return None
    try:
        return sum(int(part) for part in text.split("+")) * 60
    except ValueError:
        return None


def _normalize_events(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    match_id = _request_match_id(ctx)
    for index, event in enumerate(records):
        team = event.get("team") if isinstance(event.get("team"), Mapping) else {}
        team_id = _ensure_team(batch, ctx, team) if team else None
        player_id = None
        if event.get("playerId") is not None or event.get("player"):
            player_id = _ensure_player(batch, ctx, {"id": event.get("playerId"), "name": event.get("player")}, team_id=team_id)
        related_id = None
        if event.get("assistingPlayerId") is not None or event.get("assist") or event.get("substituted"):
            related_id = _ensure_player(batch, ctx, {"id": event.get("assistingPlayerId"), "name": event.get("assist") or event.get("substituted")}, team_id=team_id)
        sequence = hashlib.sha256(json.dumps(event, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:24]
        batch.add("sports_match_events", {"id": stable_id(match_id, "event", sequence), "match_id": match_id, "sequence_key": f"{index:04d}:{sequence}", "event_type": str(event.get("type") or "unknown"), "clock_display": event.get("time"), "elapsed_seconds": _elapsed_seconds(event.get("time")), "team_id": team_id, "player_id": player_id, "related_player_id": related_id, "source_raw_object_id": ctx.raw_object_id, "metadata": dict(event), "collected_at": ctx.captured_at})
    return batch


def _normalize_standings(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    document = items(payload)[0] if items(payload) else {}
    batch = NormalizedBatch(received=sum(len(group.get("standings", [])) for group in document.get("groups", []) if isinstance(group, Mapping)))
    league = document.get("league") if isinstance(document.get("league"), Mapping) else {}
    competition_id, season_id = _ensure_competition(batch, ctx, league)
    if season_id is None:
        batch.issue("STANDINGS_SEASON_MISSING", "Standings payload has no season.", context={"league": league})
        batch.rejected = batch.received
        return batch
    for group in document.get("groups", []):
        if not isinstance(group, Mapping):
            continue
        group_key = str(group.get("name") or "")
        identities: list[str] = []
        for standing in group.get("standings", []):
            if not isinstance(standing, Mapping):
                continue
            team = standing.get("team") if isinstance(standing.get("team"), Mapping) else {}
            team_id = _ensure_team(batch, ctx, team)
            identities.append(team_id)
            total = standing.get("total") if isinstance(standing.get("total"), Mapping) else {}
            row_id = stable_id(competition_id, season_id, group_key, ctx.captured_at, team_id)
            batch.add("sports_standings_snapshots", {"id": row_id, "competition_id": competition_id, "season_id": season_id, "team_id": team_id, "group_key": group_key, "snapshot_at": ctx.captured_at, "rank": standing.get("position"), "points": standing.get("points", 0), "played": total.get("games"), "wins": total.get("wins"), "draws": total.get("draws"), "losses": total.get("loses"), "scored": total.get("scoredGoals"), "conceded": total.get("receivedGoals"), "goal_difference": (total.get("scoredGoals") - total.get("receivedGoals")) if isinstance(total.get("scoredGoals"), (int, float)) and isinstance(total.get("receivedGoals"), (int, float)) else None, "split_data": {"total": total, "home": standing.get("home"), "away": standing.get("away")}, "source_raw_object_id": ctx.raw_object_id})
        if len(identities) > 1 and len(set(identities)) == 1:
            batch.issue("STANDINGS_SINGLE_TEAM_REPEATED", "All standings positions reference the same team.", severity="critical", context={"group": group_key, "entries": len(identities)})
            for row in batch.rows.get("sports_standings_snapshots", {}).values():
                if row.get("group_key") == group_key:
                    row["quality_status"] = "quarantined"
    return batch


def _normalize_team_stats(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    team_external = ctx.request_params.get("id")
    if team_external is None:
        raise ValueError("football.team_statistics requires id in request_params")
    team_id = stable_id(ctx.provider_id, ctx.sport_id, "team", team_external)
    for document in records:
        league = {"id": document.get("leagueId"), "name": document.get("leagueName"), "season": document.get("season")}
        competition_id, season_id = _ensure_competition(batch, ctx, league)
        for split in ("total", "home", "away"):
            for metric_key, value in flatten_metrics(document.get(split, {})):
                metric_id = add_metric_definition(batch, ctx, resource="team_statistics", group_name=split, provider_key=metric_key, value=value)
                batch.add("sports_team_season_stats", {"id": stable_id(team_id, competition_id, season_id, metric_id, "season", split, ""), "team_id": team_id, "competition_id": competition_id, "season_id": season_id, "metric_definition_id": metric_id, "scope_key": "season", "split_key": split, **typed_value(value), "source_raw_object_id": ctx.raw_object_id, "collected_at": ctx.captured_at})
    return batch


def _normalize_player_stats(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    for document in records:
        player_id = _ensure_player(batch, ctx, document)
        excluded = {"id", "name", "fullName", "logo", "position", "team", "clubs", "competitions"}
        for metric_key, value in flatten_metrics({key: value for key, value in document.items() if key not in excluded}):
            metric_id = add_metric_definition(batch, ctx, resource="player_statistics", provider_key=metric_key, value=value)
            batch.add("sports_player_stats", {"id": stable_id(player_id, metric_id, "career", "total", ""), "player_id": player_id, "metric_definition_id": metric_id, "scope_key": "career", "split_key": "total", **typed_value(value), "source_raw_object_id": ctx.raw_object_id, "collected_at": ctx.captured_at})
    return batch


def _normalize_box_scores(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    match_id = _request_match_id(ctx)
    for team_block in records:
        team = team_block.get("team") if isinstance(team_block.get("team"), Mapping) else {}
        team_id = _ensure_team(batch, ctx, team)
        for player in team_block.get("players", []):
            if not isinstance(player, Mapping):
                continue
            player_id = _ensure_player(batch, ctx, player, team_id=team_id)
            top_level = {key: value for key, value in player.items() if key not in {"id", "name", "fullName", "logo", "position", "statistics"}}
            metric_values = flatten_metrics(top_level)
            for statistic in player.get("statistics", []):
                if isinstance(statistic, Mapping):
                    metric_values.extend(flatten_metrics(statistic))
            for metric_key, value in metric_values:
                metric_id = add_metric_definition(batch, ctx, resource="player_box_scores", provider_key=metric_key, value=value)
                batch.add("sports_player_box_scores", {"id": stable_id(match_id, player_id, metric_id, ""), "match_id": match_id, "player_id": player_id, "team_id": team_id, "metric_definition_id": metric_id, **typed_value(value), "source_raw_object_id": ctx.raw_object_id, "collected_at": ctx.captured_at})
    return batch


def _normalize_highlights(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    for highlight in records:
        external_id = highlight.get("id")
        if external_id is None:
            batch.rejected += 1
            continue
        match = highlight.get("match") if isinstance(highlight.get("match"), Mapping) else {}
        match_external = match.get("id") or highlight.get("matchId")
        batch.add("sports_highlights", {"id": stable_id(ctx.provider_id, ctx.sport_id, "highlight", external_id), "provider_id": ctx.provider_id, "sport_id": ctx.sport_id, "match_id": stable_id(ctx.provider_id, ctx.sport_id, "match", match_external) if match_external is not None else None, "external_id": str(external_id), "highlight_type": highlight.get("type"), "title": str(highlight.get("title") or f"Highlight {external_id}"), "description": highlight.get("description"), "source_name": highlight.get("source"), "channel_name": highlight.get("channel"), "category": highlight.get("category"), "preview_url": highlight.get("imgUrl"), "content_url": str(highlight.get("url") or highlight.get("embedUrl") or ""), "embed_url": highlight.get("embedUrl"), "source_raw_object_id": ctx.raw_object_id, "metadata": {"match": match}})
    return batch


def _normalize_geo_restrictions(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    batch = NormalizedBatch(received=1)
    external_id = ctx.request_params.get("id")
    if external_id is None:
        raise ValueError("football.highlight_geo_restrictions requires id in request_params")
    batch.patches.append(TablePatch("sports_highlights", {"provider_id": ctx.provider_id, "sport_id": ctx.sport_id, "external_id": str(external_id)}, {"geo_restrictions": payload, "source_raw_object_id": ctx.raw_object_id}))
    return batch


def normalize_football(payload: Any, context: NormalizationContext) -> NormalizedBatch:
    normalizer = context.normalizer
    if normalizer in {"football.matches", "football.head_to_head", "football.last_five_games"}:
        return _normalize_matches(payload, context)
    if normalizer in {"football.countries", "football.leagues", "football.teams", "football.players", "football.bookmakers"}:
        return _normalize_catalog(payload, context, normalizer.split(".", 1)[1])
    if normalizer == "football.odds":
        return _normalize_odds(payload, context)
    if normalizer == "football.match_statistics":
        return _normalize_match_statistics(payload, context)
    if normalizer == "football.lineups":
        return _normalize_lineups(payload, context)
    if normalizer == "football.events":
        return _normalize_events(payload, context)
    if normalizer == "football.standings":
        return _normalize_standings(payload, context)
    if normalizer == "football.team_statistics":
        return _normalize_team_stats(payload, context)
    if normalizer == "football.player_statistics":
        return _normalize_player_stats(payload, context)
    if normalizer == "football.box_scores":
        return _normalize_box_scores(payload, context)
    if normalizer == "football.highlights":
        return _normalize_highlights(payload, context)
    if normalizer == "football.highlight_geo_restrictions":
        return _normalize_geo_restrictions(payload, context)
    raise ValueError(f"Unsupported Football normalizer: {normalizer}")
