import unittest
from unittest.mock import Mock

from api.highlightly.normalizers.baseball import SUPPORTED_NORMALIZERS, normalize_baseball
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
        sport="baseball",
        endpoint_key=f"test.{normalizer}",
        normalizer=normalizer,
        request_params=params or {},
        raw_object_id=RAW_ID,
        captured_at=CAPTURED,
        bookmaker_ids=bookmakers or {"bet365": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    )


class HighlightlyPhaseThreeBaseballTests(unittest.TestCase):
    def test_registry_has_all_twenty_baseball_operations(self):
        registry = EndpointRegistry()
        operations = [item for item in registry.operations.values() if item.sport == "baseball"]
        self.assertEqual(len(operations), 20)
        self.assertTrue({item.normalizer for item in operations}.issubset(SUPPORTED_NORMALIZERS))
        path, query = registry.get(
            "baseball.BaseballLineupsController_getLineups", sport="baseball"
        ).request({"matchId": 42, "api_key": "must-not-leak"})
        self.assertEqual(path, "/baseball/lineups/42")
        self.assertEqual(query, {})

    def test_match_normalizer_preserves_inning_scores_and_state(self):
        payload = [{
            "id": 99,
            "round": "regular-season",
            "date": "2026-07-15T22:00:00Z",
            "league": "MLB",
            "season": 2026,
            "homeTeam": {"id": 1, "name": "Home"},
            "awayTeam": {"id": 2, "name": "Away"},
            "state": {
                "description": "Finished",
                "score": {
                    "home": {"hits": 8, "errors": 0, "innings": [1, 0, 2]},
                    "away": {"hits": 5, "errors": 1, "innings": [0, 1, 0]},
                    "current": "3-1",
                },
            },
        }]
        batch = normalize_baseball(payload, context("baseball.matches"))
        match = batch.table_rows("sports_matches")[0]
        self.assertEqual(match["status"], "finished")
        self.assertEqual(match["id"], stable_id(PROVIDER_ID, SPORT_ID, "match", 99))
        self.assertEqual(len(batch.table_rows("sports_match_participants")), 2)
        self.assertEqual(len(batch.table_rows("sports_match_period_scores")), 6)

    def test_scheduled_match_accepts_nullable_provider_arrays(self):
        payload = [{
            "id": 1548610,
            "date": "2026-07-16T23:00:00Z",
            "league": "MLB",
            "season": 2026,
            "homeTeam": {"id": 1, "name": "Phillies"},
            "awayTeam": {"id": 2, "name": "Mets"},
            "state": {"description": "Not Started"},
            "stats": None,
            "plays": None,
            "referees": None,
            "rosters": None,
        }]

        batch = normalize_baseball(payload, context("baseball.matches"))

        self.assertEqual(batch.table_rows("sports_matches")[0]["status"], "scheduled")
        self.assertEqual(batch.table_rows("sports_match_events"), [])

    def test_all_171_match_metrics_are_dynamic_and_queryable(self):
        statistics = [
            {"name": f"Metric {index}", "group": ["Batting", "Pitching", "Fielding"][index % 3], "value": index + 0.5}
            for index in range(171)
        ]
        payload = [{"team": {"id": 1, "name": "Team", "statistics": statistics}}]
        batch = normalize_baseball(
            payload,
            context("baseball.match_statistics", {"id": 99}),
        )
        self.assertEqual(len(batch.table_rows("hl_metric_definitions")), 171)
        self.assertEqual(len(batch.table_rows("sports_match_team_stats")), 171)
        self.assertEqual(
            {metric["group_name"] for metric in batch.table_rows("hl_metric_definitions")},
            {"Batting", "Pitching", "Fielding"},
        )

    def test_lineup_identifies_confirmed_starting_pitcher(self):
        payload = {
            "home": {
                "team": {"id": 1, "name": "Home"},
                "lineup": [
                    {"id": 11, "player": "Ace", "position": "Pitcher", "positionAbbreviation": "P", "isStarter": True, "jersey": 17},
                    {"id": 12, "player": "Catcher", "positionAbbreviation": "C", "isStarter": True},
                ],
            },
            "away": {
                "team": {"id": 2, "name": "Away"},
                "lineup": [{"id": 21, "player": "Bench", "positionAbbreviation": "P", "isStarter": False}],
            },
        }
        batch = normalize_baseball(payload, context("baseball.lineups", {"matchId": 99}))
        starters = [
            row for row in batch.table_rows("sports_lineup_players")
            if row["metadata"]["isStartingPitcher"]
        ]
        self.assertEqual(len(starters), 1)
        self.assertEqual(starters[0]["metadata"]["starterStatus"], "confirmed")
        self.assertTrue(any(lineup["is_confirmed"] for lineup in batch.table_rows("sports_lineups")))

    def test_confirmed_lineup_without_pitcher_emits_quality_issue(self):
        payload = {
            "home": {
                "team": {"id": 1, "name": "Home"},
                "lineup": [{"id": 12, "player": "Catcher", "positionAbbreviation": "C", "isStarter": True}],
            },
            "away": {"team": {"id": 2, "name": "Away"}, "lineup": []},
        }
        batch = normalize_baseball(payload, context("baseball.lineups", {"matchId": 99}))
        self.assertTrue(any(issue["code"] == "BASEBALL_STARTING_PITCHER_MISSING" for issue in batch.issues))

    def test_odds_classify_moneyline_total_and_run_line(self):
        payload = {"data": [{"matchId": 99, "odds": [
            {"bookmakerId": 2, "bookmakerName": "bet365", "type": "prematch", "market": "Home/Away", "values": [{"value": "Home", "odd": 1.8}]},
            {"bookmakerId": 2, "bookmakerName": "bet365", "type": "prematch", "market": "Over/Under 8.5", "values": [{"value": "Over", "odd": 1.91}]},
            {"bookmakerId": 2, "bookmakerName": "bet365", "type": "prematch", "market": "Asian Handicap -1.5/+1.5", "values": [{"value": "Home", "odd": 2.05}]},
        ]}]}
        batch = normalize_baseball(payload, context("baseball.odds"))
        families = {row["canonical_family"] for row in batch.table_rows("sports_market_definitions")}
        self.assertEqual(families, {"moneyline", "total", "run_line"})
        self.assertEqual(len(batch.odds_quotes), 3)
        run_line = next(row for row in batch.odds_quotes if row["p_line_value"] == -1.5)
        self.assertEqual(run_line["p_line_key"], "-1.5")

    def test_player_season_statistics_keep_team_and_category(self):
        payload = [{
            "id": 11,
            "fullName": "Ace",
            "perSeason": [{
                "league": "MLB",
                "season": 2026,
                "seasonBreakdown": "regular",
                "teams": [{"id": 1, "name": "Home"}],
                "stats": [{"name": "Earned Run Average", "category": "Pitching", "value": 2.75}],
            }],
        }]
        batch = normalize_baseball(payload, context("baseball.player_statistics", {"id": 11}))
        fact = batch.table_rows("sports_player_stats")[0]
        metric = batch.table_rows("hl_metric_definitions")[0]
        self.assertIsNotNone(fact["team_id"])
        self.assertEqual(fact["scope_key"], "season:mlb:2026:regular")
        self.assertEqual(metric["group_name"], "Pitching")

    def test_corrupted_baseball_standings_are_quarantined(self):
        team = {
            "id": 1,
            "name": "Repeated",
            "stats": [
                {"description": "Wins", "abbreviation": "W", "displayValue": "10"},
                {"description": "Losses", "abbreviation": "L", "displayValue": "5"},
            ],
        }
        payload = {"data": [{
            "leagueName": "MLB",
            "abbreviation": "MLB",
            "year": 2026,
            "leagueType": "league",
            "seasonType": "regular",
            "data": [team, team],
        }]}
        batch = normalize_baseball(payload, context("baseball.standings"))
        self.assertTrue(any(issue["code"] == "STANDINGS_SINGLE_TEAM_REPEATED" for issue in batch.issues))
        self.assertTrue(all(row["quality_status"] == "quarantined" for row in batch.table_rows("sports_standings_snapshots")))

    def test_baseball_match_fanout_covers_all_analysis_domains(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        count = worker._enqueue_baseball_match_fanout({
            "id": 99,
            "date": "2026-07-15T22:00:00Z",
            "league": "MLB",
            "season": 2026,
            "homeTeam": {"id": 1, "name": "Home"},
            "awayTeam": {"id": 2, "name": "Away"},
        })
        self.assertEqual(count, 7)
        keys = {call.kwargs["endpoint_key"] for call in repository.enqueue_job.call_args_list}
        self.assertIn("baseball.BaseballMatchStatisticsController_getStatistics", keys)
        self.assertIn("baseball.BaseballLineupsController_getLineups", keys)
        self.assertIn("baseball.BaseballBoxScoresController_getBoxScores", keys)
        self.assertIn("baseball.BaseballOddsController_getOddsV2", keys)
        self.assertIn("baseball.BaseballStandingsController_getStandings", keys)
        self.assertNotIn("baseball.HighlightsController_getHighlights", keys)
        self.assertNotIn("baseball.BaseballHead2HeadController_getHead2HeadData", keys)
        self.assertNotIn("baseball.BaseballLastFiveGamesController_getLastFiveGames", keys)
        odds_job = next(
            call.kwargs
            for call in repository.enqueue_job.call_args_list
            if call.kwargs["endpoint_key"] == "baseball.BaseballOddsController_getOddsV2"
        )
        self.assertEqual(odds_job["request_params"]["limit"], 5)
        box_score_job = next(
            call.kwargs
            for call in repository.enqueue_job.call_args_list
            if call.kwargs["endpoint_key"] == "baseball.BaseballBoxScoresController_getBoxScores"
        )
        self.assertNotIn("_fanout_players", box_score_job["request_params"])

    def test_baseball_box_score_fanout_queues_unique_players(self):
        repository = Mock()
        worker = HighlightlyWorker(Mock(), repository, worker_id="test-worker", enabled=True)
        payload = [
            {"team": {"id": 1}, "boxScores": [{"player": {"id": 11}}, {"player": {"id": 12}}]},
            {"team": {"id": 2}, "boxScores": [{"player": {"id": 12}}, {"player": {"id": 13}}]},
        ]
        self.assertEqual(worker._enqueue_baseball_player_fanout(payload), 6)
        self.assertEqual(repository.enqueue_job.call_count, 6)


if __name__ == "__main__":
    unittest.main()
