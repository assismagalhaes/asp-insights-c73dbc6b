import type { MlbValidationReadinessStatus, MlbPreparedCriticalValidationPayload } from "@/types/mlbCriticalValidation";

export type MlbScreenerHandoffAuditStatus =
  | "created"
  | "sent_to_validator"
  | "applied_in_validator"
  | "discarded"
  | "expired"
  | "validation_started"
  | "validation_completed"
  | "validation_failed";

export interface MlbScreenerHandoffAuditRef {
  record_id: string | null;
  status: MlbScreenerHandoffAuditStatus | null;
  sent_at: string | null;
  applied_at: string | null;
  last_error?: string | null;
}

export type MlbValidatorHandoffVersion = "1.0.0";
export type MlbValidatorHandoffSourceModule = "ASP Screener MLB";
export type MlbValidatorHandoffTargetModule = "ASP Validator";

export interface MlbValidatorHandoffPrefill {
  sport: "Baseball";
  league: "MLB";
  source_platform: "ASP Screener MLB";
  event_date: string | null;
  event_time: string | null;
  home_team: string;
  away_team: string;
  matchup: string;
  market: string;
  pick: string | null;
  line: number | null;
  odd: number | null;
  model_probability: number | null;
  market_probability_no_vig: number | null;
  probability_edge: number | null;
  fair_odd: number | null;
  ev: number | null;
  opportunity_score: number;
  confidence_score: number;
  readiness_status: MlbValidationReadinessStatus;
}

export interface MlbValidatorHandoffPayload {
  handoff_id: string;
  handoff_version: MlbValidatorHandoffVersion;
  source_module: MlbValidatorHandoffSourceModule;
  target_module: MlbValidatorHandoffTargetModule;
  source_sport: "Baseball";
  source_league: "MLB";
  created_at: string;
  expires_at: string;
  validator_prefill: MlbValidatorHandoffPrefill;
  audit?: MlbScreenerHandoffAuditRef;
  imported_context: {
    summary: string;
    supporting_factors: string[];
    conflicting_factors: string[];
    neutral_factors: string[];
    market_specific_notes: string[];
    critical_flags: string[];
    critical_questions: string[];
    recommended_next_step: string;
  };
  raw_critical_payload: MlbPreparedCriticalValidationPayload;
}

export interface MlbValidatorHandoffValidationResult {
  valid: boolean;
  canSend: boolean;
  expired: boolean;
  errors: string[];
  warnings: string[];
}

export interface MlbValidatorHandoffReadResult {
  payload: MlbValidatorHandoffPayload | null;
  validation: MlbValidatorHandoffValidationResult;
}
