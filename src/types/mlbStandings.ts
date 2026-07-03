import type { NormalizedOdd } from "@/lib/coleta-dados";

export type MlbStandingsSource = "baseball_reference" | "csv_manual";

export interface MlbStandingRawRow {
  [key: string]: string | number | null | undefined;
}

export interface MlbTeamStanding {
  snapshot_date: string;
  season: number;
  source: MlbStandingsSource;
  source_url: string | null;
  rank: number | null;
  team_name: string;
  team_key: string;
  wins: number | null;
  losses: number | null;
  win_pct: number | null;
  streak_result: "W" | "L" | null;
  streak_count: number | null;
  runs_per_game: number | null;
  runs_allowed_per_game: number | null;
  run_diff_per_game: number | null;
  sos: number | null;
  srs: number | null;
  pyth_wins: number | null;
  pyth_losses: number | null;
  pyth_win_pct: number | null;
  luck: number | null;
  v_east_wins: number | null;
  v_east_losses: number | null;
  v_cent_wins: number | null;
  v_cent_losses: number | null;
  v_west_wins: number | null;
  v_west_losses: number | null;
  interleague_wins: number | null;
  interleague_losses: number | null;
  home_wins: number | null;
  home_losses: number | null;
  home_win_pct: number | null;
  road_wins: number | null;
  road_losses: number | null;
  road_win_pct: number | null;
  extra_innings_wins: number | null;
  extra_innings_losses: number | null;
  one_run_wins: number | null;
  one_run_losses: number | null;
  vs_rhp_wins: number | null;
  vs_rhp_losses: number | null;
  vs_lhp_wins: number | null;
  vs_lhp_losses: number | null;
  vs_500_plus_wins: number | null;
  vs_500_plus_losses: number | null;
  vs_500_minus_wins: number | null;
  vs_500_minus_losses: number | null;
  last10_wins: number | null;
  last10_losses: number | null;
  last20_wins: number | null;
  last20_losses: number | null;
  last30_wins: number | null;
  last30_losses: number | null;
  raw: MlbStandingRawRow;
}

export interface MlbLeagueAverageSnapshot {
  snapshot_date: string;
  season: number;
  source: MlbStandingsSource;
  source_url: string | null;
  runs_per_game_average: number | null;
  runs_allowed_per_game_average: number | null;
  home_record_average: string | null;
  road_record_average: string | null;
  last10_average: string | null;
  raw: MlbStandingRawRow;
}

export interface MlbStandingsValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  importedTeams: number;
  matchedTeams: number;
  unmatchedTeams: string[];
}

export interface MlbStandingsSnapshot {
  snapshot_date: string;
  season: number;
  source: MlbStandingsSource;
  source_url: string | null;
  imported_at: string | null;
  teams: MlbTeamStanding[];
  league_average: MlbLeagueAverageSnapshot | null;
  validation: MlbStandingsValidation;
}

export interface MlbMarketOdd {
  market: string | null;
  pick: string | null;
  line: string | null;
  odd: number | null;
  odd_media: number | null;
  odd_mediana: number | null;
  odd_minima: number | null;
  odd_maxima: number | null;
  odd_melhor: number | null;
  bookmaker_melhor: string | null;
  casas_count: number | null;
  odds_disponiveis: number | null;
  probabilidade_implicita_media: number | null;
  probabilidade_implicita_mediana: number | null;
  margem_mercado_media: number | null;
  margem_mercado_mediana: number | null;
  bookmaker: string | null;
  source: string | null;
}

export interface EnrichedMlbGame {
  game_id: string;
  date: string | null;
  time: string | null;
  home_team: string;
  away_team: string;
  home_team_key: string | null;
  away_team_key: string | null;
  home_standings: MlbTeamStanding | null;
  away_standings: MlbTeamStanding | null;
  markets: MlbMarketOdd[];
  standings_status: "matched" | "partial_match" | "missing_standings";
  missing_teams: string[];
}

export type MlbOddsRow = Pick<
  NormalizedOdd,
  | "data"
  | "hora"
  | "mandante"
  | "visitante"
  | "mercado"
  | "pick"
  | "linha"
  | "odd"
  | "odd_media"
  | "odd_mediana"
  | "odd_minima"
  | "odd_maxima"
  | "odd_melhor"
  | "bookmaker_melhor"
  | "casas_count"
  | "odds_disponiveis"
  | "probabilidade_implicita_media"
  | "probabilidade_implicita_mediana"
  | "margem_mercado_media"
  | "margem_mercado_mediana"
  | "bookmaker"
  | "fonte"
>;
