from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from api.highlightly.normalizers.common import NormalizationContext, NormalizedBatch, schema_fingerprint, stable_id
from api.highlightly.normalizers.football import SUPPORTED_NORMALIZERS, normalize_football
from api.highlightly.collection_policy import BASIC_PROFILE, FULL_PROFILE, football_collection_decision
from api.highlightly.registry import EndpointRegistry
from api.highlightly.worker import HighlightlyWorker
from api.highlightly_client import HighlightlyResponse


PROVIDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
RAW_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
CAPTURED = "2026-07-15T10:00:00+00:00"


def context(normalizer: str, params=None, bookmakers=None):
    return NormalizationContext(
        provider_id=PROVIDER_ID,
        sport_id=SPORT_ID,
        sport="football",
        endpoint_key=f"test.{normalizer}",
        normalizer=normalizer,
        request_params=params or {},
        raw_object_id=RAW_ID,
        captured_at=CAPTURED,
        bookmaker_ids=bookmakers or {"bet365": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    )


class HighlightlyPhaseTwoWorkerTests(unittest.TestCase):
    def test_registry_resolves_path_and_keeps_only_documented_query_params(self):
        registry = EndpointRegistry()
        operation = registry.get("football.FootballLineupsController_getLineups", sport="football")
        path, query = operation.request({"matchId": 42, "api_key": "must-not-leak"})
        self.assertEqual(path, "/football/lineups/42")
        self.assertEqual(query, {})
        self.assertEqual(sum(item.sport == "football" for item in registry.operations.values()), 25)
        football_normalizers = {item.normalizer for item in registry.operations.values() if item.sport == "football"}
        self.assertTrue(football_normalizers.issubset(SUPPORTED_NORMALIZERS))

    def test_match_normalizer_builds_canonical_graph_with_stable_ids(self):
        payload = {
            "data": [{
                "id": 99,
                "date": "2026-07-15T12:00:00Z",
                "round": "Round 1",
                "country": {"code": "BR", "name": "Brazil", "logo": "flag"},
                "league": {"id": 7, "name": "League", "season": 2026},
                "homeTeam": {"id": 1, "name": "Home"},
                "awayTeam": {"id": 2, "name": "Away"},
                "state": {"description": "Not started", "score": {"current": "0 - 0"}},
            }]
        }
        first = normalize_football(payload, context("football.matches"))
        second = normalize_football(payload, context("football.matches"))
        self.assertEqual(first.rows, second.rows)
        self.assertEqual(len(first.table_rows("sports_matches")), 1)
        self.assertEqual(len(first.table_rows("sports_match_participants")), 2)
        self.assertEqual(len(first.table_rows("sports_teams")), 2)
        self.assertEqual(first.table_rows("sports_matches")[0]["status"], "scheduled")
        self.assertEqual(first.table_rows("sports_matches")[0]["id"], stable_id(PROVIDER_ID, SPORT_ID, "match", 99))
        self.assertEqual(first.table_rows("sports_countries")[0]["id"], stable_id("country", "BR"))

    def test_sparse_match_league_does_not_overwrite_catalog_country(self):
        payload = {
            "data": [{
                "id": 100,
                "date": "2026-07-15T12:00:00Z",
                "league": {"id": 7, "name": "League", "season": 2026},
                "homeTeam": {"id": 1, "name": "Home"},
                "awayTeam": {"id": 2, "name": "Away"},
                "state": {"description": "Not started", "score": {}},
            }]
        }

        batch = normalize_football(payload, context("football.matches"))

        competition = batch.table_rows("sports_competitions")[0]
        self.assertNotIn("country_id", competition)

    def test_league_catalog_keeps_country_id(self):
        payload = {
            "data": [{
                "id": 7,
                "name": "League",
                "country": {"code": "BR", "name": "Brazil"},
                "seasons": [{"season": 2026}],
            }]
        }

        batch = normalize_football(payload, context("football.leagues"))

        competition = batch.table_rows("sports_competitions")[0]
        self.assertEqual(competition["country_id"], stable_id("country", "BR"))

    def test_persist_reuses_legacy_country_id_and_remaps_dependents(self):
        repository = Mock()
        repository.select_rows.return_value = [{
            "id": "11111111-1111-4111-8111-111111111111",
            "code": "US",
            "name": "USA",
        }]
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        generated = stable_id("country", "US")
        batch = NormalizedBatch()
        batch.add("sports_countries", {"id": generated, "code": "US", "name": "USA"})
        batch.add("sports_competitions", {
            "id": "22222222-2222-4222-8222-222222222222",
            "sport_id": SPORT_ID,
            "country_id": generated,
            "name": "NBA Women",
        })
        batch.add(
            "sports_provider_entities",
            {
                "provider_id": PROVIDER_ID,
                "sport_id": SPORT_ID,
                "entity_type": "country",
                "external_id": "US",
                "canonical_id": generated,
            },
            conflict="provider_id,sport_id,entity_type,external_id",
            key="country:US",
        )

        worker._persist(batch)

        writes = {call.args[0]: call.args[1] for call in repository.upsert_rows.call_args_list}
        self.assertNotIn("sports_countries", writes)
        self.assertEqual(
            writes["sports_competitions"][0]["country_id"],
            "11111111-1111-4111-8111-111111111111",
        )
        self.assertEqual(
            writes["sports_provider_entities"][0]["canonical_id"],
            "11111111-1111-4111-8111-111111111111",
        )

    def test_odds_normalizer_keeps_every_market_selection(self):
        payload = {"data": [{"matchId": 99, "odds": [{
            "bookmakerId": 2,
            "bookmakerName": "bet365",
            "type": "prematch",
            "market": "Total Goals 2.5",
            "values": [{"value": "Over", "odd": 1.91}, {"value": "Under", "odd": 1.97}],
        }]}]}
        batch = normalize_football(payload, context("football.odds"))
        self.assertEqual(len(batch.table_rows("sports_market_definitions")), 1)
        self.assertEqual(len(batch.odds_quotes), 2)
        self.assertEqual({row["p_selection_key"] for row in batch.odds_quotes}, {"over", "under"})
        self.assertEqual({row["p_line_key"] for row in batch.odds_quotes}, {"2.5"})
        self.assertTrue(all(row["p_source_raw_object_id"] == RAW_ID for row in batch.odds_quotes))

    def test_invalid_odds_are_rejected_without_poisoning_the_batch(self):
        payload = {"matchId": 99, "odds": [{
            "bookmakerId": 2,
            "bookmakerName": "bet365",
            "type": "prematch",
            "market": "Full Time Result",
            "values": [{"value": "Home", "odd": 2.1}, {"value": "Away", "odd": 1.0}],
        }]}
        batch = normalize_football(payload, context("football.odds"))
        self.assertEqual(len(batch.odds_quotes), 1)
        self.assertEqual(batch.rejected, 1)
        self.assertEqual(batch.issues[0]["code"], "ODDS_QUOTE_INVALID")

    def test_unknown_match_statistic_is_discovered_without_code_change(self):
        payload = [{"team": {"id": 1, "name": "Home"}, "statistics": [
            {"displayName": "Experimental Pressure Index", "value": 7.25}
        ]}]
        batch = normalize_football(payload, context("football.match_statistics", {"matchId": 99}))
        definitions = batch.table_rows("hl_metric_definitions")
        facts = batch.table_rows("sports_match_team_stats")
        self.assertEqual(definitions[0]["canonical_key"], "experimental_pressure_index")
        self.assertEqual(definitions[0]["status"], "needs_review")
        self.assertEqual(facts[0]["numeric_value"], 7.25)

    def test_player_statistics_preserve_competition_and_club_scopes(self):
        payload = [{
            "id": 11,
            "name": "Player",
            "perCompetition": [{
                "club": "Club A", "league": "League A", "season": "2026",
                "type": "national league", "goals": 9, "assists": 4,
            }],
            "perClub": [{"club": "Club A", "gamesPlayed": 40, "goals": 15}],
        }]
        batch = normalize_football(payload, context("football.player_statistics", {"id": 11}))
        scopes = {row["scope_key"] for row in batch.table_rows("sports_player_stats")}
        self.assertIn("competition:league_a:2026:club_a", scopes)
        self.assertIn("club:club_a", scopes)
        self.assertFalse(any(".0." in metric["provider_key"] for metric in batch.table_rows("hl_metric_definitions")))

    def test_corrupted_standings_are_quarantined(self):
        standing = {
            "team": {"id": 1, "name": "Repeated"},
            "total": {"games": 2, "wins": 1, "draws": 0, "loses": 1, "scoredGoals": 2, "receivedGoals": 2},
            "points": 3,
        }
        payload = {"league": {"id": 7, "name": "League", "season": 2026}, "groups": [{
            "name": "Regular", "standings": [{**standing, "position": 1}, {**standing, "position": 2}]
        }]}
        batch = normalize_football(payload, context("football.standings"))
        self.assertTrue(any(issue["code"] == "STANDINGS_SINGLE_TEAM_REPEATED" for issue in batch.issues))
        self.assertTrue(all(row["quality_status"] == "quarantined" for row in batch.table_rows("sports_standings_snapshots")))

    def test_schema_fingerprint_ignores_values_but_detects_shape(self):
        self.assertEqual(schema_fingerprint({"data": [{"id": 1}]}), schema_fingerprint({"data": [{"id": 2}]}))
        self.assertNotEqual(schema_fingerprint({"data": [{"id": 1}]}), schema_fingerprint({"data": [{"id": 1, "name": "x"}]}))

    def test_disabled_worker_does_not_claim_a_job(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=False)
        result = worker.run_once()
        self.assertEqual(result.status, "disabled")
        repository.claim_job.assert_not_called()

    def test_pagination_enqueues_exactly_the_next_documented_offset(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        operation = worker.registry.get("football.MatchesController_getMatches")
        enqueued = worker._enqueue_next_page(
            {"data": [{"id": 1}], "pagination": {"offset": 0, "limit": 100, "totalCount": 201}},
            operation=operation,
            request_params={"date": "2026-07-15", "offset": 0, "api_key": "not-forwarded-by-registry"},
        )
        self.assertTrue(enqueued)
        request = repository.enqueue_job.call_args.kwargs
        self.assertEqual(request["request_params"]["offset"], 100)
        self.assertNotIn("api_key", request["request_params"])
        self.assertTrue(request["dedupe_key"].startswith(f"page:{operation.key}:"))

    def test_pagination_preserves_bounded_fanout_scope(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        operation = worker.registry.get("baseball.BaseballMatchController_getMatches")
        self.assertTrue(
            worker._enqueue_next_page(
                {"data": [{"id": 1}], "pagination": {"offset": 0, "limit": 10, "totalCount": 15}},
                operation=operation,
                request_params={
                    "date": "2026-07-15",
                    "limit": 10,
                    "offset": 0,
                    "_fanout": True,
                    "_fanout_scope": "phase7-scope",
                    "_shadow_batch": "2026-07-15",
                    "_pagination_priority": 0,
                },
            )
        )
        request = repository.enqueue_job.call_args.kwargs
        self.assertTrue(request["request_params"]["_fanout"])
        self.assertEqual(request["request_params"]["_fanout_scope"], "phase7-scope")
        self.assertEqual(request["request_params"]["_shadow_batch"], "2026-07-15")
        self.assertEqual(request["request_params"]["_pagination_priority"], 0)
        self.assertEqual(request["priority"], 0)
        self.assertTrue(request["dedupe_key"].startswith("page:phase7-scope:"))

    def test_pagination_stops_at_total_count(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        operation = worker.registry.get("football.MatchesController_getMatches")
        self.assertFalse(worker._enqueue_next_page(
            {"data": [], "pagination": {"offset": 200, "limit": 100, "totalCount": 201}},
            operation=operation,
            request_params={"offset": 200},
        ))
        repository.enqueue_job.assert_not_called()

    def test_single_match_fanout_queues_all_analysis_domains(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        count = worker._enqueue_football_match_fanout({
            "id": 99,
            "date": "2026-07-15T12:00:00Z",
            "homeTeam": {"id": 1, "name": "Home"},
            "awayTeam": {"id": 2, "name": "Away"},
            "league": {"id": 7, "season": 2026},
        })
        self.assertEqual(count, 8)
        keys = {call.kwargs["endpoint_key"] for call in repository.enqueue_job.call_args_list}
        self.assertIn("football.FootballOddsController_getOddsV2", keys)
        self.assertIn("football.FootballStatisticsController_getStatistics", keys)
        self.assertIn("football.FootballLineupsController_getLineups", keys)
        self.assertIn("football.FootballLiveEventsController_getLiveEvents", keys)
        self.assertIn("football.FootballPlayerBoxScoreController_getPlayerBoxScores", keys)
        self.assertIn("football.FootballStandingsController_getStandings", keys)
        self.assertNotIn("football.HighlightsController_getHighlights", keys)
        self.assertNotIn("football.FootballHead2HeadController_getHead2HeadData", keys)
        self.assertNotIn("football.FootballLastFiveGamesController_getLastFiveGames", keys)
        self.assertNotIn("football.PlayersController_getPlayerSummaryById", keys)
        team_stats_calls = [
            call.kwargs["request_params"]
            for call in repository.enqueue_job.call_args_list
            if call.kwargs["endpoint_key"] == "football.TeamsController_teamStatistics"
        ]
        self.assertTrue(all(params["fromDate"] == "2025-07-15" for params in team_stats_calls))
        box_score = next(
            call.kwargs["request_params"]
            for call in repository.enqueue_job.call_args_list
            if call.kwargs["endpoint_key"] == "football.FootballPlayerBoxScoreController_getPlayerBoxScores"
        )
        self.assertNotIn("_fanout_players", box_score)

    def test_football_collection_policy_keeps_professional_and_womens_competitions_full(self):
        for league_name in ("Premier League", "NWSL Women", "FAI Cup"):
            with self.subTest(league=league_name):
                decision = football_collection_decision({"league": {"name": league_name}})
                self.assertEqual(decision.profile, FULL_PROFILE)
                self.assertTrue(decision.allows_detailed_fanout)

    def test_football_collection_policy_marks_friendlies_youth_and_reserves_basic(self):
        expectations = {
            "Friendlies Clubs": "friendly",
            "International Friendlies": "friendly",
            "Paulista - U20": "youth",
            "Youth Championship": "youth",
            "Primavera 1": "youth",
            "Premier Reserve League": "reserve",
        }
        for league_name, reason in expectations.items():
            with self.subTest(league=league_name):
                decision = football_collection_decision({"league": {"name": league_name}})
                self.assertEqual(decision.profile, BASIC_PROFILE)
                self.assertEqual(decision.reason, reason)
                self.assertFalse(decision.allows_detailed_fanout)

    def test_basic_football_competitions_do_not_enqueue_detailed_fanout(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        payload = {
            "data": [
                {"id": 1, "league": {"id": 10, "name": "Friendlies Clubs", "season": 2026}},
                {"id": 2, "league": {"id": 20, "name": "Paulista - U20", "season": 2026}},
                {"id": 3, "league": {"id": 30, "name": "Reserve League", "season": 2026}},
            ]
        }

        self.assertEqual(worker._enqueue_football_match_fanout(payload), 0)
        repository.enqueue_job.assert_not_called()

    def test_unknown_football_league_remains_full_to_avoid_silent_data_loss(self):
        decision = football_collection_decision({"league": {"id": 7}})
        self.assertEqual(decision.profile, FULL_PROFILE)
        self.assertEqual(decision.reason, "unknown_league_conservative_full")

    def test_box_score_fanout_queues_player_summary_and_statistics(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        count = worker._enqueue_football_player_fanout([
            {"team": {"id": 1}, "players": [{"id": 11}, {"id": 12}]},
            {"team": {"id": 2}, "players": [{"id": 12}, {"id": 13}]},
        ])
        self.assertEqual(count, 6)
        self.assertEqual(repository.enqueue_job.call_count, 6)

    def test_shadow_scope_nonce_allows_a_fresh_idempotent_fanout(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        payload = {"id": 99, "homeTeam": {}, "awayTeam": {}, "league": {}}
        worker._enqueue_football_match_fanout(payload, scope_nonce="shadow-a")
        first_keys = [call.kwargs["dedupe_key"] for call in repository.enqueue_job.call_args_list]
        repository.reset_mock()
        worker._enqueue_football_match_fanout(payload, scope_nonce="shadow-b")
        second_keys = [call.kwargs["dedupe_key"] for call in repository.enqueue_job.call_args_list]
        self.assertEqual(len(first_keys), len(second_keys))
        self.assertTrue(set(first_keys).isdisjoint(second_keys))
        self.assertTrue(
            all(
                call.kwargs["request_params"]["_shadow_scope"] == "shadow-b"
                for call in repository.enqueue_job.call_args_list
            )
        )

    def test_phase7_fanout_is_prioritized_ahead_of_stale_shadow_jobs(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)

        worker._enqueue_football_match_fanout(
            {"id": 99, "homeTeam": {}, "awayTeam": {}, "league": {}},
            scope_nonce="phase7-20260716-all-sports",
        )

        self.assertTrue(repository.enqueue_job.call_args_list)
        self.assertTrue(
            all(call.kwargs["priority"] == 0 for call in repository.enqueue_job.call_args_list)
        )

    def test_worker_persists_raw_before_any_canonical_upsert(self):
        repository = Mock()
        repository.claim_job.return_value = {
            "id": "job-1",
            "endpoint_key": "football.MatchesController_getMatchById",
            "sport": "football",
            "priority": 0,
            "request_params": {"id": 99},
            "reprocess_raw_object_id": None,
        }
        repository.create_run.return_value = {"id": "run-1"}
        repository.ingestion_context.return_value = {
            "provider": {"id": PROVIDER_ID, "enabled": True, "contract_version": "6.13.2"},
            "sport": {"id": SPORT_ID},
            "bookmakers": [],
        }
        repository.daily_request_usage.return_value = 0
        repository.store_raw_payload.return_value = SimpleNamespace(id=RAW_ID)
        repository.select_rows.return_value = []
        repository.upsert_rows.return_value = []
        repository.record_quality_issues.return_value = []
        client = Mock()
        client.get.return_value = HighlightlyResponse(
            status=200,
            data={
                "id": 99,
                "date": "2026-07-15T12:00:00Z",
                "country": {"code": "BR", "name": "Brazil"},
                "league": {"id": 7, "name": "League", "season": 2026},
                "homeTeam": {"id": 1, "name": "Home"},
                "awayTeam": {"id": 2, "name": "Away"},
                "state": {"description": "Not started", "score": {}},
            },
            rate_limit=7500,
            rate_remaining=7499,
            content_type="application/json",
        )
        worker = HighlightlyWorker(client, repository, worker_id="test-worker", enabled=True)
        result = worker.run_once()
        self.assertEqual(result.status, "succeeded")
        calls = [call[0] for call in repository.method_calls]
        self.assertLess(calls.index("store_raw_payload"), calls.index("upsert_rows"))
        repository.finish_job.assert_called_once_with("job-1", "test-worker", "succeeded")

    def test_explicit_quota_ceiling_applies_to_priority_zero_jobs(self):
        repository = Mock()
        repository.claim_job.return_value = {
            "id": "job-1",
            "endpoint_key": "football.MatchesController_getMatchById",
            "sport": "football",
            "priority": 0,
            "request_params": {"id": 99},
            "reprocess_raw_object_id": None,
        }
        repository.create_run.return_value = {"id": "run-1"}
        repository.ingestion_context.return_value = {
            "provider": {"id": PROVIDER_ID, "enabled": True, "contract_version": "6.13.2"},
            "sport": {"id": SPORT_ID},
            "bookmakers": [],
        }
        repository.daily_request_usage.return_value = 1_500
        client = Mock()
        worker = HighlightlyWorker(
            client,
            repository,
            worker_id="phase7-worker",
            enabled=True,
            daily_quota_ceiling=1_500,
        )

        result = worker.run_once()

        self.assertEqual(result.status, "retry")
        self.assertIn("quota guard", result.message)
        client.get.assert_not_called()
        repository.finish_job.assert_called_once()


if __name__ == "__main__":
    unittest.main()
