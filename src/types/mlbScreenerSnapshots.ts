import type { MlbUnifiedOpportunity } from "@/types/mlbProjections";
import type { MlbStandingsSnapshot } from "@/types/mlbStandings";

export type MlbScreenerSnapshotStatus = "created" | "completed" | "failed" | "partially_completed";

export interface MlbDailyScreenerSnapshotRecord {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  snapshot_date: string;
  run_id: string;
  season: number | null;
  source_module: string;
  source_sport: string;
  source_league: string;
  odds_rows_count: number | null;
  games_count: number | null;
  standings_snapshot_date: string | null;
  standings_source: string | null;
  moneyline_rows_count: number | null;
  totals_rows_count: number | null;
  handicap_rows_count: number | null;
  unified_opportunities_count: number | null;
  shortlist_primary_count: number | null;
  analyze_count: number | null;
  monitor_count: number | null;
  skip_count: number | null;
  missing_data_count: number | null;
  unsupported_line_count: number | null;
  status: MlbScreenerSnapshotStatus;
  execution_summary: Record<string, unknown>;
  filters_payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface MlbOpportunitySnapshotRecord {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  daily_snapshot_id: string;
  run_id: string;
  opportunity_id: string;
  game_id: string | null;
  event_date: string | null;
  event_time: string | null;
  home_team: string | null;
  away_team: string | null;
  matchup: string | null;
  market_family: string | null;
  market_label: string | null;
  pick_label: string | null;
  selection_team: string | null;
  side: string | null;
  line: string | null;
  line_type: string | null;
  is_main_line: boolean | null;
  distance_from_main_line: number | null;
  offered_odd: number | null;
  bookmaker: string | null;
  market_prob_no_vig: number | null;
  model_prob: number | null;
  probability_edge: number | null;
  fair_odd: number | null;
  ev: number | null;
  opportunity_score: number | null;
  confidence_score: number | null;
  priority_status: string | null;
  base_candidate_status: string | null;
  projection_status: string | null;
  rank: number | null;
  is_primary_shortlist: boolean | null;
  correlation_group_id: string | null;
  correlation_status: string | null;
  correlated_with: string | null;
  sent_to_validator: boolean;
  handoff_id: string | null;
  validator_record_id: string | null;
  validator_decision: string | null;
  reasons: string[];
  alerts: string[];
  risk_flags: string[];
  source_projection_payload: Record<string, unknown>;
  opportunity_payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface MlbScreenerSnapshotRunInput {
  snapshotDate: string;
  season: number;
  runId?: string;
  oddsRowsCount: number;
  gamesCount: number;
  standingsSnapshot: MlbStandingsSnapshot | null;
  moneylineRowsCount: number;
  totalsRowsCount: number;
  handicapRowsCount: number;
  opportunities: MlbUnifiedOpportunity[];
  filtersPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface MlbScreenerSnapshotRunResult {
  daily: MlbDailyScreenerSnapshotRecord;
  opportunities: MlbOpportunitySnapshotRecord[];
}

export interface MlbSnapshotOpportunityFilters {
  dailySnapshotId?: string;
  runId?: string;
  limit?: number;
}
