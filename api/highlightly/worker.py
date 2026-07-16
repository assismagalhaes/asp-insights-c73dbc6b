from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
import time
from typing import Any, Mapping

from api.highlightly_client import HighlightlyClient, HighlightlyError, HighlightlyResponse
from api.highlightly_repository import HighlightlyRepository, HighlightlyRepositoryError

from .normalizers import normalize_baseball, normalize_basketball, normalize_football
from .normalizers.common import NormalizationContext, NormalizedBatch, schema_fingerprint, stable_id
from .normalizers.common import items as payload_items
from .registry import EndpointDefinition, EndpointRegistry


TABLE_ORDER = (
    "sports_countries",
    "sports_competitions",
    "sports_seasons",
    "sports_teams",
    "sports_players",
    "sports_bookmakers",
    "sports_matches",
    "sports_match_participants",
    "sports_match_period_scores",
    "sports_provider_entities",
    "hl_metric_definitions",
    "sports_market_definitions",
    "sports_lineups",
    "sports_lineup_players",
    "sports_match_team_stats",
    "sports_team_season_stats",
    "sports_player_stats",
    "sports_player_box_scores",
    "sports_match_events",
    "sports_standings_snapshots",
    "sports_highlights",
    "sports_odds_consensus",
)

_PAGINATION_INTERNAL_KEYS = frozenset(("_fanout", "_fanout_scope", "_shadow_scope"))


@dataclass(frozen=True)
class WorkerResult:
    status: str
    job_id: str | None = None
    run_id: str | None = None
    records_received: int = 0
    records_normalized: int = 0
    records_rejected: int = 0
    message: str | None = None


class WorkerDeferredError(RuntimeError):
    def __init__(self, message: str, *, retry_seconds: int):
        super().__init__(message)
        self.retry_seconds = retry_seconds


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().casefold() in {"1", "true", "yes", "on"}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _retention_until(policy: str, captured_at: datetime) -> str | None:
    for days in (365, 90, 30):
        if f"{days}d" in policy:
            return (captured_at + timedelta(days=days)).isoformat()
    return None


def _safe_error(exc: Exception) -> str:
    text = str(exc).replace("\r", " ").replace("\n", " ")
    return text[:1000]


class HighlightlyWorker:
    """One-job-at-a-time worker with raw-first, replayable persistence."""

    def __init__(
        self,
        client: HighlightlyClient,
        repository: HighlightlyRepository,
        *,
        worker_id: str,
        registry: EndpointRegistry | None = None,
        enabled: bool = False,
        daily_quota_ceiling: int | None = None,
    ):
        if not worker_id.strip():
            raise ValueError("worker_id must not be empty")
        self.client = client
        self.repository = repository
        self.worker_id = worker_id.strip()
        self.registry = registry or EndpointRegistry()
        self.enabled = enabled
        if daily_quota_ceiling is not None and not 1 <= daily_quota_ceiling <= self.registry.daily_limit:
            raise ValueError(
                f"daily_quota_ceiling must be between 1 and {self.registry.daily_limit}"
            )
        self.daily_quota_ceiling = daily_quota_ceiling

    @classmethod
    def from_environment(cls, *, worker_id: str) -> "HighlightlyWorker":
        api_key = os.environ.get("HIGHLIGHTLY_API_KEY", "")
        raw_quota_ceiling = os.environ.get("HIGHLIGHTLY_DAILY_QUOTA_CEILING", "").strip()
        return cls(
            HighlightlyClient(api_key, base_url=os.environ.get("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net")),
            HighlightlyRepository.from_environment(),
            worker_id=worker_id,
            enabled=_truthy(os.environ.get("HIGHLIGHTLY_ANALYSIS_ENABLED")),
            daily_quota_ceiling=int(raw_quota_ceiling) if raw_quota_ceiling else None,
        )

    def normalize_payload(
        self,
        payload: Any,
        *,
        operation: EndpointDefinition,
        provider_id: str,
        sport_id: str,
        request_params: Mapping[str, Any],
        raw_object_id: str,
        captured_at: str,
        bookmakers: list[Mapping[str, Any]],
    ) -> NormalizedBatch:
        bookmaker_ids: dict[str, str] = {}
        for bookmaker in bookmakers:
            identifier = str(bookmaker["id"])
            bookmaker_ids[str(bookmaker.get("normalized_name") or "").casefold()] = identifier
            bookmaker_ids[str(bookmaker.get("name") or "").strip().casefold().replace(" ", "-")] = identifier
        context = NormalizationContext(
            provider_id=provider_id,
            sport_id=sport_id,
            sport=operation.sport,
            endpoint_key=operation.key,
            normalizer=operation.normalizer,
            request_params=request_params,
            raw_object_id=raw_object_id,
            captured_at=captured_at,
            bookmaker_ids=bookmaker_ids,
        )
        if operation.sport == "football":
            return normalize_football(payload, context)
        if operation.sport == "baseball":
            return normalize_baseball(payload, context)
        if operation.sport == "basketball":
            return normalize_basketball(payload, context)
        raise ValueError(f"Normalizer runtime for {operation.sport} is not implemented")

    def _persist(self, batch: NormalizedBatch) -> int:
        persisted = 0
        known = set(TABLE_ORDER)
        unknown = set(batch.rows) - known
        if unknown:
            raise ValueError(f"Normalizer produced tables without an ordering rule: {sorted(unknown)}")
        for table in TABLE_ORDER:
            rows = batch.table_rows(table)
            if not rows:
                continue
            self.repository.upsert_rows(table, rows, on_conflict=batch.conflicts[table])
            persisted += len(rows)
        for patch in batch.patches:
            self.repository.patch_rows(patch.table, patch.values, filters=patch.filters)
            persisted += 1
        if batch.odds_quotes:
            self.repository.upsert_odds_quotes(batch.odds_quotes)
            persisted += len(batch.odds_quotes)
            match_ids = sorted({str(quote["p_match_id"]) for quote in batch.odds_quotes})
            for match_id in match_ids:
                persisted += self.repository.refresh_odds_consensus(
                    match_id,
                    snapshot_at=batch.odds_quotes[0].get("p_collected_at"),
                )
        return persisted

    def _enqueue_next_page(
        self,
        payload: Any,
        *,
        operation: EndpointDefinition,
        request_params: Mapping[str, Any],
    ) -> bool:
        if not operation.paginated or not isinstance(payload, Mapping):
            return False
        pagination = payload.get("pagination")
        if not isinstance(pagination, Mapping):
            return False
        try:
            offset = int(pagination.get("offset", 0))
            limit = int(pagination.get("limit", 0))
            total = int(pagination.get("totalCount", 0))
        except (TypeError, ValueError):
            return False
        next_offset = offset + limit
        if limit <= 0 or next_offset <= offset or next_offset >= total:
            return False
        next_params = {
            key: value
            for key, value in request_params.items()
            if (key in operation.parameter_names or key in _PAGINATION_INTERNAL_KEYS)
            and value is not None
        }
        next_params["offset"] = next_offset
        canonical = json.dumps(next_params, sort_keys=True, separators=(",", ":"), default=str)
        dedupe = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        scope = str(next_params.get("_fanout_scope") or "").strip()
        prefix = f"page:{scope}" if scope else "page"
        self.repository.enqueue_job(
            endpoint_key=operation.key,
            sport=operation.sport,
            resource=operation.resource,
            dedupe_key=f"{prefix}:{operation.key}:{dedupe}",
            request_params=next_params,
            priority=operation.priority,
        )
        return True

    def _enqueue_operation(self, endpoint_key: str, params: Mapping[str, Any], *, scope: str) -> None:
        endpoint_sport = endpoint_key.split(".", 1)[0]
        operation = self.registry.get(endpoint_key, sport=endpoint_sport)
        clean_params = {
            key: value
            for key, value in params.items()
            if (key in operation.parameter_names or key.startswith("_")) and value is not None
        }
        scope_parts = scope.split(":", 2)
        if len(scope_parts) == 3 and scope_parts[0] in {"match", "player"}:
            clean_params["_shadow_scope"] = scope_parts[2]
        canonical = json.dumps(clean_params, sort_keys=True, separators=(",", ":"), default=str)
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        self.repository.enqueue_job(
            endpoint_key=operation.key,
            sport=operation.sport,
            resource=operation.resource,
            dedupe_key=f"{scope}:{operation.key}:{digest}",
            request_params=clean_params,
            priority=operation.priority,
        )

    def _enqueue_football_match_fanout(self, payload: Any, *, scope_nonce: str = "") -> int:
        matches = payload_items(payload)
        if len(matches) > 10:
            raise ValueError("Shadow fan-out is limited to 10 matches per parent job")
        count = 0
        for match in matches:
            match_id = match.get("id")
            if match_id is None:
                continue
            match_scope = f"match:{match_id}:{scope_nonce}" if scope_nonce else f"match:{match_id}"
            detail_jobs = (
                ("football.FootballStatisticsController_getStatistics", {"matchId": match_id}),
                ("football.FootballLineupsController_getLineups", {"matchId": match_id}),
                ("football.FootballLiveEventsController_getLiveEvents", {"id": match_id}),
                ("football.FootballPlayerBoxScoreController_getPlayerBoxScores", {"matchId": match_id, "_fanout_players": True, "_fanout_scope": scope_nonce}),
                ("football.HighlightsController_getHighlights", {"matchId": match_id, "limit": 40, "offset": 0}),
                ("football.FootballOddsController_getOddsV2", {"matchId": match_id, "limit": 5, "offset": 0}),
            )
            for endpoint_key, params in detail_jobs:
                self._enqueue_operation(endpoint_key, params, scope=match_scope)
                count += 1

            home = match.get("homeTeam") if isinstance(match.get("homeTeam"), Mapping) else {}
            away = match.get("awayTeam") if isinstance(match.get("awayTeam"), Mapping) else {}
            if home.get("id") is not None and away.get("id") is not None:
                self._enqueue_operation(
                    "football.FootballHead2HeadController_getHead2HeadData",
                    {"teamIdOne": home["id"], "teamIdTwo": away["id"]},
                    scope=match_scope,
                )
                count += 1
            for team in (home, away):
                if team.get("id") is None:
                    continue
                self._enqueue_operation(
                    "football.FootballLastFiveGamesController_getLastFiveGames",
                    {"teamId": team["id"]},
                    scope=match_scope,
                )
                count += 1
                match_date = str(match.get("date") or "")[:10]
                try:
                    history_from = (datetime.fromisoformat(match_date) - timedelta(days=365)).date().isoformat()
                except ValueError:
                    history_from = match_date or None
                self._enqueue_operation(
                    "football.TeamsController_teamStatistics",
                    {"id": team["id"], "fromDate": history_from},
                    scope=match_scope,
                )
                count += 1
            league = match.get("league") if isinstance(match.get("league"), Mapping) else {}
            if league.get("id") is not None and league.get("season") is not None:
                self._enqueue_operation(
                    "football.FootballStandingsController_getStandings",
                    {"leagueId": league["id"], "season": league["season"]},
                    scope=match_scope,
                )
                count += 1
        return count

    def _enqueue_football_player_fanout(self, payload: Any, *, scope_nonce: str = "") -> int:
        player_ids: set[Any] = set()
        for team_block in payload_items(payload):
            for player in _as_list(team_block.get("players")):
                if isinstance(player, Mapping) and player.get("id") is not None:
                    player_ids.add(player["id"])
        if len(player_ids) > 100:
            raise ValueError("Player fan-out is limited to 100 players per box-score job")
        count = 0
        for player_id in sorted(player_ids, key=str):
            player_scope = f"player:{player_id}:{scope_nonce}" if scope_nonce else f"player:{player_id}"
            for endpoint_key in (
                "football.PlayersController_getPlayerSummaryById",
                "football.PlayersController_getPlayerStatisticsById",
            ):
                self._enqueue_operation(endpoint_key, {"id": player_id}, scope=player_scope)
                count += 1
        return count

    def _enqueue_baseball_match_fanout(self, payload: Any, *, scope_nonce: str = "") -> int:
        matches = payload_items(payload)
        if len(matches) > 10:
            raise ValueError("Shadow fan-out is limited to 10 matches per parent job")
        count = 0
        for match in matches:
            match_id = match.get("id")
            if match_id is None:
                continue
            match_scope = f"match:{match_id}:{scope_nonce}" if scope_nonce else f"match:{match_id}"
            detail_jobs = (
                ("baseball.BaseballMatchStatisticsController_getStatistics", {"id": match_id}),
                ("baseball.BaseballLineupsController_getLineups", {"matchId": match_id}),
                (
                    "baseball.BaseballBoxScoresController_getBoxScores",
                    {"id": match_id, "_fanout_players": True, "_fanout_scope": scope_nonce},
                ),
                ("baseball.HighlightsController_getHighlights", {"matchId": match_id, "limit": 40, "offset": 0}),
                ("baseball.BaseballOddsController_getOddsV2", {"matchId": match_id, "limit": 5, "offset": 0}),
            )
            for endpoint_key, params in detail_jobs:
                self._enqueue_operation(endpoint_key, params, scope=match_scope)
                count += 1

            home = match.get("homeTeam") if isinstance(match.get("homeTeam"), Mapping) else {}
            away = match.get("awayTeam") if isinstance(match.get("awayTeam"), Mapping) else {}
            if home.get("id") is not None and away.get("id") is not None:
                self._enqueue_operation(
                    "baseball.BaseballHead2HeadController_getHead2HeadData",
                    {"teamIdOne": home["id"], "teamIdTwo": away["id"]},
                    scope=match_scope,
                )
                count += 1
            match_date = str(match.get("date") or "")[:10]
            try:
                history_from = (datetime.fromisoformat(match_date) - timedelta(days=365)).date().isoformat()
            except ValueError:
                history_from = match_date or None
            for team in (home, away):
                if team.get("id") is None:
                    continue
                self._enqueue_operation(
                    "baseball.BaseballLastFiveGamesController_getLastFiveGames",
                    {"teamId": team["id"]},
                    scope=match_scope,
                )
                count += 1
                self._enqueue_operation(
                    "baseball.TeamController_getTeamStats",
                    {"id": team["id"], "fromDate": history_from},
                    scope=match_scope,
                )
                count += 1
            if match.get("league") and match.get("season") is not None:
                self._enqueue_operation(
                    "baseball.BaseballStandingsController_getStandings",
                    {
                        "leagueName": match["league"],
                        "year": match["season"],
                        "limit": 100,
                        "offset": 0,
                    },
                    scope=match_scope,
                )
                count += 1
        return count

    def _enqueue_baseball_player_fanout(self, payload: Any, *, scope_nonce: str = "") -> int:
        player_ids: set[Any] = set()
        for team_block in payload_items(payload):
            for box_score in _as_list(team_block.get("boxScores")):
                if not isinstance(box_score, Mapping):
                    continue
                player = box_score.get("player") if isinstance(box_score.get("player"), Mapping) else {}
                if player.get("id") is not None:
                    player_ids.add(player["id"])
        if len(player_ids) > 100:
            raise ValueError("Player fan-out is limited to 100 players per box-score job")
        count = 0
        for player_id in sorted(player_ids, key=str):
            player_scope = f"player:{player_id}:{scope_nonce}" if scope_nonce else f"player:{player_id}"
            for endpoint_key in (
                "baseball.BaseballPlayersController_getPlayerSummaryById",
                "baseball.BaseballPlayersController_getPlayerStatisticsById",
            ):
                self._enqueue_operation(endpoint_key, {"id": player_id}, scope=player_scope)
                count += 1
        return count

    def _enqueue_basketball_match_fanout(self, payload: Any, *, scope_nonce: str = "") -> int:
        matches = payload_items(payload)
        if len(matches) > 10:
            raise ValueError("Shadow fan-out is limited to 10 matches per parent job")
        count = 0
        for match in matches:
            match_id = match.get("id")
            if match_id is None:
                continue
            match_scope = f"match:{match_id}:{scope_nonce}" if scope_nonce else f"match:{match_id}"
            state = match.get("state") if isinstance(match.get("state"), Mapping) else {}
            score = state.get("score") if isinstance(state.get("score"), Mapping) else {}
            score_numbers = [int(value) for value in re.findall(r"\d+", str(score.get("current") or ""))[:2]]
            statistics_params: dict[str, Any] = {"matchId": match_id}
            if len(score_numbers) == 2:
                statistics_params.update({"_home_score": score_numbers[0], "_away_score": score_numbers[1]})
            home = match.get("homeTeam") if isinstance(match.get("homeTeam"), Mapping) else {}
            away = match.get("awayTeam") if isinstance(match.get("awayTeam"), Mapping) else {}
            if home.get("id") is not None and away.get("id") is not None:
                statistics_params.update({"_home_team_id": home["id"], "_away_team_id": away["id"]})
            detail_jobs = (
                ("basketball.BasketballStatisticsController_getStatistics", statistics_params),
                ("basketball.HighlightsController_getHighlights", {"matchId": match_id, "limit": 40, "offset": 0}),
                ("basketball.BasketballOddsController_getOddsV2", {"matchId": match_id, "limit": 5, "offset": 0}),
            )
            for endpoint_key, params in detail_jobs:
                self._enqueue_operation(endpoint_key, params, scope=match_scope)
                count += 1

            if home.get("id") is not None and away.get("id") is not None:
                self._enqueue_operation(
                    "basketball.BasketballHead2HeadController_getHead2HeadData",
                    {"teamIdOne": home["id"], "teamIdTwo": away["id"]},
                    scope=match_scope,
                )
                count += 1
            match_date = str(match.get("date") or "")[:10]
            try:
                history_from = (datetime.fromisoformat(match_date) - timedelta(days=365)).date().isoformat()
            except ValueError:
                history_from = match_date or None
            for team in (home, away):
                if team.get("id") is None:
                    continue
                self._enqueue_operation(
                    "basketball.BasketballLastFiveGamesController_getLastFiveGames",
                    {"teamId": team["id"]},
                    scope=match_scope,
                )
                count += 1
                self._enqueue_operation(
                    "basketball.TeamsController_getTeamStatistics",
                    {"id": team["id"], "fromDate": history_from},
                    scope=match_scope,
                )
                count += 1
            league = match.get("league") if isinstance(match.get("league"), Mapping) else {}
            if league.get("id") is not None and league.get("season") is not None:
                self._enqueue_operation(
                    "basketball.BasketballStandingsController_getStandings",
                    {"leagueId": league["id"], "season": league["season"]},
                    scope=match_scope,
                )
                count += 1
        return count

    def _quality_rows(
        self,
        batch: NormalizedBatch,
        *,
        job: Mapping[str, Any],
        run_id: str,
        raw_object_id: str,
    ) -> list[dict[str, Any]]:
        severity = {"high": "error", "warning": "warning", "info": "info", "critical": "critical"}
        rows: list[dict[str, Any]] = []
        for issue in batch.issues:
            rows.append(
                {
                    "id": stable_id("quality", raw_object_id, issue.get("code"), issue.get("context")),
                    "run_id": run_id,
                    "raw_object_id": raw_object_id,
                    "endpoint_key": job["endpoint_key"],
                    "sport": job["sport"],
                    "severity": severity.get(str(issue.get("severity")), "error"),
                    "issue_code": issue.get("code"),
                    "details": {"message": issue.get("message"), "context": issue.get("context") or {}},
                    "resolution_status": "open",
                }
            )
        return rows

    def _schema_drift_issue(
        self,
        *,
        endpoint_key: str,
        fingerprint: str,
        raw_object_id: str,
        run_id: str,
        sport: str,
    ) -> dict[str, Any] | None:
        previous = self.repository.select_rows(
            "hl_raw_objects",
            columns="id,schema_fingerprint",
            filters={"endpoint_key": endpoint_key},
            limit=2,
            order="created_at.desc",
        )
        prior = next((row for row in previous if row.get("id") != raw_object_id and row.get("schema_fingerprint")), None)
        if not prior or prior.get("schema_fingerprint") == fingerprint:
            return None
        return {
            "id": stable_id("schema-drift", raw_object_id, fingerprint),
            "run_id": run_id,
            "raw_object_id": raw_object_id,
            "endpoint_key": endpoint_key,
            "sport": sport,
            "severity": "warning",
            "issue_code": "SCHEMA_FINGERPRINT_CHANGED",
            "expected_value": {"fingerprint": prior["schema_fingerprint"]},
            "actual_value": {"fingerprint": fingerprint},
            "details": {"previous_raw_object_id": prior["id"]},
            "resolution_status": "open",
        }

    def run_once(self) -> WorkerResult:
        if not self.enabled:
            return WorkerResult(status="disabled", message="HIGHLIGHTLY_ANALYSIS_ENABLED is false")
        job = self.repository.claim_job(self.worker_id)
        if not job:
            return WorkerResult(status="idle")

        job_id = str(job["id"])
        run = self.repository.create_run(job_id, self.worker_id)
        run_id = str(run["id"])
        started = time.monotonic()
        response: HighlightlyResponse | None = None
        raw_object_id: str | None = None
        try:
            operation = self.registry.get(str(job["endpoint_key"]), sport=str(job["sport"]))
            request_params = job.get("request_params") if isinstance(job.get("request_params"), Mapping) else {}
            context = self.repository.ingestion_context(operation.sport)
            provider = context["provider"]
            sport = context["sport"]
            if provider.get("contract_version") != self.registry.contract_version:
                raise RuntimeError("Highlightly provider contract version differs from the frozen registry")
            if not provider.get("enabled"):
                raise WorkerDeferredError("Highlightly provider is disabled in sports_providers", retry_seconds=3600)

            captured = datetime.now(timezone.utc)
            reprocess_id = job.get("reprocess_raw_object_id")
            if reprocess_id:
                raw_rows = self.repository.select_rows("hl_raw_objects", filters={"id": reprocess_id}, limit=1)
                if not raw_rows:
                    raise ValueError(f"Raw object not found for replay: {reprocess_id}")
                raw_record = raw_rows[0]
                payload = self.repository.load_raw_payload(raw_record)
                raw_object_id = str(raw_record["id"])
            else:
                usage = self.repository.daily_request_usage(str(provider["id"]), captured.date().isoformat())
                default_ceiling = (
                    self.registry.daily_limit
                    if int(job.get("priority", 4)) == 0
                    else self.registry.daily_limit - self.registry.reserve
                )
                ceiling = (
                    min(default_ceiling, self.daily_quota_ceiling)
                    if self.daily_quota_ceiling is not None
                    else default_ceiling
                )
                if usage >= ceiling:
                    raise WorkerDeferredError(
                        f"Highlightly daily quota guard reached ({usage}/{ceiling})",
                        retry_seconds=3600,
                    )
                path, query = operation.request(request_params)
                response = self.client.get(path, query)
                payload = response.data
                raw = self.repository.store_raw_payload(
                    payload,
                    provider_id=str(provider["id"]),
                    sport_id=str(sport["id"]),
                    sport=operation.sport,
                    endpoint_key=operation.key,
                    job_id=job_id,
                    run_id=run_id,
                    request_metadata={"path": path, "params": query},
                    response_metadata={"status": response.status, "content_type": response.content_type},
                    retention_until=_retention_until(operation.raw_retention_class, captured),
                    captured_at=captured,
                )
                raw_object_id = raw.id
                self.repository.upsert_rows(
                    "hl_rate_limit_usage",
                    [{"run_id": run_id, "provider_id": provider["id"], "endpoint_key": operation.key, "requests_used": 1, "rate_limit": response.rate_limit, "rate_remaining": response.rate_remaining}],
                    on_conflict="id",
                )

            fingerprint = schema_fingerprint(payload)
            batch = self.normalize_payload(
                payload,
                operation=operation,
                provider_id=str(provider["id"]),
                sport_id=str(sport["id"]),
                request_params=request_params,
                raw_object_id=raw_object_id,
                captured_at=captured.isoformat(),
                bookmakers=context["bookmakers"],
            )
            persisted = self._persist(batch)
            quality_rows = self._quality_rows(batch, job=job, run_id=run_id, raw_object_id=raw_object_id)
            drift = self._schema_drift_issue(endpoint_key=operation.key, fingerprint=fingerprint, raw_object_id=raw_object_id, run_id=run_id, sport=operation.sport)
            if drift:
                quality_rows.append(drift)
            self.repository.record_quality_issues(quality_rows)
            self.repository.mark_raw_normalized(raw_object_id, schema_fingerprint=fingerprint)
            if not reprocess_id:
                self._enqueue_next_page(payload, operation=operation, request_params=request_params)
                if operation.normalizer == "football.matches" and _truthy(str(request_params.get("_fanout"))):
                    self._enqueue_football_match_fanout(
                        payload,
                        scope_nonce=str(request_params.get("_fanout_scope") or ""),
                    )
                if operation.normalizer == "football.box_scores" and _truthy(str(request_params.get("_fanout_players"))):
                    self._enqueue_football_player_fanout(
                        payload,
                        scope_nonce=str(request_params.get("_fanout_scope") or ""),
                    )
                if operation.normalizer == "baseball.matches" and _truthy(str(request_params.get("_fanout"))):
                    self._enqueue_baseball_match_fanout(
                        payload,
                        scope_nonce=str(request_params.get("_fanout_scope") or ""),
                    )
                if operation.normalizer == "baseball.box_scores" and _truthy(str(request_params.get("_fanout_players"))):
                    self._enqueue_baseball_player_fanout(
                        payload,
                        scope_nonce=str(request_params.get("_fanout_scope") or ""),
                    )
                if operation.normalizer == "basketball.matches" and _truthy(str(request_params.get("_fanout"))):
                    self._enqueue_basketball_match_fanout(
                        payload,
                        scope_nonce=str(request_params.get("_fanout_scope") or ""),
                    )

            duration = int((time.monotonic() - started) * 1000)
            run_status = "partial" if batch.rejected or any(row["severity"] == "critical" for row in quality_rows) else "succeeded"
            self.repository.finish_run(run_id, {"status": run_status, "http_status": response.status if response else None, "records_received": batch.received, "records_normalized": persisted, "records_rejected": batch.rejected, "duration_ms": duration, "rate_limit": response.rate_limit if response else None, "rate_remaining": response.rate_remaining if response else None})
            self.repository.finish_job(job_id, self.worker_id, "succeeded")
            return WorkerResult(status=run_status, job_id=job_id, run_id=run_id, records_received=batch.received, records_normalized=persisted, records_rejected=batch.rejected)
        except Exception as exc:
            duration = int((time.monotonic() - started) * 1000)
            retryable = isinstance(exc, (HighlightlyRepositoryError, OSError, WorkerDeferredError)) or (
                isinstance(exc, HighlightlyError) and (exc.status is None or exc.status == 429 or exc.status >= 500)
            )
            outcome = "retry" if retryable else "dead"
            message = _safe_error(exc)
            self.repository.finish_run(run_id, {"status": "failed", "http_status": getattr(exc, "status", None), "duration_ms": duration, "error_code": exc.__class__.__name__, "error_message": message})
            retry_delay = exc.retry_seconds if isinstance(exc, WorkerDeferredError) else 300
            self.repository.finish_job(job_id, self.worker_id, outcome, error=message, retry_delay_seconds=retry_delay)
            return WorkerResult(status=outcome, job_id=job_id, run_id=run_id, message=message)
