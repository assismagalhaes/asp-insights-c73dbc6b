from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping

from ..collection_policy import allows_canonical_odds, canonical_odds_rejection_reason

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
    "baseball.bookmakers",
    "baseball.box_scores",
    "baseball.head_to_head",
    "baseball.highlights",
    "baseball.highlight_geo_restrictions",
    "baseball.last_five_games",
    "baseball.lineups",
    "baseball.matches",
    "baseball.odds",
    "baseball.players",
    "baseball.player_statistics",
    "baseball.standings",
    "baseball.match_statistics",
    "baseball.teams",
    "baseball.team_statistics",
})


def _as_list(value: Any) -> list[Any]:
    """Treat nullable provider arrays as empty without accepting arbitrary iterables."""

    return value if isinstance(value, list) else []


def _external(value: Any, fallback: str) -> str:
    text = str(value if value is not None else "").strip()
    return text or fallback


def _bookmaker_token(value: Any) -> str:
    return _BOOKMAKER_TOKEN.sub("-", str(value or "").strip().casefold()).strip("-")


def _status(state: Any) -> str:
    description = str(state.get("description") if isinstance(state, Mapping) else state or "").casefold()
    if any(word in description for word in ("finished", "final", "completed", "awarded")):
        return "finished"
    if any(word in description for word in ("in progress", "inning", "live")):
        return "live"
    if any(word in description for word in ("break", "delayed", "interrupted", "suspended")):
        return "paused"
    if any(word in description for word in ("postponed", "announced")):
        return "postponed"
    if any(word in description for word in ("cancelled", "canceled", "abandoned")):
        return "cancelled"
    if any(word in description for word in ("not started", "scheduled")):
        return "scheduled"
    return "unknown"


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
            "metadata": {
                key: value for key, value in team.items()
                if key not in {"id", "name", "displayName", "fullName", "abbreviation", "type", "logo", "logoUrl"}
            },
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
    name = player.get("name") or player.get("fullName") or player.get("player")
    external_id = _external(player.get("id"), f"name:{team_id or 'none'}:{slug(name)}")
    player_id = stable_id(ctx.provider_id, ctx.sport_id, "player", external_id)
    position = player.get("position") or player.get("positionAbbreviation")
    batch.add(
        "sports_players",
        {
            "id": player_id,
            "sport_id": ctx.sport_id,
            "current_team_id": team_id,
            "name": str(name or external_id),
            "display_name": player.get("fullName") or player.get("displayName"),
            "first_name": player.get("firstName"),
            "last_name": player.get("lastName"),
            "position": position,
            "nationality": player.get("nationality"),
            "birth_date": player.get("dateOfBirth") or player.get("birthDate"),
            "image_url": player.get("logo") or player.get("image") or player.get("imageUrl"),
            "metadata": {
                key: value for key, value in player.items()
                if key not in {
                    "id", "name", "fullName", "player", "displayName", "firstName", "lastName",
                    "position", "positionAbbreviation", "nationality", "dateOfBirth", "birthDate",
                    "logo", "image", "imageUrl",
                }
            },
        },
    )
    add_provider_mapping(batch, ctx, "player", external_id, player_id, player)
    return player_id


def _ensure_competition(
    batch: NormalizedBatch,
    ctx: NormalizationContext,
    league: Any,
    season: Any = None,
    *,
    metadata: Mapping[str, Any] | None = None,
) -> tuple[str, str | None]:
    league_data = dict(league) if isinstance(league, Mapping) else {"name": league}
    name = league_data.get("name") or league_data.get("leagueName") or league_data.get("abbreviation") or "unknown"
    external_id = _external(league_data.get("id"), f"name:{slug(name)}")
    competition_id = stable_id(ctx.provider_id, ctx.sport_id, "competition", external_id)
    batch.add(
        "sports_competitions",
        {
            "id": competition_id,
            "sport_id": ctx.sport_id,
            "name": str(name),
            "short_name": league_data.get("abbreviation") or league_data.get("shortName"),
            "competition_type": league_data.get("leagueType") or league_data.get("type"),
            "logo_url": league_data.get("logo"),
            "metadata": {"provider": "highlightly", **dict(metadata or {})},
        },
    )
    add_provider_mapping(batch, ctx, "competition", external_id, competition_id, league_data)

    season_value = season if season is not None else league_data.get("season") or league_data.get("year")
    if season_value is None:
        return competition_id, None
    season_external = f"{external_id}:{season_value}"
    season_id = stable_id(ctx.provider_id, ctx.sport_id, "season", season_external)
    batch.add(
        "sports_seasons",
        {
            "id": season_id,
            "competition_id": competition_id,
            "label": str(season_value),
            "start_date": (metadata or {}).get("startDate"),
            "end_date": (metadata or {}).get("endDate"),
            "metadata": {"provider_season": season_value, **dict(metadata or {})},
        },
    )
    add_provider_mapping(batch, ctx, "season", season_external, season_id, {"season": season_value, "league": name})
    return competition_id, season_id


def _request_match_id(ctx: NormalizationContext) -> str:
    external = ctx.request_params.get("matchId") or ctx.request_params.get("id")
    if external is None:
        raise ValueError(f"{ctx.normalizer} requires matchId or id in request_params")
    return stable_id(ctx.provider_id, ctx.sport_id, "match", external)


def _add_match_statistics(
    batch: NormalizedBatch,
    records: list[Mapping[str, Any]],
    ctx: NormalizationContext,
    match_id: str,
) -> None:
    for record in records:
        team = record.get("team") if isinstance(record.get("team"), Mapping) else {}
        if not team:
            batch.rejected += 1
            continue
        team_id = _ensure_team(batch, ctx, team)
        for statistic in _as_list(team.get("statistics")):
            if not isinstance(statistic, Mapping) or statistic.get("value") is None:
                continue
            display = str(statistic.get("name") or statistic.get("displayName") or "unknown")
            group = str(statistic.get("group") or "")
            metric_id = add_metric_definition(
                batch,
                ctx,
                resource="match_statistics",
                provider_key=display,
                display_name=display,
                group_name=group,
                value=statistic["value"],
            )
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


def _normalize_matches(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    for match in records:
        external_id = match.get("id")
        if external_id is None:
            batch.rejected += 1
            batch.issue("MATCH_ID_MISSING", "Baseball match payload has no provider id.", context={"match": match})
            continue
        competition_id, season_id = _ensure_competition(batch, ctx, match.get("league"), match.get("season"))
        home = match.get("homeTeam") if isinstance(match.get("homeTeam"), Mapping) else {}
        away = match.get("awayTeam") if isinstance(match.get("awayTeam"), Mapping) else {}
        home_id = _ensure_team(batch, ctx, home) if home else None
        away_id = _ensure_team(batch, ctx, away) if away else None
        match_id = stable_id(ctx.provider_id, ctx.sport_id, "match", external_id)
        state = match.get("state") if isinstance(match.get("state"), Mapping) else {}
        score = state.get("score") if isinstance(state.get("score"), Mapping) else {}
        venue = match.get("venue") if isinstance(match.get("venue"), Mapping) else {}
        extra_state = {
            "state": state,
            "forecast": match.get("forecast"),
            "predictions": match.get("predictions"),
            "referees": match.get("referees"),
            "rosters": match.get("rosters"),
        }
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
                "venue_name": venue.get("name"),
                "venue_data": venue,
                "score_data": score,
                "state_data": extra_state,
            },
        )
        add_provider_mapping(batch, ctx, "match", external_id, match_id, match)
        for role, team_id in (("home", home_id), ("away", away_id)):
            if not team_id:
                continue
            side_score = score.get(role) if isinstance(score.get(role), Mapping) else {}
            batch.add(
                "sports_match_participants",
                {
                    "id": stable_id(match_id, "participant", role),
                    "match_id": match_id,
                    "team_id": team_id,
                    "role": role,
                    "score_data": side_score,
                },
            )
            innings = side_score.get("innings") if isinstance(side_score.get("innings"), list) else []
            for index, inning_score in enumerate(innings, start=1):
                if not isinstance(inning_score, (int, float)) or inning_score < 0:
                    continue
                batch.add(
                    "sports_match_period_scores",
                    {
                        "id": stable_id(match_id, team_id, "inning", index),
                        "match_id": match_id,
                        "team_id": team_id,
                        "period_key": f"inning_{index}",
                        "period_order": index,
                        "score": int(inning_score),
                    },
                )

        embedded_stats = [row for row in _as_list(match.get("stats")) if isinstance(row, Mapping)]
        _add_match_statistics(batch, embedded_stats, ctx, match_id)
        for index, play in enumerate(_as_list(match.get("plays"))):
            if not isinstance(play, Mapping):
                continue
            sequence = hashlib.sha256(json.dumps(play, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:24]
            batch.add(
                "sports_match_events",
                {
                    "id": stable_id(match_id, "play", sequence),
                    "match_id": match_id,
                    "sequence_key": f"{index:04d}:{sequence}",
                    "event_type": str(play.get("type") or play.get("playType") or "play"),
                    "period_key": str(play.get("inning") or play.get("period") or ""),
                    "clock_display": play.get("clock") or play.get("time"),
                    "source_raw_object_id": ctx.raw_object_id,
                    "metadata": dict(play),
                    "collected_at": ctx.captured_at,
                },
            )
    return batch


def _normalize_catalog(payload: Any, ctx: NormalizationContext, resource: str) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    for record in records:
        if resource == "teams":
            _ensure_team(batch, ctx, record)
        elif resource == "players":
            team = record.get("team") if isinstance(record.get("team"), Mapping) else {}
            _ensure_player(batch, ctx, record, team_id=_ensure_team(batch, ctx, team) if team else None)
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
    if "run line" in lowered or "spread" in lowered or "handicap" in lowered:
        return "run_line"
    if "total" in lowered or "over/under" in lowered:
        return "total"
    if "moneyline" in lowered or "home/away" in lowered or "result" in lowered:
        return "moneyline"
    return slug(name)


def _line_value(market: str, selection: str) -> tuple[str, float | None]:
    numbers = _LINE.findall(market)
    if not numbers:
        return "", None
    chosen = numbers[-1]
    if any(token in market.casefold() for token in ("run line", "spread", "handicap")) and len(numbers) >= 2:
        chosen = numbers[-2] if selection.casefold() == "home" else numbers[-1]
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
            batch.issue("ODDS_MATCH_ID_MISSING", "Baseball odds payload has no matchId.")
            continue
        match_id = stable_id(ctx.provider_id, ctx.sport_id, "match", match_external)
        markets = _as_list(record.get("odds"))
        quotes_before = len(batch.odds_quotes)
        rejection_reasons: list[str] = []
        for market in markets:
            if not isinstance(market, Mapping):
                continue
            bookmaker_name = str(market.get("bookmakerName") or market.get("bookmakerId") or "unknown")
            normalized_bookmaker = _bookmaker_token(bookmaker_name)
            market_name = str(market.get("market") or "unknown")
            odds_type = str(market.get("type") or "unknown").casefold()
            if odds_type not in {"prematch", "live"}:
                odds_type = "unknown"
            market_family = _market_family(market_name)
            rejection_reason = canonical_odds_rejection_reason(
                "baseball",
                normalized_bookmaker,
                market_family,
                odds_type,
            )
            if rejection_reason:
                rejection_reasons.append(rejection_reason)
            if not allows_canonical_odds("baseball", normalized_bookmaker, market_family, odds_type):
                continue
            bookmaker_id = ctx.bookmaker_ids.get(normalized_bookmaker)
            if not bookmaker_id:
                bookmaker_id = stable_id(ctx.provider_id, ctx.sport_id, "bookmaker", market.get("bookmakerId") or normalized_bookmaker)
                batch.add("sports_bookmakers", {"id": bookmaker_id, "name": bookmaker_name, "normalized_name": normalized_bookmaker, "is_active": True, "metadata": {"provider": "highlightly"}})
            add_provider_mapping(batch, ctx, "bookmaker", market.get("bookmakerId") or normalized_bookmaker, bookmaker_id, market)
            market_id = stable_id(ctx.provider_id, ctx.sport_id, "market", odds_type, market_name)
            batch.add(
                "sports_market_definitions",
                {
                    "id": market_id,
                    "provider_id": ctx.provider_id,
                    "sport_id": ctx.sport_id,
                    "provider_market_key": market_name,
                    "canonical_family": market_family,
                    "display_name": market_name,
                    "odds_type": odds_type,
                    "metadata": {"provider_type": market.get("type")},
                },
            )
            for selection in _as_list(market.get("values")):
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
                        "Baseball odds selection is missing a name or has an invalid decimal price.",
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
        if len(batch.odds_quotes) == quotes_before:
            if not markets:
                batch.issue(
                    "ODDS_PROVIDER_EMPTY",
                    "Provider returned no odds markets for the baseball match.",
                    severity="info",
                    context={"matchId": match_external},
                )
            elif rejection_reasons and all(
                reason == "bookmaker_missing" for reason in rejection_reasons
            ):
                batch.issue(
                    "ODDS_BOOKMAKER_MISSING",
                    "Provider returned no odds from the preferred bookmaker set.",
                    severity="info",
                    context={"matchId": match_external},
                )
            elif rejection_reasons:
                batch.issue(
                    "ODDS_MARKET_MISSING",
                    "Provider returned no supported prematch market from a preferred bookmaker.",
                    severity="info",
                    context={"matchId": match_external},
                )
    return batch


def _normalize_match_statistics(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    _add_match_statistics(batch, records, ctx, _request_match_id(ctx))
    return batch


def _normalize_lineups(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    documents = items(payload)
    batch = NormalizedBatch(received=len(documents))
    match_id = _request_match_id(ctx)
    for document in documents:
        for side in ("home", "away"):
            block = document.get(side) if isinstance(document.get(side), Mapping) else {}
            team = block.get("team") if isinstance(block.get("team"), Mapping) else {}
            if not team:
                continue
            team_id = _ensure_team(batch, ctx, team)
            players = [player for player in _as_list(block.get("lineup")) if isinstance(player, Mapping)]
            version = hashlib.sha256(json.dumps(block, sort_keys=True, default=str).encode("utf-8")).hexdigest()
            lineup_id = stable_id(match_id, team_id, "lineup", version)
            confirmed = any(player.get("isStarter") is True for player in players)
            batch.add(
                "sports_lineups",
                {
                    "id": lineup_id,
                    "match_id": match_id,
                    "team_id": team_id,
                    "version_key": version,
                    "is_confirmed": confirmed,
                    "published_at": ctx.captured_at,
                    "source_raw_object_id": ctx.raw_object_id,
                    "metadata": {"side": side, "confirmationStatus": "confirmed" if confirmed else "unconfirmed"},
                },
            )
            for order, player in enumerate(players):
                player_id = _ensure_player(batch, ctx, player, team_id=team_id)
                abbreviation = str(player.get("positionAbbreviation") or "").strip().upper()
                is_starter = player.get("isStarter") is True
                is_starting_pitcher = is_starter and abbreviation == "P"
                batch.add(
                    "sports_lineup_players",
                    {
                        "id": stable_id(lineup_id, player_id),
                        "lineup_id": lineup_id,
                        "player_id": player_id,
                        "role": "starter" if is_starter else "substitute",
                        "position": player.get("position") or player.get("positionAbbreviation"),
                        "shirt_number": player.get("jersey"),
                        "formation_order": order,
                        "metadata": {
                            "positionAbbreviation": player.get("positionAbbreviation"),
                            "isStartingPitcher": is_starting_pitcher,
                            "starterStatus": "confirmed" if is_starting_pitcher and confirmed else "unconfirmed",
                        },
                    },
                )
            if confirmed and not any(
                player.get("isStarter") is True and str(player.get("positionAbbreviation") or "").strip().upper() == "P"
                for player in players
            ):
                batch.issue(
                    "BASEBALL_STARTING_PITCHER_MISSING",
                    "Confirmed baseball lineup has no starting pitcher.",
                    severity="warning",
                    context={"matchId": ctx.request_params.get("matchId"), "teamId": team.get("id")},
                )
    return batch


def _normalize_team_stats(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    external_team = ctx.request_params.get("id")
    if external_team is None:
        raise ValueError("baseball.team_statistics requires id in request_params")
    team_id = stable_id(ctx.provider_id, ctx.sport_id, "team", external_team)
    for document in records:
        competition_id, season_id = _ensure_competition(batch, ctx, document.get("leagueName"), document.get("season"))
        round_name = str(document.get("round") or "all")
        for split in ("total", "home", "away"):
            for metric_key, value in flatten_metrics(document.get(split, {})):
                metric_id = add_metric_definition(batch, ctx, resource="team_statistics", group_name=split, provider_key=metric_key, value=value)
                batch.add(
                    "sports_team_season_stats",
                    {
                        "id": stable_id(team_id, competition_id, season_id, metric_id, round_name, split, ""),
                        "team_id": team_id,
                        "competition_id": competition_id,
                        "season_id": season_id,
                        "metric_definition_id": metric_id,
                        "scope_key": f"round:{slug(round_name)}",
                        "split_key": split,
                        **typed_value(value),
                        "source_raw_object_id": ctx.raw_object_id,
                        "collected_at": ctx.captured_at,
                    },
                )
    return batch


def _normalize_player_stats(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    for document in records:
        player_id = _ensure_player(batch, ctx, document)
        for season_block in _as_list(document.get("perSeason")):
            if not isinstance(season_block, Mapping):
                continue
            league = season_block.get("league") or "unknown"
            season = season_block.get("season")
            competition_id, season_id = _ensure_competition(batch, ctx, league, season)
            teams = [team for team in _as_list(season_block.get("teams")) if isinstance(team, Mapping)] or [None]
            scope = f"season:{slug(league)}:{slug(season)}:{slug(season_block.get('seasonBreakdown') or 'all')}"
            for team in teams:
                team_id = _ensure_team(batch, ctx, team) if team else None
                for statistic in _as_list(season_block.get("stats")):
                    if not isinstance(statistic, Mapping) or statistic.get("value") is None:
                        continue
                    display = str(statistic.get("name") or "unknown")
                    group = str(statistic.get("category") or "")
                    metric_id = add_metric_definition(
                        batch,
                        ctx,
                        resource="player_statistics",
                        provider_key=display,
                        display_name=display,
                        group_name=group,
                        value=statistic["value"],
                    )
                    batch.add(
                        "sports_player_stats",
                        {
                            "id": stable_id(player_id, team_id, competition_id, season_id, metric_id, scope),
                            "player_id": player_id,
                            "team_id": team_id,
                            "competition_id": competition_id,
                            "season_id": season_id,
                            "metric_definition_id": metric_id,
                            "scope_key": scope,
                            "split_key": "total",
                            **typed_value(statistic["value"]),
                            "source_raw_object_id": ctx.raw_object_id,
                            "collected_at": ctx.captured_at,
                        },
                    )
    return batch


def _normalize_box_scores(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    match_id = _request_match_id(ctx)
    for team_block in records:
        team = team_block.get("team") if isinstance(team_block.get("team"), Mapping) else {}
        if not team:
            batch.rejected += 1
            continue
        team_id = _ensure_team(batch, ctx, team)
        for item in _as_list(team_block.get("boxScores")):
            if not isinstance(item, Mapping):
                continue
            player = item.get("player") if isinstance(item.get("player"), Mapping) else {}
            player_id = _ensure_player(batch, ctx, player, team_id=team_id)
            for statistic in _as_list(item.get("statistics")):
                if not isinstance(statistic, Mapping) or statistic.get("value") is None:
                    continue
                display = str(statistic.get("name") or "unknown")
                group = str(statistic.get("group") or "")
                metric_id = add_metric_definition(
                    batch,
                    ctx,
                    resource="player_box_scores",
                    provider_key=display,
                    display_name=display,
                    group_name=group,
                    value=statistic["value"],
                )
                batch.add(
                    "sports_player_box_scores",
                    {
                        "id": stable_id(match_id, player_id, metric_id, ""),
                        "match_id": match_id,
                        "player_id": player_id,
                        "team_id": team_id,
                        "metric_definition_id": metric_id,
                        **typed_value(statistic["value"]),
                        "source_raw_object_id": ctx.raw_object_id,
                        "collected_at": ctx.captured_at,
                    },
                )
    return batch


def _number(stats: Mapping[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = stats.get(slug(key))
        if value is None:
            continue
        match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", "."))
        if match:
            return float(match.group())
    return None


def _normalize_standings(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    leagues = items(payload)
    batch = NormalizedBatch(received=sum(len(_as_list(row.get("data"))) for row in leagues))
    for league in leagues:
        competition_id, season_id = _ensure_competition(
            batch,
            ctx,
            {"name": league.get("leagueName"), "abbreviation": league.get("abbreviation"), "leagueType": league.get("leagueType")},
            league.get("year"),
            metadata={"startDate": league.get("startDate"), "endDate": league.get("endDate"), "seasonType": league.get("seasonType")},
        )
        if season_id is None:
            batch.issue("STANDINGS_SEASON_MISSING", "Baseball standings payload has no year.", context={"league": league.get("leagueName")})
            continue
        group_key = ":".join(filter(None, (str(league.get("leagueType") or ""), str(league.get("seasonType") or ""))))
        identities: list[str] = []
        for index, standing in enumerate(_as_list(league.get("data")), start=1):
            if not isinstance(standing, Mapping):
                continue
            team_id = _ensure_team(batch, ctx, standing)
            identities.append(team_id)
            stats: dict[str, Any] = {}
            raw_stats: list[dict[str, Any]] = []
            for statistic in _as_list(standing.get("stats")):
                if not isinstance(statistic, Mapping):
                    continue
                raw_stats.append(dict(statistic))
                value = statistic.get("displayValue")
                for name in (statistic.get("abbreviation"), statistic.get("description")):
                    if name:
                        stats[slug(name)] = value
            rank = _number(stats, "rank", "rk", "position") or index
            wins = _number(stats, "wins", "w")
            losses = _number(stats, "losses", "l")
            played = _number(stats, "games played", "games", "gp")
            if played is None and wins is not None and losses is not None:
                played = wins + losses
            scored = _number(stats, "runs scored", "runs for", "rs")
            conceded = _number(stats, "runs allowed", "runs against", "ra")
            batch.add(
                "sports_standings_snapshots",
                {
                    "id": stable_id(competition_id, season_id, group_key, ctx.captured_at, team_id),
                    "competition_id": competition_id,
                    "season_id": season_id,
                    "team_id": team_id,
                    "group_key": group_key,
                    "snapshot_at": ctx.captured_at,
                    "rank": int(rank),
                    "points": 0,
                    "played": int(played) if played is not None else None,
                    "wins": int(wins) if wins is not None else None,
                    "draws": 0,
                    "losses": int(losses) if losses is not None else None,
                    "scored": int(scored) if scored is not None else None,
                    "conceded": int(conceded) if conceded is not None else None,
                    "goal_difference": int(scored - conceded) if scored is not None and conceded is not None else None,
                    "split_data": {"stats": raw_stats},
                    "source_raw_object_id": ctx.raw_object_id,
                    "metadata": {"leagueType": league.get("leagueType"), "seasonType": league.get("seasonType")},
                },
            )
        if len(identities) > 1 and len(set(identities)) == 1:
            batch.issue(
                "STANDINGS_SINGLE_TEAM_REPEATED",
                "All baseball standings positions reference the same team.",
                severity="critical",
                context={"group": group_key, "entries": len(identities)},
            )
            for row in batch.rows.get("sports_standings_snapshots", {}).values():
                if row.get("group_key") == group_key:
                    row["quality_status"] = "quarantined"
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
        batch.add(
            "sports_highlights",
            {
                "id": stable_id(ctx.provider_id, ctx.sport_id, "highlight", external_id),
                "provider_id": ctx.provider_id,
                "sport_id": ctx.sport_id,
                "match_id": stable_id(ctx.provider_id, ctx.sport_id, "match", match_external) if match_external is not None else None,
                "external_id": str(external_id),
                "highlight_type": highlight.get("type"),
                "title": str(highlight.get("title") or f"Highlight {external_id}"),
                "description": highlight.get("description"),
                "source_name": highlight.get("source"),
                "channel_name": highlight.get("channel"),
                "category": highlight.get("category"),
                "preview_url": highlight.get("imgUrl"),
                "content_url": str(highlight.get("url") or highlight.get("embedUrl") or ""),
                "embed_url": highlight.get("embedUrl"),
                "source_raw_object_id": ctx.raw_object_id,
                "metadata": {"match": match},
            },
        )
    return batch


def _normalize_geo_restrictions(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    batch = NormalizedBatch(received=1)
    external_id = ctx.request_params.get("id")
    if external_id is None:
        raise ValueError("baseball.highlight_geo_restrictions requires id in request_params")
    batch.patches.append(
        TablePatch(
            "sports_highlights",
            {"provider_id": ctx.provider_id, "sport_id": ctx.sport_id, "external_id": str(external_id)},
            {"geo_restrictions": payload, "source_raw_object_id": ctx.raw_object_id},
        )
    )
    return batch


def normalize_baseball(payload: Any, context: NormalizationContext) -> NormalizedBatch:
    normalizer = context.normalizer
    if normalizer in {"baseball.matches", "baseball.head_to_head", "baseball.last_five_games"}:
        return _normalize_matches(payload, context)
    if normalizer in {"baseball.teams", "baseball.players", "baseball.bookmakers"}:
        return _normalize_catalog(payload, context, normalizer.split(".", 1)[1])
    if normalizer == "baseball.odds":
        return _normalize_odds(payload, context)
    if normalizer == "baseball.match_statistics":
        return _normalize_match_statistics(payload, context)
    if normalizer == "baseball.lineups":
        return _normalize_lineups(payload, context)
    if normalizer == "baseball.team_statistics":
        return _normalize_team_stats(payload, context)
    if normalizer == "baseball.player_statistics":
        return _normalize_player_stats(payload, context)
    if normalizer == "baseball.box_scores":
        return _normalize_box_scores(payload, context)
    if normalizer == "baseball.standings":
        return _normalize_standings(payload, context)
    if normalizer == "baseball.highlights":
        return _normalize_highlights(payload, context)
    if normalizer == "baseball.highlight_geo_restrictions":
        return _normalize_geo_restrictions(payload, context)
    raise ValueError(f"Unsupported Baseball normalizer: {normalizer}")
