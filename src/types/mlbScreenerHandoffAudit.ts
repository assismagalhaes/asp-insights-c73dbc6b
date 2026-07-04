import type {
  MlbScreenerHandoffAuditRef,
  MlbScreenerHandoffAuditStatus,
  MlbValidatorHandoffPayload,
} from "@/types/mlbValidatorHandoff";

export type { MlbScreenerHandoffAuditRef, MlbScreenerHandoffAuditStatus };

export interface MlbScreenerHandoffAuditRecord {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  handoff_id: string;
  handoff_version: string | null;
  source_module: string;
  source_sport: string;
  source_league: string;
  source_stage: string | null;
  status: MlbScreenerHandoffAuditStatus;
  sent_at: string | null;
  applied_at: string | null;
  discarded_at: string | null;
  expires_at: string | null;
  validation_started_at: string | null;
  validation_completed_at: string | null;
  game_id: string | null;
  event_date: string | null;
  event_time: string | null;
  home_team: string | null;
  away_team: string | null;
  matchup: string | null;
  market: string | null;
  pick: string | null;
  line: string | null;
  odd: number | null;
  bookmaker: string | null;
  model_probability: number | null;
  market_probability_no_vig: number | null;
  fair_odd: number | null;
  ev: number | null;
  opportunity_score: number | null;
  confidence_score: number | null;
  priority_status: string | null;
  readiness_status: string | null;
  alignment_status: string | null;
  alignment_score: number | null;
  validator_record_id: string | null;
  validator_decision: string | null;
  validator_adjusted_probability: number | null;
  validator_final_ev: number | null;
  validator_reason: string | null;
  opportunity_payload: Record<string, unknown>;
  critical_payload: Record<string, unknown>;
  handoff_payload: Record<string, unknown>;
  validator_context_payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface MlbScreenerHandoffAuditListFilters {
  period?: "all" | "today" | "7d" | "30d";
  limit?: number;
}

export interface MlbScreenerHandoffAuditCompletion {
  validator_record_id: string;
  validator_decision: string;
  validator_adjusted_probability: number | null;
  validator_final_ev: number | null;
  validator_reason: string | null;
}

export type MlbValidatorHandoffPayloadWithAudit = MlbValidatorHandoffPayload & {
  audit?: MlbScreenerHandoffAuditRef;
};
