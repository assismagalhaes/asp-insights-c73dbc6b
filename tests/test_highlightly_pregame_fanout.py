import unittest
from unittest.mock import Mock

from api.highlightly.worker import HighlightlyWorker


class HighlightlyPregameFanoutTests(unittest.TestCase):
    def setUp(self):
        self.repository = Mock()
        self.worker = HighlightlyWorker(Mock(), self.repository, worker_id="pregame-test")

    def endpoint_keys(self):
        return [call.kwargs["endpoint_key"] for call in self.repository.enqueue_job.call_args_list]

    def test_football_pregame_keeps_odds_form_and_standings_only(self):
        payload = [{
            "id": 101,
            "date": "2026-07-22T20:00:00Z",
            "league": {"id": 7, "season": 2026, "name": "Premier League"},
            "homeTeam": {"id": 1},
            "awayTeam": {"id": 2},
        }]

        self.worker._enqueue_football_match_fanout(
            payload,
            scope_nonce="future-slot",
            fanout_mode="pregame",
        )

        keys = self.endpoint_keys()
        self.assertIn("football.FootballOddsController_getOddsV2", keys)
        self.assertIn("football.TeamsController_teamStatistics", keys)
        self.assertIn("football.FootballStandingsController_getStandings", keys)
        self.assertNotIn("football.FootballStatisticsController_getStatistics", keys)
        self.assertNotIn("football.FootballLiveEventsController_getLiveEvents", keys)
        self.assertNotIn("football.FootballPlayerBoxScoreController_getPlayerBoxScores", keys)

    def test_baseball_pregame_does_not_request_box_scores_or_lineups(self):
        payload = [{
            "id": 201,
            "date": "2026-07-22T20:00:00Z",
            "league": "MLB",
            "season": 2026,
            "homeTeam": {"id": 3},
            "awayTeam": {"id": 4},
        }]

        self.worker._enqueue_baseball_match_fanout(
            payload,
            scope_nonce="future-slot",
            fanout_mode="pregame",
        )

        keys = self.endpoint_keys()
        self.assertIn("baseball.BaseballOddsController_getOddsV2", keys)
        self.assertIn("baseball.TeamController_getTeamStats", keys)
        self.assertNotIn("baseball.BaseballLineupsController_getLineups", keys)
        self.assertNotIn("baseball.BaseballBoxScoresController_getBoxScores", keys)
        self.assertNotIn("baseball.BaseballMatchStatisticsController_getStatistics", keys)

    def test_basketball_pregame_does_not_request_match_statistics(self):
        payload = [{
            "id": 301,
            "date": "2026-07-22T20:00:00Z",
            "league": {"id": 9, "season": 2026, "name": "NBA"},
            "homeTeam": {"id": 5},
            "awayTeam": {"id": 6},
        }]

        self.worker._enqueue_basketball_match_fanout(
            payload,
            scope_nonce="future-slot",
            fanout_mode="pregame",
        )

        keys = self.endpoint_keys()
        self.assertIn("basketball.BasketballOddsController_getOddsV2", keys)
        self.assertIn("basketball.TeamsController_getTeamStatistics", keys)
        self.assertNotIn("basketball.BasketballStatisticsController_getStatistics", keys)


if __name__ == "__main__":
    unittest.main()
