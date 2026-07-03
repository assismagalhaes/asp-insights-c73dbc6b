import type { EnrichedMlbGame, MlbTeamStanding } from "@/types/mlbStandings";

export type MlbProjectionCandidateStatus = "analisar" | "monitorar" | "pular" | "missing_data";
export type MlbProjectionStatus = "ok" | "missing_data";
export type MlbTeamVenue = "home" | "away";

export interface MlbSimpleRatingWeights {
  srs: number;
  runDiffPerGame: number;
  pythWinPct: number;
  winPct: number;
  recentFormLast30: number;
  homeRoadSplit: number;
  luckRegression: number;
}

export interface MlbMoneylineThresholds {
  analyzeEv: number;
  analyzeProbGap: number;
  monitorEv: number;
  monitorProbGap: number;
  minOdd: number;
  maxOdd: number;
}

export interface MlbMoneylineProjectionConfig {
  weights: MlbSimpleRatingWeights;
  homeFieldAdvantage: number;
  logisticScale: number;
  minModelProb: number;
  maxModelProb: number;
  thresholds: MlbMoneylineThresholds;
}

export interface MlbTeamSimpleRating {
  team_key: string;
  team_name: string;
  venue: MlbTeamVenue;
  team_simple_rating: number;
  rating_components: {
    srs_component: number;
    run_diff_component: number;
    pyth_component: number;
    win_pct_component: number;
    recent_form_component: number;
    home_road_component: number;
    luck_component: number;
  };
  missing_fields: string[];
}

export interface MlbNoVigMoneylineMarket {
  home_market_implied_prob_raw: number;
  away_market_implied_prob_raw: number;
  home_market_implied_prob_no_vig: number;
  away_market_implied_prob_no_vig: number;
  market_overround: number;
}

export interface MlbMoneylineScreenerRow {
  game_id: string;
  date: string | null;
  time: string | null;
  home_team: string;
  away_team: string;
  market: "Moneyline";
  home_team_key: string | null;
  away_team_key: string | null;
  home_pick: string | null;
  home_odd: number | null;
  home_odd_mediana: number | null;
  home_bookmaker_melhor: string | null;
  away_pick: string | null;
  away_odd: number | null;
  away_odd_mediana: number | null;
  away_bookmaker_melhor: string | null;
  home_market_implied_prob_raw: number | null;
  away_market_implied_prob_raw: number | null;
  home_market_implied_prob_no_vig: number | null;
  away_market_implied_prob_no_vig: number | null;
  market_overround: number | null;
  home_team_rating: number | null;
  away_team_rating: number | null;
  rating_diff: number | null;
  home_model_prob: number | null;
  away_model_prob: number | null;
  home_fair_odd: number | null;
  away_fair_odd: number | null;
  home_ev: number | null;
  away_ev: number | null;
  recommended_side: string | null;
  recommended_odd: number | null;
  recommended_odd_mediana: number | null;
  recommended_bookmaker_melhor: string | null;
  recommended_model_prob: number | null;
  recommended_fair_odd: number | null;
  recommended_ev: number | null;
  candidate_status: MlbProjectionCandidateStatus;
  reasons: string[];
  alerts: string[];
  projection_status: MlbProjectionStatus;
  missing_fields: string[];
  rating_payload: {
    home: MlbTeamSimpleRating | null;
    away: MlbTeamSimpleRating | null;
  };
  game: EnrichedMlbGame;
}

export interface MlbMoneylineProjectionInput {
  game: EnrichedMlbGame;
  config?: Partial<MlbMoneylineProjectionConfig>;
}

export interface MlbTeamRatingInput {
  standings: MlbTeamStanding;
  venue: MlbTeamVenue;
  config?: Partial<MlbMoneylineProjectionConfig>;
}

export type MlbTotalLineType = "main" | "alternate";
export type MlbTotalLeagueAverageSource = "average_row" | "computed_from_teams" | "fallback";
export type MlbTotalsFilter = MlbProjectionCandidateStatus | "todos" | "main" | "alternate";
export type MlbHandicapCandidateStatus = MlbProjectionCandidateStatus | "unsupported_line";
export type MlbHandicapProjectionStatus = MlbProjectionStatus | "unsupported_line";
export type MlbHandicapLineType = "main" | "alternate";
export type MlbHandicapSide = "home" | "away";
export type MlbHandicapFilter = MlbHandicapCandidateStatus | "todos" | "main" | "alternate";
export type MlbOpportunityMarketFamily = "moneyline" | "totals" | "handicap";
export type MlbOpportunityPriorityStatus = "ANALISAR" | "MONITORAR" | "PULAR" | "MISSING_DATA" | "UNSUPPORTED_LINE";
export type MlbOpportunityCorrelationStatus = "primary" | "correlated_alternative" | "standalone";
export type MlbOpportunityFilter =
  | "todos"
  | "shortlist"
  | "analisar"
  | "monitorar"
  | "pular"
  | "missing_data"
  | "unsupported_line"
  | "moneyline"
  | "totals"
  | "handicap"
  | "main"
  | "alternate";

export interface MlbTotalsThresholds {
  analyzeEv: number;
  analyzeProbGap: number;
  analyzeRunGap: number;
  monitorEv: number;
  monitorProbGap: number;
  monitorRunGap: number;
  minOdd: number;
  maxOdd: number;
  maxAnalyzeDistanceFromMainLine: number;
  maxMonitorDistanceFromMainLine: number;
  minAnalyzeFairOdd: number;
  maxAnalyzeOdd: number;
  minAnalyzeOdd: number;
}

export interface MlbTotalsProjectionConfig {
  offenseWeight: number;
  opponentDefenseWeight: number;
  homeRunsAdjustment: number;
  awayRunsAdjustment: number;
  recentFormMultiplier: number;
  recentFormMin: number;
  recentFormMax: number;
  minExpectedRuns: number;
  maxExpectedRuns: number;
  fallbackLeagueAvgRunsPerTeam: number;
  thresholds: MlbTotalsThresholds;
}

export interface MlbLeagueAverageContext {
  league_avg_runs_per_team: number;
  league_average_source: MlbTotalLeagueAverageSource;
}

export interface MlbExpectedRunsComponents {
  offense_index: number;
  opponent_defense_index: number;
  base_expected_runs: number;
  home_away_adjustment: number;
  recent_form_adjustment: number;
  final_expected_runs: number;
  missing_fields: string[];
}

export interface MlbTotalMarketNoVig {
  over_market_implied_prob_raw: number;
  under_market_implied_prob_raw: number;
  over_market_implied_prob_no_vig: number;
  under_market_implied_prob_no_vig: number;
  market_overround: number;
}

export interface MlbPoissonTotalProbabilities {
  over_model_prob: number;
  under_model_prob: number;
  push_prob: number;
  over_win_prob: number;
  under_win_prob: number;
  supported_line_type: boolean;
  line_kind: "half" | "integer" | "unsupported";
}

export interface MlbTotalsScreenerRow {
  game_id: string;
  row_id: string;
  date: string | null;
  time: string | null;
  home_team: string;
  away_team: string;
  market: "Over/Under";
  line: number | null;
  line_type: MlbTotalLineType;
  is_main_total_line: boolean;
  main_total_line: number | null;
  distance_from_main_line: number | null;
  over_odd: number | null;
  over_odd_mediana: number | null;
  over_bookmaker_melhor: string | null;
  under_odd: number | null;
  under_odd_mediana: number | null;
  under_bookmaker_melhor: string | null;
  over_market_implied_prob_raw: number | null;
  under_market_implied_prob_raw: number | null;
  over_market_implied_prob_no_vig: number | null;
  under_market_implied_prob_no_vig: number | null;
  market_overround: number | null;
  league_avg_runs_per_team: number;
  league_average_source: MlbTotalLeagueAverageSource;
  home_expected_runs: number | null;
  away_expected_runs: number | null;
  projected_total_runs: number | null;
  total_gap_vs_line: number | null;
  over_model_prob: number | null;
  under_model_prob: number | null;
  push_prob: number | null;
  over_fair_odd: number | null;
  under_fair_odd: number | null;
  over_ev: number | null;
  under_ev: number | null;
  recommended_side: "Over" | "Under" | null;
  recommended_odd: number | null;
  recommended_odd_mediana: number | null;
  recommended_bookmaker_melhor: string | null;
  recommended_model_prob: number | null;
  recommended_fair_odd: number | null;
  recommended_ev: number | null;
  candidate_status: MlbProjectionCandidateStatus;
  projection_status: MlbProjectionStatus | "unsupported_line";
  reasons: string[];
  alerts: string[];
  missing_fields: string[];
  components: {
    home: MlbExpectedRunsComponents | null;
    away: MlbExpectedRunsComponents | null;
  };
  game: EnrichedMlbGame;
}

export interface MlbHandicapThresholds {
  analyzeEv: number;
  analyzeProbGap: number;
  monitorEv: number;
  monitorProbGap: number;
  minOdd: number;
  maxOdd: number;
  maxAnalyzeDistanceFromMainLine: number;
  maxAnalyzeOdd: number;
  minAnalyzeOdd: number;
  tailMassWarning: number;
  runlineMinusMargin: number;
  runlineMinusEv: number;
  runlineMinusProbGap: number;
  runlinePlusEv: number;
  runlinePlusProbGap: number;
  maxAnalyzeAbsLine: number;
}

export interface MlbHandicapProjectionConfig {
  maxRunsBase: number;
  maxRunsCap: number;
  dynamicRunsStdDevMultiplier: number;
  thresholds: MlbHandicapThresholds;
}

export interface MlbRunDistribution {
  probabilities: Record<number, number>;
  max_runs: number;
  mass_before_normalization: number;
  tail_warning: boolean;
}

export interface MlbHandicapCoverProbabilities {
  win_prob: number;
  push_prob: number;
  loss_prob: number;
  supported_line_type: boolean;
  line_kind: "half" | "integer" | "unsupported";
}

export interface MlbHandicapMarketNoVig {
  home_market_implied_prob_raw: number;
  away_market_implied_prob_raw: number;
  home_market_implied_prob_no_vig: number;
  away_market_implied_prob_no_vig: number;
  market_overround: number;
}

export interface MlbHandicapScreenerRow {
  game_id: string;
  row_id: string;
  date: string | null;
  time: string | null;
  home_team: string;
  away_team: string;
  market: "Asian Handicap";
  canonical_home_line: number | null;
  line_type: MlbHandicapLineType;
  is_main_handicap_line: boolean;
  main_home_handicap_line: number | null;
  distance_from_main_handicap_line: number | null;
  home_pick: string | null;
  home_handicap_line: number | null;
  home_handicap_odd: number | null;
  home_handicap_odd_mediana: number | null;
  home_bookmaker_melhor: string | null;
  away_pick: string | null;
  away_handicap_line: number | null;
  away_handicap_odd: number | null;
  away_handicap_odd_mediana: number | null;
  away_bookmaker_melhor: string | null;
  home_expected_runs: number | null;
  away_expected_runs: number | null;
  projected_total_runs: number | null;
  projected_margin: number | null;
  home_market_implied_prob_raw: number | null;
  away_market_implied_prob_raw: number | null;
  home_market_implied_prob_no_vig: number | null;
  away_market_implied_prob_no_vig: number | null;
  market_overround: number | null;
  home_cover_prob: number | null;
  home_push_prob: number | null;
  home_loss_prob: number | null;
  away_cover_prob: number | null;
  away_push_prob: number | null;
  away_loss_prob: number | null;
  home_fair_odd: number | null;
  away_fair_odd: number | null;
  home_handicap_ev: number | null;
  away_handicap_ev: number | null;
  home_handicap_ev_percent: number | null;
  away_handicap_ev_percent: number | null;
  recommended_side: MlbHandicapSide | null;
  recommended_pick: string | null;
  recommended_line: number | null;
  recommended_odd: number | null;
  recommended_odd_mediana: number | null;
  recommended_bookmaker_melhor: string | null;
  recommended_model_prob: number | null;
  recommended_push_prob: number | null;
  recommended_fair_odd: number | null;
  recommended_ev: number | null;
  candidate_status: MlbHandicapCandidateStatus;
  projection_status: MlbHandicapProjectionStatus;
  reasons: string[];
  alerts: string[];
  missing_fields: string[];
  components: {
    margin_distribution_summary: {
      distribution_max_runs: number | null;
      distribution_mass_before_normalization: number | null;
      distribution_tail_warning: boolean;
    };
    home: MlbExpectedRunsComponents | null;
    away: MlbExpectedRunsComponents | null;
  };
  game: EnrichedMlbGame;
}

export interface MlbOpportunityScoreWeights {
  evQuality: number;
  probabilityEdge: number;
  marketLineQuality: number;
  modelGap: number;
  dataQuality: number;
  baseStatusCoherence: number;
}

export interface MlbOpportunityAppliedPenalty {
  flag: string;
  delta: number;
}

export interface MlbOpportunityScoreComponents {
  ev_quality_score: number;
  probability_edge_score: number;
  market_line_quality_score: number;
  model_gap_score: number;
  data_quality_score: number;
  base_status_coherence_score: number;
  risk_penalty: number;
  raw_score: number;
  final_score: number;
  applied_penalties: MlbOpportunityAppliedPenalty[];
}

export interface MlbCriticalValidationContext {
  readiness_status: "pronto_para_validator" | "revisar_antes_do_validator" | "contexto_incompleto" | "nao_recomendado_para_validator";
  alignment_status: "supports_screener" | "mixed" | "mixed_to_conflicting" | "conflicts_with_screener" | "insufficient_context";
}

export interface MlbUnifiedOpportunity {
  opportunity_id: string;
  game_id: string;
  date: string | null;
  time: string | null;
  home_team: string;
  away_team: string;
  matchup: string;
  market_family: MlbOpportunityMarketFamily;
  market_label: "Moneyline" | "Over/Under" | "Asian Handicap";
  pick_label: string | null;
  selection_team: string | null;
  side: string | null;
  line: number | null;
  line_type: "main" | "alternate" | null;
  is_main_line: boolean;
  distance_from_main_line: number | null;
  offered_odd: number | null;
  median_odd: number | null;
  market_base_odd: number | null;
  bookmaker_melhor: string | null;
  market_prob_no_vig: number | null;
  model_prob: number | null;
  probability_edge: number | null;
  fair_odd: number | null;
  ev: number | null;
  market_overround: number | null;
  model_gap_value: number | null;
  model_gap_label: string;
  base_candidate_status: MlbHandicapCandidateStatus;
  projection_status: MlbHandicapProjectionStatus;
  opportunity_score: number;
  confidence_score: number;
  priority_status: MlbOpportunityPriorityStatus;
  rank: number | null;
  is_primary_shortlist: boolean;
  correlation_group_id: string;
  correlation_status: MlbOpportunityCorrelationStatus;
  correlated_with: string | null;
  reasons: string[];
  alerts: string[];
  risk_flags: string[];
  score_components: MlbOpportunityScoreComponents;
  score_explanation: string;
  source_projection_payload: MlbMoneylineScreenerRow | MlbTotalsScreenerRow | MlbHandicapScreenerRow;
}

export interface MlbOpportunityShortlistResult {
  opportunities: MlbUnifiedOpportunity[];
  primaryShortlist: MlbUnifiedOpportunity[];
  monitorList: MlbUnifiedOpportunity[];
  debugList: MlbUnifiedOpportunity[];
}

export interface MlbCriticalValidationPayload {
  source: "ASP Screener MLB";
  stage: "Opportunity Score";
  sport: "Baseball";
  league: "MLB";
  game: string;
  date: string | null;
  time: string | null;
  market: string;
  pick: string | null;
  line: number | null;
  odd: number | null;
  model_probability: number | null;
  market_probability_no_vig: number | null;
  fair_odd: number | null;
  ev: number | null;
  opportunity_score: number;
  confidence_score: number;
  reasons: string[];
  alerts: string[];
  source_projection_payload: MlbUnifiedOpportunity["source_projection_payload"];
}
