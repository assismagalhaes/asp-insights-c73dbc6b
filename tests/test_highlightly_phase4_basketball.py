import unittest
from unittest.mock import Mock

from api.highlightly.normalizers.basketball import SUPPORTED_NORMALIZERS, normalize_basketball
from api.highlightly.normalizers.common import NormalizationContext, stable_id
from api.highlightly.registry import EndpointRegistry
from api.highlightly.worker import HighlightlyWorker


PROVIDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
RAW_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
CAPTURED = "2026-07-15T12:00:00+00:00"


def context(normalizer: str, params=None, bookmakers=None):
    return NormalizationContext(
        provider_id=PROVIDER_ID,
        sport_id=SPORT_ID,
        sport="basketball",
        endpoint_key=f"test.{normalizer}",
        normalizer=normalizer,
        request_params=params or {},
        raw_object_id=RAW_ID,
        captured_at=CAPTURED,
        bookmaker_ids=bookmakers or {"bet365": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    )


def statistics(team_id: int, name: str, values: dict[str, float]):
    return {
        "team": {"id": team_id, "name": name},
        "statistics": [{"displayName": key, "value": value} for key, value in values.items()],
    }


class HighlightlyPhaseFourBasketballTests(unittest.TestCase):
    def test_registry_has_all_nineteen_basketball_operations(self):
        registry = EndpointRegistry()
        operations = [item for item in registry.operations.values() if item.sport == "basketball"]
        self.assertEqual(len(operations), 19)
        self.assertTrue({item.normalizer for item in operations}.issubset(SUPPORTED_NORMALIZERS))
        path, query = registry.get(
            "basketball.BasketballStatisticsController_getStatistics", sport="basketball"
        ).request({"matchId": 42, "_home_score": 90})
        self.assertEqual(path, "/basketball/statistics/42")
        self.assertEqual(query, {})

    def test_match_preserves_quarter_and_final_scores(self):
        payload = [{
            "id": 99,
            "date": "2026-07-15T22:00:00Z",
            "country": {"code": "US", "name": "USA"},
            "league": {"id": 11847, "name": "NBA Women", "season": 2026},
            "homeTeam": {"id": 1, "name": "Home"},
            "awayTeam": {"id": 2, "name": "Away"},
            "state": {
                "description": "Finished",
                "score": {"q1": "22 - 18", "q2": "20 - 21", "q3": "25 - 20", "q4": "23 - 28", "current": "90 - 87", "overTime": None},
            },
        }]
        batch = normalize_basketball(payload, context("basketball.matches"))
        match = batch.table_rows("sports_matches")[0]
        self.assertEqual(match["status"], "finished")
        self.assertEqual(match["id"], stable_id(PROVIDER_ID, SPORT_ID, "match", 99))
        self.assertEqual(len(batch.table_rows("sports_match_participants")), 2)
        self.assertEqual(len(batch.table_rows("sports_match_period_scores")), 8)
        self.assertEqual(batch.table_rows("sports_countries")[0]["id"], stable_id("country", "US"))
        home = next(row for row in batch.table_rows("sports_match_participants") if row["role"] == "home")
        self.assertEqual(home["score_data"]["current"], 90)
        self.assertEqual(home["score_data"]["periods"]["q1"], 22)

    def test_wnba_names_are_canonical_without_losing_provider_payload(self):
        payload = [{
            "id": 100,
            "date": "2026-07-16T22:00:00Z",
            "league": {"id": 11847, "name": "NBA Women", "season": 2026},
            "homeTeam": {"id": 1, "name": "Washington Mystics Women"},
            "awayTeam": {"id": 2, "name": "Portland Women"},
            "state": {"description": "Scheduled"},
        }]
        batch = normalize_basketball(payload, context("basketball.matches"))
        competition = batch.table_rows("sports_competitions")[0]
        teams = {row["name"]: row for row in batch.table_rows("sports_teams")}

        self.assertEqual(competition["name"], "WNBA")
        self.assertEqual(competition["short_name"], "WNBA")
        self.assertEqual(competition["metadata"]["provider_name"], "NBA Women")
        self.assertEqual(
            teams["Washington Mystics Women"]["display_name"],
            "Washington Mystics W",
        )
        self.assertEqual(teams["Portland Women"]["display_name"], "Portland Fire W")

    def test_basketball_highlights_fill_detail_contract_fields(self):
        payload = [{
            "id": 501,
            "matchId": 100,
            "title": "Resumo",
            "imgUrl": "https://example.test/thumb.jpg",
            "url": "https://example.test/highlight",
            "durationSeconds": 42,
            "publishedAt": "2026-07-16T23:00:00Z",
        }]
        batch = normalize_basketball(payload, context("basketball.highlights"))
        highlight = batch.table_rows("sports_highlights")[0]

        self.assertEqual(highlight["thumbnail_url"], payload[0]["imgUrl"])
        self.assertEqual(highlight["duration_seconds"], 42)
        self.assertEqual(highlight["published_at"], payload[0]["publishedAt"])

    def test_twenty_one_raw_metrics_and_six_efficiencies_per_team(self):
        home_values = {
            "Succesful Field Goals": 35, "Field Goals": 67,
            "Succesful 3 Pointers": 3, "3 Pointers": 14,
            "Succesful Free Throws": 17, "Free Throws": 20,
            "Assists": 28, "Rebounds": 31, "Offensive Rebounds": 11,
            "Defensive Rebounds": 20, "Steals": 11, "Blocks": 4,
            "Turnovers": 16, "Fast Break Points": 4, "Points Off Turnovers": 11,
            "Points In The Paint": 46, "Personal Fouls": 21,
            "Second Chance Points": 10, "Biggest Lead": 15,
            "Flagrant Fouls": 0, "Technical Fouls": 0,
        }
        away_values = {
            "Succesful Field Goals": 29, "Field Goals": 60,
            "Succesful 3 Pointers": 9, "3 Pointers": 26,
            "Succesful Free Throws": 20, "Free Throws": 21,
            "Assists": 19, "Rebounds": 24, "Offensive Rebounds": 4,
            "Defensive Rebounds": 20, "Steals": 10, "Blocks": 3,
            "Turnovers": 16, "Fast Break Points": 16, "Points Off Turnovers": 26,
            "Points In The Paint": 36, "Personal Fouls": 14,
            "Second Chance Points": 7, "Biggest Lead": 4,
            "Flagrant Fouls": 0, "Technical Fouls": 0,
        }
        params = {
            "matchId": 99, "_home_score": 90, "_away_score": 87,
            "_home_team_id": 1, "_away_team_id": 2,
        }
        batch = normalize_basketball(
            [statistics(1, "Home", home_values), statistics(2, "Away", away_values)],
            context("basketball.match_statistics", params),
        )
        facts = batch.table_rows("sports_match_team_stats")
        metrics = {row["id"]: row for row in batch.table_rows("hl_metric_definitions")}
        self.assertEqual(len(facts), 54)
        derived = [fact for fact in facts if metrics[fact["metric_definition_id"]]["resource"] == "match_statistics_derived"]
        self.assertEqual(len(derived), 12)
        by_team_key = {
            (fact["team_id"], metrics[fact["metric_definition_id"]]["canonical_key"]): float(fact["numeric_value"])
            for fact in derived
        }
        home_id = stable_id(PROVIDER_ID, SPORT_ID, "team", 1)
        expected_pace = ((67 - 11 + 16 + 0.44 * 20) + (60 - 4 + 16 + 0.44 * 21)) / 2
        self.assertAlmostEqual(by_team_key[(home_id, "pace")], expected_pace, places=6)
        self.assertAlmostEqual(by_team_key[(home_id, "offensive_rating")], 90 / expected_pace * 100, places=5)
        self.assertAlmostEqual(by_team_key[(home_id, "defensive_rating")], 87 / expected_pace * 100, places=5)
        self.assertAlmostEqual(by_team_key[(home_id, "effective_field_goal_percentage")], (35 + 0.5 * 3) / 67 * 100, places=5)
        self.assertAlmostEqual(by_team_key[(home_id, "true_shooting_percentage")], 90 / (2 * (67 + 0.44 * 20)) * 100, places=5)
        self.assertAlmostEqual(by_team_key[(home_id, "net_rating")], 3 / expected_pace * 100, places=5)

    def test_corrupted_real_shape_standings_are_rejected_before_team_persistence(self):
        repeated = {"id": 784, "name": "Panevezys Women", "logo": None}
        payload = {
            "league": {"id": 11847, "name": "NBA Women", "season": 2026},
            "groups": [{
                "name": "Western Conference",
                "standings": [
                    {"team": repeated, "wins": 20, "loses": 5, "position": 1, "gamesPlayed": 25, "scoredPoints": 2100, "receivedPoints": 1900},
                    {"team": repeated, "wins": 18, "loses": 7, "position": 2, "gamesPlayed": 25, "scoredPoints": 2050, "receivedPoints": 1950},
                ],
            }],
        }
        batch = normalize_basketball(
            payload,
            context("basketball.standings", {"leagueId": 11847, "season": 2026}),
        )
        self.assertEqual(batch.rejected, 2)
        self.assertEqual(batch.table_rows("sports_standings_snapshots"), [])
        self.assertEqual(batch.table_rows("sports_teams"), [])
        self.assertTrue(any(issue["code"] == "BASKETBALL_STANDINGS_CORRUPTED" and issue["severity"] == "critical" for issue in batch.issues))

    def test_valid_standings_require_games_to_equal_wins_plus_losses(self):
        payload = {
            "league": {"id": 10996, "name": "NBA", "season": 2026},
            "groups": [{"name": "Overall", "standings": [
                {"team": {"id": 1, "name": "A"}, "wins": 10, "loses": 5, "position": 1, "gamesPlayed": 15},
                {"team": {"id": 2, "name": "B"}, "wins": 8, "loses": 8, "position": 2, "gamesPlayed": 15},
            ]}],
        }
        batch = normalize_basketball(payload, context("basketball.standings", {"leagueId": 10996, "season": 2026}))
        self.assertEqual(len(batch.table_rows("sports_standings_snapshots")), 1)
        self.assertEqual(batch.rejected, 1)
        self.assertTrue(all(row["quality_status"] == "valid" for row in batch.table_rows("sports_standings_snapshots")))

    def test_valid_looking_wnba_standings_remain_provider_quarantined(self):
        payload = {
            "league": {"id": 11847, "name": "NBA Women", "season": 2026},
            "groups": [{"name": "Overall", "standings": [
                {"team": {"id": 1, "name": "A"}, "wins": 10, "loses": 5, "position": 1, "gamesPlayed": 15},
                {"team": {"id": 2, "name": "B"}, "wins": 8, "loses": 7, "position": 2, "gamesPlayed": 15},
            ]}],
        }

        batch = normalize_basketball(
            payload,
            context("basketball.standings", {"leagueId": 11847, "season": 2026}),
        )

        self.assertEqual(batch.table_rows("sports_standings_snapshots"), [])
        self.assertEqual(batch.table_rows("sports_teams"), [])
        self.assertEqual(batch.rejected, 2)
        self.assertTrue(any(
            issue["code"] == "BASKETBALL_STANDINGS_PROVIDER_QUARANTINED"
            and issue["severity"] == "critical"
            for issue in batch.issues
        ))

    def test_odds_classify_moneyline_total_and_spread(self):
        payload = {"data": [{"matchId": 99, "odds": [
            {"bookmakerId": 2, "bookmakerName": "bet365", "type": "prematch", "market": "Moneyline", "values": [{"value": "Home", "odd": 1.8}]},
            {"bookmakerId": 2, "bookmakerName": "bet365", "type": "prematch", "market": "Total Points 168.5", "values": [{"value": "Over", "odd": 1.91}]},
            {"bookmakerId": 2, "bookmakerName": "bet365", "type": "prematch", "market": "Spread -1.5/+1.5", "values": [{"value": "Home", "odd": 2.05}]},
        ]}]}
        batch = normalize_basketball(payload, context("basketball.odds"))
        self.assertEqual(
            {row["canonical_family"] for row in batch.table_rows("sports_market_definitions")},
            {"moneyline", "total", "spread"},
        )
        self.assertEqual(len(batch.odds_quotes), 3)
        spread = next(row for row in batch.odds_quotes if row["p_line_value"] == -1.5)
        self.assertEqual(spread["p_line_key"], "-1.5")

    def test_team_statistics_preserve_total_home_and_away(self):
        payload = {
            "leagueId": 11847, "leagueName": "NBA Women", "season": 2026,
            "total": {"games": {"played": 14, "wins": 4, "loses": 10}, "points": {"scored": 1157, "received": 1192}},
            "home": {"games": {"played": 10, "wins": 3, "loses": 7}, "points": {"scored": 810, "received": 821}},
            "away": {"games": {"played": 4, "wins": 1, "loses": 3}, "points": {"scored": 347, "received": 371}},
        }
        batch = normalize_basketball(payload, context("basketball.team_statistics", {"id": 1, "fromDate": "2025-07-15"}))
        self.assertEqual(len(batch.table_rows("sports_team_season_stats")), 15)
        self.assertEqual({row["split_key"] for row in batch.table_rows("sports_team_season_stats")}, {"total", "home", "away"})

    def test_basketball_match_fanout_covers_all_available_domains(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        count = worker._enqueue_basketball_match_fanout({
            "id": 99,
            "date": "2026-07-15T22:00:00Z",
            "league": {"id": 11847, "name": "NBA Women", "season": 2026},
            "homeTeam": {"id": 1, "name": "Home"},
            "awayTeam": {"id": 2, "name": "Away"},
            "state": {"score": {"current": "90 - 87"}},
        })
        self.assertEqual(count, 4)
        jobs = {call.kwargs["endpoint_key"]: call.kwargs for call in repository.enqueue_job.call_args_list}
        self.assertIn("basketball.BasketballStatisticsController_getStatistics", jobs)
        self.assertIn("basketball.BasketballOddsController_getOddsV2", jobs)
        self.assertNotIn("basketball.BasketballStandingsController_getStandings", jobs)
        self.assertNotIn("basketball.HighlightsController_getHighlights", jobs)
        self.assertNotIn("basketball.BasketballHead2HeadController_getHead2HeadData", jobs)
        self.assertNotIn("basketball.BasketballLastFiveGamesController_getLastFiveGames", jobs)
        self.assertEqual(jobs["basketball.BasketballOddsController_getOddsV2"]["request_params"]["limit"], 5)
        statistics_job = jobs["basketball.BasketballStatisticsController_getStatistics"]["request_params"]
        self.assertEqual(statistics_job["_home_score"], 90)
        self.assertEqual(statistics_job["_away_team_id"], 2)

    def test_non_wnba_basketball_standings_remain_enabled(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)

        count = worker._enqueue_basketball_match_fanout({
            "id": 100,
            "date": "2026-07-15T22:00:00Z",
            "league": {"id": 10996, "name": "NBA", "season": 2026},
            "homeTeam": {"id": 1},
            "awayTeam": {"id": 2},
            "state": {"score": {"current": "100 - 98"}},
        })

        self.assertEqual(count, 5)
        standings = next(
            call.kwargs
            for call in repository.enqueue_job.call_args_list
            if call.kwargs["endpoint_key"] == "basketball.BasketballStandingsController_getStandings"
        )
        self.assertIn("season:2026:capture:", standings["dedupe_key"])


if __name__ == "__main__":
    unittest.main()
