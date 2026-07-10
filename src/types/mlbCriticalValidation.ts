export interface MlbParsedWinLossRecord {
  raw: string;
  wins: number | null;
  losses: number | null;
  win_pct: number | null;
}

export interface MlbParsedTeamSummary {
  team_name: string | null;
  team_key: string | null;
  record: MlbParsedWinLossRecord | null;
  wins: number | null;
  losses: number | null;
  win_pct: number | null;
  manager: string | null;
  game_number: number | null;
  standing: string | null;
  games_back: string | null;
  last10: MlbParsedWinLossRecord | null;
  last20: MlbParsedWinLossRecord | null;
  last30: MlbParsedWinLossRecord | null;
  home_record: MlbParsedWinLossRecord | null;
  away_record: MlbParsedWinLossRecord | null;
  extra_innings_record: MlbParsedWinLossRecord | null;
  one_run_record: MlbParsedWinLossRecord | null;
  vs_rhp_record: MlbParsedWinLossRecord | null;
  vs_lhp_record: MlbParsedWinLossRecord | null;
  vs_east_record: MlbParsedWinLossRecord | null;
  vs_central_record: MlbParsedWinLossRecord | null;
  vs_west_record: MlbParsedWinLossRecord | null;
  interleague_record: MlbParsedWinLossRecord | null;
}

export interface MlbParsedStartingPitcher {
  name: string | null;
  jersey_number: number | null;
  age: number | null;
  throwing_hand: "LHP" | "RHP" | null;
  season_record: MlbParsedWinLossRecord | null;
  wins: number | null;
  losses: number | null;
  era: number | null;
  innings_pitched_display: string | null;
  innings_pitched_decimal: number | null;
  hits_allowed: number | null;
  runs_allowed: number | null;
  earned_runs: number | null;
  walks: number | null;
  strikeouts: number | null;
  home_runs_allowed: number | null;
  last_7_games_record: MlbParsedWinLossRecord | null;
  last_7_ip_display: string | null;
  last_7_ip_decimal: number | null;
  last_7_era: number | null;
  last_7_hits: number | null;
  last_7_walks: number | null;
  last_7_strikeouts: number | null;
  last_7_home_runs: number | null;
  recent_starts: string[];
  vs_opponent_summary: string | null;
  has_faced_opponent: boolean | null;
  current_form_notes: string[];
  k_per_9: number | null;
  bb_per_9: number | null;
  hr_per_9: number | null;
  k_bb_ratio: number | null;
  er_per_9: number | null;
  recent_k_per_9: number | null;
  recent_hr_per_9: number | null;
  starter_quality_score: number | null;
}

export interface MlbParsedRecentGame {
  game_number: number | null;
  date: string | null;
  opponent: string | null;
  home_away: "home" | "away" | null;
  result: "W" | "L" | null;
  runs_for: number | null;
  runs_against: number | null;
  score: string | null;
  team_record_after: string | null;
  standings_after: string | null;
}

export interface MlbSeasonSeriesCompletedGame {
  date: string | null;
  away_team: string | null;
  home_team: string | null;
  away_score: number | null;
  home_score: number | null;
  winner_team: string | null;
  loser_team: string | null;
  is_completed: true;
  raw_line: string;
}

export interface MlbSeasonSeriesUpcomingGame {
  date: string | null;
  away_team: string | null;
  home_team: string | null;
  time: string | null;
  is_completed: false;
  raw_line: string;
}

export interface MlbHeadToHeadGame {
  date: string | null;
  away_team: string | null;
  home_team: string | null;
  away_score: number | null;
  home_score: number | null;
  winner: string | null;
  loser: string | null;
  extra_innings: boolean;
  winning_pitcher: string | null;
  losing_pitcher: string | null;
  save_pitcher: string | null;
  raw_line: string;
}

export interface MlbBaseballReferenceMatchupContext {
  source: "baseball_reference_matchup_text";
  parser_version: "1.0.0" | "1.1.0" | "1.2.0";
  raw_text: string;
  parsed_at: string;
  teams: {
    away: MlbParsedTeamSummary;
    home: MlbParsedTeamSummary;
  };
  starting_pitchers: {
    away: MlbParsedStartingPitcher;
    home: MlbParsedStartingPitcher;
  };
  recent_games: {
    away_last_10: MlbParsedRecentGame[];
    home_last_10: MlbParsedRecentGame[];
  };
  season_series: {
    completed_games: MlbSeasonSeriesCompletedGame[];
    upcoming_games: MlbSeasonSeriesUpcomingGame[];
    yearly_summary: Record<string, string>;
    summary: string | null;
  };
  head_to_head: {
    last_10_games: MlbHeadToHeadGame[];
    summary: string | null;
  };
  data_quality: {
    parsed_fields_count: number;
    missing_fields: string[];
    warnings: string[];
    confidence: number;
  };
}
