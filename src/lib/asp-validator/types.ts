// Tipos extraídos de src/routes/_authenticated/asp-validator.tsx
// Isolar tipos reduz o tamanho do módulo de rota e acelera o HMR.

export type Decision = "CONFIRMAR" | "PULAR";

export type ValidatorForm = {
  sport: string;
  source_platform: string;
  league: string;
  match_date: string;
  home_team: string;
  away_team: string;
  market: string;
  pick: string;
  line: string;
  offered_odd: string;
  source_probability: string;
  source_ev: string;
  user_context: string;
};

export type ValidationResult = {
  decision: Decision;
  confidence: string;
  validator_model: string;
  source_probability: number | null;
  source_fair_odd: number | null;
  offered_odd: number | null;
  source_ev: number | null;
  adjusted_probability: number;
  adjusted_fair_odd: number;
  adjusted_ev: number | null;
  simulation_summary: string;
  favorable_blocks: string[];
  against_blocks: string[];
  alerts: string[];
  final_analysis: string;
  analysis_context: string;
};

export type ValidatorUploadDraft = {
  local_id: string;
  file: File;
  upload_category: string;
  user_comment: string;
  upload_order: number;
  upload_source: "manual" | "drag_drop" | "clipboard";
};

export type ValidatorRecord = {
  id: string;
  source_platform: string;
  sport: string;
  league: string | null;
  match_date: string | null;
  home_team: string;
  away_team: string;
  market: string;
  pick: string;
  line: string | null;
  offered_odd: number | null;
  source_probability: number | null;
  source_ev: number | null;
  source_fair_odd: number | null;
  adjusted_probability: number | null;
  adjusted_fair_odd: number | null;
  adjusted_ev: number | null;
  decision: Decision;
  confidence: string;
  validator_model: string;
  user_context: string | null;
  analysis_context: string | null;
  favorable_blocks: string[];
  against_blocks: string[];
  alerts: string[];
  final_analysis: string;
  simulation_json: Record<string, unknown> | null;
  online_context_json: Record<string, unknown> | null;
  ocr_raw_text: string | null;
  ocr_structured_data: Record<string, unknown> | null;
  ocr_data_quality_score: number | null;
  ocr_structured_fields_count: number | null;
  simulation_type: string | null;
  structured_json: Record<string, unknown> | null;
  structured_status: "pending" | "processing" | "completed" | "failed" | string;
  structured_error: string | null;
  result_status: string | null;
  result_settled_at: string | null;
  final_score: string | null;
  result_notes: string | null;
  created_at: string;
  updated_at: string;
  stake_units: number | null;
  unit_value_brl: number | null;
  profit_units: number | null;
  profit_brl: number | null;
  clv: number | null;
  is_simulated_result: boolean | null;
  bankroll_applied: boolean | null;
};

export type ValidatorUploadRecord = {
  id: string;
  validator_id: string;
  file_name: string;
  file_path: string | null;
  storage_bucket: string | null;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  upload_source: string | null;
  upload_category: string;
  user_comment: string | null;
  upload_order: number;
  ocr_status: string;
  ocr_text: string | null;
  ocr_error: string | null;
  ocr_structured_data: Record<string, unknown> | null;
  ocr_data_quality_score: number | null;
  ocr_structured_fields_count: number | null;
  structured_json: Record<string, unknown> | null;
  structured_status: "pending" | "processing" | "completed" | "failed" | string;
  structured_error: string | null;
  created_at: string;
  updated_at: string;
};

export type EditableRecord = Pick<
  ValidatorForm,
  | "sport"
  | "source_platform"
  | "league"
  | "match_date"
  | "home_team"
  | "away_team"
  | "market"
  | "pick"
  | "line"
  | "offered_odd"
  | "source_probability"
  | "source_ev"
  | "user_context"
> & {
  source_fair_odd: string;
};

export type ResultForm = {
  result_status: string;
  final_odd: string;
  stake_units: string;
  unit_value_brl: string;
  clv: string;
  final_score: string;
  result_notes: string;
  result_settled_at: string;
};

export type ValidatorDashboardFilters = {
  period: "all" | "7d" | "30d" | "month" | "year";
  sport: string;
  league: string;
  source_platform: string;
  validator_model: string;
  market: string;
  decision: string;
  result: string;
};

export type ValidatorInsert = Omit<
  ValidatorForm,
  "offered_odd" | "source_probability" | "source_ev"
> & {
  offered_odd: number | null;
  source_probability: number | null;
  source_ev: number | null;
  source_fair_odd: number | null;
  adjusted_probability: number;
  adjusted_fair_odd: number;
  adjusted_ev: number | null;
  decision: Decision;
  confidence: string;
  validator_model: string;
  analysis_context: string;
  favorable_blocks: string[];
  against_blocks: string[];
  alerts: string[];
  final_analysis: string;
  simulation_json: Record<string, unknown>;
  online_context_json: Record<string, unknown>;
  ocr_raw_text: string | null;
  ocr_structured_data: Record<string, unknown>;
  ocr_data_quality_score: number | null;
  ocr_structured_fields_count: number | null;
  structured_json: Record<string, unknown>;
  structured_status: "pending" | "processing" | "completed" | "failed";
  structured_error: string | null;
  result_status: string | null;
  stake_units: number | null;
  unit_value_brl: number | null;
  profit_units: number | null;
  profit_brl: number | null;
  clv: number | null;
  result_settled_at: string | null;
  final_score: string | null;
  result_notes: string | null;
  simulation_type: string | null;
  is_simulated_result: boolean;
  bankroll_applied: boolean;
};
