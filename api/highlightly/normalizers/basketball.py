from __future__ import annotations

import re
from typing import Any, Mapping

from ..collection_policy import allows_canonical_odds, is_quarantined_basketball_standings

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
_PERIODS = (("q1", 1), ("q2", 2), ("q3", 3), ("q4", 4), ("overTime", 5))

_WNBA_TEAM_NAMES = {
    "atlanta": "Atlanta Dream W",
    "atlanta dream": "Atlanta Dream W",
    "chicago": "Chicago Sky W",
    "chicago sky": "Chicago Sky W",
    "connecticut": "Connecticut Sun W",
    "connecticut sun": "Connecticut Sun W",
    "dallas": "Dallas Wings W",
    "dallas wings": "Dallas Wings W",
    "golden state": "Golden State Valkyries W",
    "golden state valkyries": "Golden State Valkyries W",
    "indiana": "Indiana Fever W",
    "indiana fever": "Indiana Fever W",
    "las vegas": "Las Vegas Aces W",
    "las vegas aces": "Las Vegas Aces W",
    "los angeles": "Los Angeles Sparks W",
    "los angeles sparks": "Los Angeles Sparks W",
    "minnesota": "Minnesota Lynx W",
    "minnesota lynx": "Minnesota Lynx W",
    "new york": "New York Liberty W",
    "new york liberty": "New York Liberty W",
    "phoenix": "Phoenix Mercury W",
    "phoenix mercury": "Phoenix Mercury W",
    "portland": "Portland Fire W",
    "portland fire": "Portland Fire W",
    "seattle": "Seattle Storm W",
    "seattle storm": "Seattle Storm W",
    "toronto": "Toronto Tempo W",
    "toronto tempo": "Toronto Tempo W",
    "washington": "Washington Mystics W",
    "washington mystics": "Washington Mystics W",
}

SUPPORTED_NORMALIZERS = frozenset({
    "basketball.bookmakers",
    "basketball.countries",
    "basketball.head_to_head",
    "basketball.highlights",
    "basketball.highlight_geo_restrictions",
    "basketball.last_five_games",
    "basketball.leagues",
    "basketball.matches",
    "basketball.odds",
    "basketball.standings",
    "basketball.match_statistics",
    "basketball.teams",
    "basketball.team_statistics",
})


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _external(value: Any, fallback: str) -> str:
    text = str(value if value is not None else "").strip()
    return text or fallback


def _bookmaker_token(value: Any) -> str:
    return _BOOKMAKER_TOKEN.sub("-", str(value or "").strip().casefold()).strip("-")


def _canonical_competition_name(value: Any) -> str:
    name = str(value or "unknown").strip()
    return "WNBA" if name.casefold() in {"nba women", "wnba"} else name


def _canonical_team_display_name(value: Any) -> str:
    name = str(value or "").strip()
    base_name = re.sub(r"\s+(?:women|woman|w)$", "", name, flags=re.IGNORECASE).strip()
    return _WNBA_TEAM_NAMES.get(base_name.casefold(), name)


def _status(state: Any) -> str:
    description = str(state.get("description") if isinstance(state, Mapping) else state or "").casefold()
    if any(word in description for word in ("finished", "final", "completed", "awarded")):
        return "finished"
    if any(word in description for word in ("in progress", "quarter", "overtime", "live")):
        return "live"
    if any(word in description for word in ("break", "half time", "delayed", "interrupted", "suspended")):
        return "paused"
    if any(word in description for word in ("postponed", "announced")):
        return "postponed"
    if any(word in description for word in ("cancelled", "canceled", "abandoned")):
        return "cancelled"
    if any(word in description for word in ("not started", "scheduled")):
        return "scheduled"
    return "unknown"


def _ensure_country(batch: NormalizedBatch, ctx: NormalizationContext, country: Mapping[str, Any]) -> str:
    code = _external(country.get("code"), slug(country.get("name"))).upper()
    country_id = stable_id("country", code)
    batch.add("sports_countries", {
        "id": country_id,
        "code": code,
        "name": str(country.get("name") or code),
        "flag_url": country.get("logo") or country.get("flagUrl"),
        "metadata": {"provider": "highlightly"},
    })
    add_provider_mapping(batch, ctx, "country", code, country_id, country)
    return country_id


def _ensure_team(batch: NormalizedBatch, ctx: NormalizationContext, team: Mapping[str, Any]) -> str:
    external_id = _external(team.get("id"), f"name:{slug(team.get('name'))}")
    team_id = stable_id(ctx.provider_id, ctx.sport_id, "team", external_id)
    raw_name = str(team.get("name") or external_id)
    display_name = _canonical_team_display_name(
        team.get("displayName") or team.get("fullName") or raw_name
    )
    batch.add("sports_teams", {
        "id": team_id,
        "sport_id": ctx.sport_id,
        "name": raw_name,
        "display_name": display_name,
        "abbreviation": team.get("abbreviation"),
        "team_type": team.get("type"),
        "logo_url": team.get("logo") or team.get("logoUrl"),
        "metadata": {
            key: value for key, value in team.items()
            if key not in {"id", "name", "displayName", "fullName", "abbreviation", "type", "logo", "logoUrl"}
        },
    })
    add_provider_mapping(batch, ctx, "team", external_id, team_id, team)
    return team_id


def _ensure_competition(
    batch: NormalizedBatch,
    ctx: NormalizationContext,
    league: Any,
    season: Any = None,
    *,
    country_id: str | None = None,
) -> tuple[str, str | None]:
    league_data = dict(league) if isinstance(league, Mapping) else {"name": league}
    provider_name = league_data.get("name") or league_data.get("leagueName") or "unknown"
    name = _canonical_competition_name(provider_name)
    external_id = _external(league_data.get("id"), f"name:{slug(provider_name)}")
    competition_id = stable_id(ctx.provider_id, ctx.sport_id, "competition", external_id)
    competition_row = {
        "id": competition_id,
        "sport_id": ctx.sport_id,
        "name": str(name),
        "short_name": "WNBA" if name == "WNBA" else league_data.get("shortName") or league_data.get("abbreviation"),
        "competition_type": league_data.get("type"),
        "logo_url": league_data.get("logo"),
        "metadata": {"provider": "highlightly", "provider_name": provider_name},
    }
    if country_id is not None:
        competition_row["country_id"] = country_id
    batch.add("sports_competitions", competition_row)
    add_provider_mapping(batch, ctx, "competition", external_id, competition_id, league_data)
    season_value = season if season is not None else league_data.get("season")
    if season_value is None:
        return competition_id, None
    season_external = f"{external_id}:{season_value}"
    season_id = stable_id(ctx.provider_id, ctx.sport_id, "season", season_external)
    batch.add("sports_seasons", {
        "id": season_id,
        "competition_id": competition_id,
        "label": str(season_value),
        "metadata": {"provider_season": season_value},
    })
    add_provider_mapping(batch, ctx, "season", season_external, season_id, {"season": season_value, "league": name})
    return competition_id, season_id


def _score_pair(value: Any) -> tuple[int | None, int | None]:
    numbers = re.findall(r"\d+", str(value or ""))
    if len(numbers) < 2:
        return None, None
    return int(numbers[0]), int(numbers[1])


def _request_match_id(ctx: NormalizationContext) -> str:
    external = ctx.request_params.get("matchId") or ctx.request_params.get("id")
    if external is None:
        raise ValueError(f"{ctx.normalizer} requires matchId or id in request_params")
    return stable_id(ctx.provider_id, ctx.sport_id, "match", external)


def _metric_number(statistics: list[Mapping[str, Any]], name: str) -> float | None:
    target = slug(name)
    for statistic in statistics:
        if slug(statistic.get("displayName") or statistic.get("name")) != target:
            continue
        value = statistic.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return None


def _add_fact(
    batch: NormalizedBatch,
    ctx: NormalizationContext,
    match_id: str,
    team_id: str,
    *,
    resource: str,
    group: str,
    provider_key: str,
    display_name: str,
    value: Any,
) -> None:
    metric_id = add_metric_definition(
        batch,
        ctx,
        resource=resource,
        provider_key=provider_key,
        display_name=display_name,
        group_name=group,
        value=value,
    )
    batch.add("sports_match_team_stats", {
        "id": stable_id(match_id, team_id, metric_id, "", ""),
        "match_id": match_id,
        "team_id": team_id,
        "metric_definition_id": metric_id,
        **typed_value(value),
        "source_raw_object_id": ctx.raw_object_id,
        "collected_at": ctx.captured_at,
    })


def _add_match_statistics(
    batch: NormalizedBatch,
    records: list[Mapping[str, Any]],
    ctx: NormalizationContext,
    match_id: str,
    *,
    home_score: int | None = None,
    away_score: int | None = None,
) -> None:
    prepared: list[tuple[str, str, list[Mapping[str, Any]]]] = []
    for record in records:
        team = record.get("team") if isinstance(record.get("team"), Mapping) else {}
        if not team:
            batch.rejected += 1
            continue
        team_id = _ensure_team(batch, ctx, team)
        statistics = [stat for stat in _as_list(record.get("statistics")) if isinstance(stat, Mapping)]
        prepared.append((str(team.get("id") or ""), team_id, statistics))
        for statistic in statistics:
            if statistic.get("value") is None:
                continue
            display = str(statistic.get("displayName") or statistic.get("name") or "unknown")
            _add_fact(
                batch, ctx, match_id, team_id,
                resource="match_statistics", group="Raw", provider_key=display,
                display_name=display, value=statistic["value"],
            )

    if len(prepared) != 2 or home_score is None or away_score is None:
        return
    possession_estimates: list[float | None] = []
    for _, _, statistics in prepared:
        fga = _metric_number(statistics, "Field Goals")
        orb = _metric_number(statistics, "Offensive Rebounds")
        tov = _metric_number(statistics, "Turnovers")
        fta = _metric_number(statistics, "Free Throws")
        possession_estimates.append(
            fga - orb + tov + 0.44 * fta
            if None not in (fga, orb, tov, fta) else None
        )
    if any(value is None or value <= 0 for value in possession_estimates):
        batch.issue(
            "BASKETBALL_DERIVED_METRICS_INPUT_MISSING",
            "Basketball efficiency metrics require FGA, ORB, TOV and FTA for both teams.",
            severity="warning",
            context={"matchId": ctx.request_params.get("matchId") or ctx.request_params.get("id")},
        )
        return
    pace = (float(possession_estimates[0]) + float(possession_estimates[1])) / 2
    home_external = str(ctx.request_params.get("_home_team_id") or "")
    away_external = str(ctx.request_params.get("_away_team_id") or "")
    scores_by_team = {home_external: float(home_score), away_external: float(away_score)}
    fallback_scores = (float(home_score), float(away_score))
    for index, (external_team_id, team_id, statistics) in enumerate(prepared):
        fgm = _metric_number(statistics, "Succesful Field Goals")
        fga = _metric_number(statistics, "Field Goals")
        three_pm = _metric_number(statistics, "Succesful 3 Pointers")
        fta = _metric_number(statistics, "Free Throws")
        points = scores_by_team.get(external_team_id, fallback_scores[index])
        opponent_points = float(home_score + away_score) - points
        if None in (fgm, fga, three_pm, fta) or not fga or (fga + 0.44 * fta) <= 0:
            continue
        derived = {
            "pace": ("Pace", pace),
            "offensive_rating": ("Offensive Rating", points / pace * 100),
            "defensive_rating": ("Defensive Rating", opponent_points / pace * 100),
            "effective_field_goal_percentage": ("Effective Field Goal %", (fgm + 0.5 * three_pm) / fga * 100),
            "true_shooting_percentage": ("True Shooting %", points / (2 * (fga + 0.44 * fta)) * 100),
            "net_rating": ("Net Rating", (points - opponent_points) / pace * 100),
        }
        for key, (display, value) in derived.items():
            _add_fact(
                batch, ctx, match_id, team_id,
                resource="match_statistics_derived", group="Efficiency",
                provider_key=key, display_name=display, value=round(value, 6),
            )


def _normalize_matches(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    for match in records:
        external_id = match.get("id")
        if external_id is None:
            batch.rejected += 1
            batch.issue("MATCH_ID_MISSING", "Basketball match payload has no provider id.", context={"match": match})
            continue
        home = match.get("homeTeam") if isinstance(match.get("homeTeam"), Mapping) else {}
        away = match.get("awayTeam") if isinstance(match.get("awayTeam"), Mapping) else {}
        home_external = _external(home.get("id"), f"name:{slug(home.get('name'))}") if home else None
        away_external = _external(away.get("id"), f"name:{slug(away.get('name'))}") if away else None
        if home_external and away_external and home_external == away_external:
            batch.rejected += 1
            batch.issue(
                "BASKETBALL_MATCH_PARTICIPANT_IDENTITY_COLLISION",
                "Basketball match maps home and away to the same provider team and was not persisted.",
                context={
                    "matchId": external_id,
                    "homeTeamId": home.get("id"),
                    "homeTeamName": home.get("name"),
                    "awayTeamId": away.get("id"),
                    "awayTeamName": away.get("name"),
                },
            )
            continue
        country = match.get("country") if isinstance(match.get("country"), Mapping) else {}
        country_id = _ensure_country(batch, ctx, country) if country else None
        league = match.get("league") if isinstance(match.get("league"), Mapping) else {"name": match.get("league")}
        competition_id, season_id = _ensure_competition(
            batch, ctx, league, match.get("season"), country_id=country_id
        )
        home_id = _ensure_team(batch, ctx, home) if home else None
        away_id = _ensure_team(batch, ctx, away) if away else None
        match_id = stable_id(ctx.provider_id, ctx.sport_id, "match", external_id)
        state = match.get("state") if isinstance(match.get("state"), Mapping) else {}
        score = state.get("score") if isinstance(state.get("score"), Mapping) else {}
        home_score, away_score = _score_pair(score.get("current"))
        batch.add("sports_matches", {
            "id": match_id,
            "sport_id": ctx.sport_id,
            "competition_id": competition_id,
            "season_id": season_id,
            "kickoff_at": match.get("date"),
            "status": _status(state),
            "provider_status": state.get("description"),
            "round_name": match.get("week") or match.get("stage"),
            "score_data": score,
            "state_data": {"state": state, "week": match.get("week"), "stage": match.get("stage")},
        })
        add_provider_mapping(batch, ctx, "match", external_id, match_id, match)
        periods: dict[str, tuple[int | None, int | None]] = {
            key: _score_pair(score.get(key)) for key, _ in _PERIODS
        }
        for role, team_id, final_score, side_index in (
            ("home", home_id, home_score, 0), ("away", away_id, away_score, 1)
        ):
            if not team_id:
                continue
            side_periods = {
                key: pair[side_index] for key, pair in periods.items() if pair[side_index] is not None
            }
            batch.add("sports_match_participants", {
                "id": stable_id(match_id, "participant", role),
                "match_id": match_id,
                "team_id": team_id,
                "role": role,
                "score_data": {"current": final_score, "periods": side_periods},
            })
            for period_key, period_order in _PERIODS:
                period_score = periods[period_key][side_index]
                if period_score is None:
                    continue
                batch.add("sports_match_period_scores", {
                    "id": stable_id(match_id, team_id, period_key),
                    "match_id": match_id,
                    "team_id": team_id,
                    "period_key": period_key,
                    "period_order": period_order,
                    "score": period_score,
                })
        embedded = match.get("statistics") if isinstance(match.get("statistics"), list) else match.get("stats")
        embedded_stats = [row for row in _as_list(embedded) if isinstance(row, Mapping)]
        if embedded_stats:
            _add_match_statistics(
                batch, embedded_stats, ctx, match_id,
                home_score=home_score, away_score=away_score,
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
        elif resource == "leagues":
            country = record.get("country") if isinstance(record.get("country"), Mapping) else {}
            competition_id, _ = _ensure_competition(
                batch, ctx, record, country_id=_ensure_country(batch, ctx, country) if country else None
            )
            for season in _as_list(record.get("seasons")):
                if not isinstance(season, Mapping) or season.get("season") is None:
                    continue
                season_external = f"{record.get('id')}:{season['season']}"
                season_id = stable_id(ctx.provider_id, ctx.sport_id, "season", season_external)
                batch.add("sports_seasons", {
                    "id": season_id, "competition_id": competition_id,
                    "label": str(season["season"]), "metadata": dict(season),
                })
                add_provider_mapping(batch, ctx, "season", season_external, season_id, season)
        elif resource == "bookmakers":
            name = str(record.get("name") or record.get("id") or "unknown")
            normalized = _bookmaker_token(name)
            bookmaker_id = ctx.bookmaker_ids.get(normalized)
            if not bookmaker_id:
                bookmaker_id = stable_id(ctx.provider_id, ctx.sport_id, "bookmaker", record.get("id") or normalized)
                batch.add("sports_bookmakers", {
                    "id": bookmaker_id, "name": name, "normalized_name": normalized,
                    "is_active": True, "metadata": {"provider": "highlightly"},
                })
            add_provider_mapping(batch, ctx, "bookmaker", record.get("id") or normalized, bookmaker_id, record)
    return batch


def _market_family(name: str) -> str:
    lowered = name.casefold()
    if "spread" in lowered or "handicap" in lowered:
        return "spread"
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
    if any(token in market.casefold() for token in ("spread", "handicap")) and len(numbers) >= 2:
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
            batch.issue("ODDS_MATCH_ID_MISSING", "Basketball odds payload has no matchId.")
            continue
        match_id = stable_id(ctx.provider_id, ctx.sport_id, "match", match_external)
        for market in _as_list(record.get("odds")):
            if not isinstance(market, Mapping):
                continue
            bookmaker_name = str(market.get("bookmakerName") or market.get("bookmakerId") or "unknown")
            normalized_bookmaker = _bookmaker_token(bookmaker_name)
            market_name = str(market.get("market") or "unknown")
            odds_type = str(market.get("type") or "unknown").casefold()
            if odds_type not in {"prematch", "live"}:
                odds_type = "unknown"
            market_family = _market_family(market_name)
            if not allows_canonical_odds("basketball", normalized_bookmaker, market_family, odds_type):
                continue
            bookmaker_id = ctx.bookmaker_ids.get(normalized_bookmaker)
            if not bookmaker_id:
                bookmaker_id = stable_id(ctx.provider_id, ctx.sport_id, "bookmaker", market.get("bookmakerId") or normalized_bookmaker)
                batch.add("sports_bookmakers", {
                    "id": bookmaker_id, "name": bookmaker_name, "normalized_name": normalized_bookmaker,
                    "is_active": True, "metadata": {"provider": "highlightly"},
                })
            add_provider_mapping(batch, ctx, "bookmaker", market.get("bookmakerId") or normalized_bookmaker, bookmaker_id, market)
            market_id = stable_id(ctx.provider_id, ctx.sport_id, "market", odds_type, market_name)
            batch.add("sports_market_definitions", {
                "id": market_id,
                "provider_id": ctx.provider_id,
                "sport_id": ctx.sport_id,
                "provider_market_key": market_name,
                "canonical_family": market_family,
                "display_name": market_name,
                "odds_type": odds_type,
                "metadata": {"provider_type": market.get("type")},
            })
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
                    batch.issue("ODDS_QUOTE_INVALID", "Basketball odds selection is invalid.", context={"market": market_name, "selection": selection_name})
                    continue
                line_key, line_value = _line_value(market_name, selection_name)
                batch.odds_quotes.append({
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
                })
    return batch


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_standings(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    documents = items(payload)
    total_rows = sum(
        len(_as_list(group.get("standings")))
        for document in documents
        for group in _as_list(document.get("groups"))
        if isinstance(group, Mapping)
    )
    batch = NormalizedBatch(received=total_rows)
    for document in documents:
        league = document.get("league") if isinstance(document.get("league"), Mapping) else {}
        groups = [group for group in _as_list(document.get("groups")) if isinstance(group, Mapping)]
        rows = [
            standing for group in groups
            for standing in _as_list(group.get("standings"))
            if isinstance(standing, Mapping)
        ]
        identities = [
            str((standing.get("team") or {}).get("id") or slug((standing.get("team") or {}).get("name")))
            for standing in rows
        ]
        requested_league = ctx.request_params.get("leagueId")
        requested_season = ctx.request_params.get("season")
        contract_mismatch = (
            requested_league is not None and str(league.get("id")) != str(requested_league)
        ) or (
            requested_season is not None and str(league.get("season")) != str(requested_season)
        )
        duplicate_groups = any(
            len(group_ids) != len(set(group_ids))
            for group in groups
            if (group_ids := [
                str((standing.get("team") or {}).get("id") or slug((standing.get("team") or {}).get("name")))
                for standing in _as_list(group.get("standings")) if isinstance(standing, Mapping)
            ])
        )
        repeated_identity = len(identities) > 1 and len(set(identities)) < 2
        if contract_mismatch or duplicate_groups or repeated_identity:
            batch.rejected += len(rows)
            batch.issue(
                "BASKETBALL_STANDINGS_CORRUPTED",
                "Basketball standings failed identity or league integrity checks and were not persisted.",
                severity="critical",
                context={
                    "leagueId": league.get("id"), "season": league.get("season"),
                    "requestedLeagueId": requested_league, "requestedSeason": requested_season,
                    "rows": len(rows), "distinctTeams": len(set(identities)),
                    "duplicateWithinGroup": duplicate_groups,
                },
            )
            continue
        if is_quarantined_basketball_standings(
            league,
            requested_league_id=requested_league,
        ):
            batch.rejected += len(rows)
            batch.issue(
                "BASKETBALL_STANDINGS_PROVIDER_QUARANTINED",
                "Highlightly WNBA standings are quarantined after recurrent identity corruption.",
                severity="critical",
                context={
                    "leagueId": league.get("id"),
                    "season": league.get("season"),
                    "rows": len(rows),
                    "policy": "provider_standings_quarantined",
                },
            )
            continue
        country = league.get("country") if isinstance(league.get("country"), Mapping) else {}
        competition_id, season_id = _ensure_competition(
            batch, ctx, league, league.get("season"),
            country_id=_ensure_country(batch, ctx, country) if country else None,
        )
        if season_id is None:
            batch.rejected += len(rows)
            batch.issue("STANDINGS_SEASON_MISSING", "Basketball standings payload has no season.")
            continue
        for group in groups:
            group_key = str(group.get("name") or "overall")
            positions: set[int] = set()
            for standing in _as_list(group.get("standings")):
                if not isinstance(standing, Mapping):
                    continue
                team = standing.get("team") if isinstance(standing.get("team"), Mapping) else {}
                rank = _optional_int(standing.get("position"))
                wins = _optional_int(standing.get("wins"))
                losses = _optional_int(standing.get("loses"))
                played = _optional_int(standing.get("gamesPlayed"))
                scored = _optional_int(standing.get("scoredPoints"))
                conceded = _optional_int(standing.get("receivedPoints"))
                if not team or rank is None or rank < 1 or rank in positions or (
                    None not in (wins, losses, played) and wins + losses != played
                ):
                    batch.rejected += 1
                    batch.issue(
                        "BASKETBALL_STANDINGS_ROW_INVALID",
                        "Basketball standings row failed rank or win/loss checks.",
                        context={"group": group_key, "position": rank, "team": team.get("id")},
                    )
                    continue
                positions.add(rank)
                team_id = _ensure_team(batch, ctx, team)
                batch.add("sports_standings_snapshots", {
                    "id": stable_id(competition_id, season_id, group_key, ctx.captured_at, team_id),
                    "competition_id": competition_id,
                    "season_id": season_id,
                    "team_id": team_id,
                    "group_key": group_key,
                    "snapshot_at": ctx.captured_at,
                    "rank": rank,
                    "points": 0,
                    "played": played,
                    "wins": wins,
                    "draws": 0,
                    "losses": losses,
                    "scored": scored,
                    "conceded": conceded,
                    "goal_difference": scored - conceded if scored is not None and conceded is not None else None,
                    "split_data": {"provider": dict(standing)},
                    "source_raw_object_id": ctx.raw_object_id,
                    "quality_status": "valid",
                    "metadata": {"sportMeaning": {"scored": "points_for", "conceded": "points_against"}},
                })
    return batch


def _normalize_match_statistics(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    home_score = _optional_int(ctx.request_params.get("_home_score"))
    away_score = _optional_int(ctx.request_params.get("_away_score"))
    _add_match_statistics(
        batch, records, ctx, _request_match_id(ctx),
        home_score=home_score, away_score=away_score,
    )
    return batch


def _normalize_team_statistics(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    records = items(payload)
    batch = NormalizedBatch(received=len(records))
    external_team = ctx.request_params.get("id")
    if external_team is None:
        raise ValueError("basketball.team_statistics requires id in request_params")
    team_id = stable_id(ctx.provider_id, ctx.sport_id, "team", external_team)
    for document in records:
        competition_id, season_id = _ensure_competition(
            batch, ctx,
            {"id": document.get("leagueId"), "name": document.get("leagueName")},
            document.get("season"),
        )
        scope_key = f"season:{slug(document.get('season') or 'all')}"
        for split in ("total", "home", "away"):
            for metric_key, value in flatten_metrics(document.get(split, {})):
                metric_id = add_metric_definition(
                    batch, ctx, resource="team_statistics", group_name=split,
                    provider_key=metric_key, value=value,
                )
                batch.add("sports_team_season_stats", {
                    "id": stable_id(team_id, competition_id, season_id, metric_id, scope_key, split, ""),
                    "team_id": team_id,
                    "competition_id": competition_id,
                    "season_id": season_id,
                    "metric_definition_id": metric_id,
                    "scope_key": scope_key,
                    "split_key": split,
                    "window_from": ctx.request_params.get("fromDate"),
                    **typed_value(value),
                    "source_raw_object_id": ctx.raw_object_id,
                    "collected_at": ctx.captured_at,
                })
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
        batch.add("sports_highlights", {
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
            "thumbnail_url": highlight.get("imgUrl"),
            "content_url": str(highlight.get("url") or highlight.get("embedUrl") or ""),
            "embed_url": highlight.get("embedUrl"),
            "duration_seconds": highlight.get("durationSeconds"),
            "published_at": highlight.get("publishedAt") or ctx.captured_at,
            "source_raw_object_id": ctx.raw_object_id,
            "metadata": {"match": match},
        })
    return batch


def _normalize_geo_restrictions(payload: Any, ctx: NormalizationContext) -> NormalizedBatch:
    batch = NormalizedBatch(received=1)
    external_id = ctx.request_params.get("id")
    if external_id is None:
        raise ValueError("basketball.highlight_geo_restrictions requires id in request_params")
    batch.patches.append(TablePatch(
        "sports_highlights",
        {"provider_id": ctx.provider_id, "sport_id": ctx.sport_id, "external_id": str(external_id)},
        {"geo_restrictions": payload, "source_raw_object_id": ctx.raw_object_id},
    ))
    return batch


def normalize_basketball(payload: Any, context: NormalizationContext) -> NormalizedBatch:
    normalizer = context.normalizer
    if normalizer in {"basketball.matches", "basketball.head_to_head", "basketball.last_five_games"}:
        return _normalize_matches(payload, context)
    if normalizer in {"basketball.countries", "basketball.leagues", "basketball.teams", "basketball.bookmakers"}:
        return _normalize_catalog(payload, context, normalizer.split(".", 1)[1])
    if normalizer == "basketball.odds":
        return _normalize_odds(payload, context)
    if normalizer == "basketball.standings":
        return _normalize_standings(payload, context)
    if normalizer == "basketball.match_statistics":
        return _normalize_match_statistics(payload, context)
    if normalizer == "basketball.team_statistics":
        return _normalize_team_statistics(payload, context)
    if normalizer == "basketball.highlights":
        return _normalize_highlights(payload, context)
    if normalizer == "basketball.highlight_geo_restrictions":
        return _normalize_geo_restrictions(payload, context)
    raise ValueError(f"Unsupported Basketball normalizer: {normalizer}")
