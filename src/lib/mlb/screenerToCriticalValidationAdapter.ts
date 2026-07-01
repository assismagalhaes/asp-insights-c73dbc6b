import type { MlbPreparedCriticalValidationPayload } from "@/types/mlbCriticalValidation";

// Adaptador Screener MLB -> Validação Crítica.
// Não é o mesmo canal do ASP Validator: usa uma chave própria em sessionStorage.
// Este handoff NÃO cria prognóstico, NÃO altera bankroll e NÃO registra aposta:
// apenas prepara um rascunho pendente para análise crítica manual.

export const MLB_CRITICAL_VALIDATION_DRAFT_VERSION = "1.0.0";
export const ASP_CRITICAL_VALIDATION_DRAFT_KEY = "asp_critical_validation_draft";
export const ASP_CRITICAL_VALIDATION_DRAFT_CREATED_AT_KEY = "asp_critical_validation_draft_created_at";
export const ASP_CRITICAL_VALIDATION_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export interface MlbCriticalValidationDraftInput {
  sport: "Baseball";
  league: "MLB";
  source: "ASP Screener MLB";
  event_date: string | null;
  event_time: string | null;
  home_team: string;
  away_team: string;
  matchup: string;
  market: string;
  market_family: string | null;
  pick: string | null;
  line: number | null;
  odd: number | null;
  adjusted_odd: number | null;
  fair_odd: number | null;
  model_probability: number | null;
  market_probability_no_vig: number | null;
  probability_edge: number | null;
  ev: number | null;
  opportunity_score: number;
  confidence_score: number;
  raw_opportunity_score: number;
  raw_confidence_score: number;
  critical_adjusted_score: number;
  critical_adjusted_confidence: number;
  critical_adjusted_status: "strong_conflict" | "review_before_validator" | "aligned";
  post_context_risk_flags: string[];
  validation_readiness_score: number;
  readiness_status: string;
  alignment_status: string;
  alignment_score: number;
  reasons: string[];
  alerts: string[];
  risk_flags: string[];
  supporting_factors: string[];
  conflicting_factors: string[];
  neutral_factors: string[];
  market_specific_notes: string[];
  critical_flags: string[];
  critical_questions: string[];
  recommended_next_step: string;
  imported_context_summary: string;
  source_projection_payload: MlbPreparedCriticalValidationPayload["source_projection_payload"];
  baseball_reference_context: MlbPreparedCriticalValidationPayload["baseball_reference_context"] | null;
}

export interface MlbCriticalValidationDraft {
  draft_id: string;
  draft_version: string;
  source_module: "ASP Screener MLB";
  target_module: "Validação Crítica";
  created_at: string;
  expires_at: string;
  input: MlbCriticalValidationDraftInput;
  raw_critical_payload: MlbPreparedCriticalValidationPayload;
}

export interface MlbCriticalValidationDraftValidation {
  valid: boolean;
  canApply: boolean;
  expired: boolean;
  errors: string[];
  warnings: string[];
}

export interface MlbCriticalValidationDraftReadResult {
  draft: MlbCriticalValidationDraft | null;
  validation: MlbCriticalValidationDraftValidation;
}

const EMPTY_VALIDATION: MlbCriticalValidationDraftValidation = {
  valid: false,
  canApply: false,
  expired: false,
  errors: [],
  warnings: [],
};

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function buildDraftId(payload: MlbPreparedCriticalValidationPayload): string {
  const cryptoSource = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  const randomId =
    cryptoSource && "randomUUID" in cryptoSource
      ? cryptoSource.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `mlb-critical-validation-draft:${payload.game.game_id}:${payload.opportunity.market}:${payload.opportunity.pick ?? "pick"}:${randomId}`;
}

function buildImportedContextSummary(payload: MlbPreparedCriticalValidationPayload): string {
  const lines: string[] = [
    "Importado do ASP Screener MLB para análise crítica manual.",
    `Jogo: ${payload.game.matchup}`,
    `Mercado: ${payload.opportunity.market}`,
    `Pick: ${payload.opportunity.pick ?? "-"}`,
    `Linha: ${payload.opportunity.line ?? "-"}`,
    `Odd ofertada: ${payload.opportunity.odd ?? "-"}`,
    `Odd justa (ASP): ${payload.opportunity.fair_odd ?? "-"}`,
    `Probabilidade ASP: ${formatPercent(payload.opportunity.model_probability)}`,
    `Probabilidade no-vig do mercado: ${formatPercent(payload.opportunity.market_probability_no_vig)}`,
    `Edge de probabilidade: ${formatPercent(payload.opportunity.probability_edge)}`,
    `EV ASP: ${formatPercent(payload.opportunity.ev)}`,
    `Opportunity Score (bruto): ${payload.validation_preparation.raw_opportunity_score}`,
    `Confidence (bruto): ${payload.validation_preparation.raw_confidence_score}`,
    `Score pós-contexto: ${payload.validation_preparation.critical_adjusted_score}`,
    `Confiança pós-contexto: ${payload.validation_preparation.critical_adjusted_confidence}`,
    `Alinhamento: ${payload.context_alignment.alignment_status} (${payload.context_alignment.alignment_score})`,
    `Readiness: ${payload.validation_preparation.readiness_status}`,
    `Próximo passo recomendado: ${payload.validation_preparation.recommended_next_step}`,
  ];
  const sections: [string, string[]][] = [
    ["Fatores de suporte", payload.context_alignment.supporting_factors],
    ["Fatores de conflito", payload.context_alignment.conflicting_factors],
    ["Notas de mercado", payload.context_alignment.market_specific_notes],
    ["Flags críticos", payload.context_alignment.critical_flags],
    ["Perguntas críticas", payload.validation_preparation.critical_questions],
    ["Motivos (Screener)", payload.opportunity.reasons],
    ["Alertas (Screener)", payload.opportunity.alerts],
    ["Risk flags (Screener)", payload.opportunity.risk_flags],
    ["Risk flags pós-contexto", payload.validation_preparation.post_context_risk_flags],
  ];
  for (const [label, items] of sections) {
    if (!items?.length) continue;
    lines.push(`${label}:`);
    for (const item of items) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

export function mapMlbOpportunityToCriticalValidationInput(
  payload: MlbPreparedCriticalValidationPayload,
): MlbCriticalValidationDraftInput {
  const prep = payload.validation_preparation;
  const opp = payload.opportunity;
  const align = payload.context_alignment;
  const marketFamily =
    (payload.source_projection_payload as { market_family?: string } | null)?.market_family ?? null;
  return {
    sport: "Baseball",
    league: "MLB",
    source: "ASP Screener MLB",
    event_date: payload.game.date,
    event_time: payload.game.time,
    home_team: payload.game.home_team,
    away_team: payload.game.away_team,
    matchup: payload.game.matchup,
    market: opp.market,
    market_family: marketFamily,
    pick: opp.pick,
    line: opp.line,
    odd: opp.odd,
    adjusted_odd: null,
    fair_odd: opp.fair_odd,
    model_probability: opp.model_probability,
    market_probability_no_vig: opp.market_probability_no_vig,
    probability_edge: opp.probability_edge,
    ev: opp.ev,
    opportunity_score: opp.opportunity_score,
    confidence_score: opp.confidence_score,
    raw_opportunity_score: prep.raw_opportunity_score,
    raw_confidence_score: prep.raw_confidence_score,
    critical_adjusted_score: prep.critical_adjusted_score,
    critical_adjusted_confidence: prep.critical_adjusted_confidence,
    critical_adjusted_status: prep.critical_adjusted_status,
    post_context_risk_flags: prep.post_context_risk_flags,
    validation_readiness_score: prep.validation_readiness_score,
    readiness_status: prep.readiness_status,
    alignment_status: align.alignment_status,
    alignment_score: align.alignment_score,
    reasons: opp.reasons,
    alerts: opp.alerts,
    risk_flags: opp.risk_flags,
    supporting_factors: align.supporting_factors,
    conflicting_factors: align.conflicting_factors,
    neutral_factors: align.neutral_factors,
    market_specific_notes: align.market_specific_notes,
    critical_flags: align.critical_flags,
    critical_questions: prep.critical_questions,
    recommended_next_step: prep.recommended_next_step,
    imported_context_summary: buildImportedContextSummary(payload),
    source_projection_payload: payload.source_projection_payload,
    baseball_reference_context: payload.baseball_reference_context ?? null,
  };
}

export function buildMlbCriticalValidationDraft(
  payload: MlbPreparedCriticalValidationPayload,
): MlbCriticalValidationDraft {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ASP_CRITICAL_VALIDATION_DRAFT_TTL_MS);
  return {
    draft_id: buildDraftId(payload),
    draft_version: MLB_CRITICAL_VALIDATION_DRAFT_VERSION,
    source_module: "ASP Screener MLB",
    target_module: "Validação Crítica",
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    input: mapMlbOpportunityToCriticalValidationInput(payload),
    raw_critical_payload: payload,
  };
}

export function validateCriticalValidationDraft(
  draft: unknown,
  now: Date = new Date(),
): MlbCriticalValidationDraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const d = draft as Partial<MlbCriticalValidationDraft> | null;

  if (!d || typeof d !== "object") {
    return { ...EMPTY_VALIDATION, errors: ["Rascunho ausente ou inválido."] };
  }

  if (d.draft_version !== MLB_CRITICAL_VALIDATION_DRAFT_VERSION) {
    errors.push("Versão do rascunho incompatível.");
  }
  if (d.source_module !== "ASP Screener MLB") errors.push("Origem do rascunho incompatível.");
  if (d.target_module !== "Validação Crítica") errors.push("Destino do rascunho incompatível.");

  const input = d.input;
  if (!input || typeof input !== "object") {
    errors.push("Dados de entrada do rascunho ausentes.");
  } else {
    if (!input.home_team) errors.push("Time mandante ausente.");
    if (!input.away_team) errors.push("Time visitante ausente.");
    if (!input.market) errors.push("Mercado ausente.");
    if (!input.pick) warnings.push("Pick ausente no rascunho.");
    if (input.odd == null) errors.push("Odd ofertada ausente.");
    if (input.model_probability == null) errors.push("Probabilidade ASP ausente.");
  }

  const expiresAt = d.expires_at ? Date.parse(d.expires_at) : Number.NaN;
  const expired = !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
  if (expired) errors.push("Rascunho expirado.");

  const valid = errors.length === 0;
  return { valid, canApply: valid, expired, errors, warnings };
}

export function storeCriticalValidationDraft(
  draft: MlbCriticalValidationDraft,
): MlbCriticalValidationDraftValidation {
  const validation = validateCriticalValidationDraft(draft);
  if (!validation.valid) return validation;
  if (typeof window === "undefined") {
    return {
      ...validation,
      valid: false,
      canApply: false,
      errors: [...validation.errors, "sessionStorage indisponível neste ambiente."],
    };
  }
  window.sessionStorage.setItem(ASP_CRITICAL_VALIDATION_DRAFT_KEY, JSON.stringify(draft));
  window.sessionStorage.setItem(ASP_CRITICAL_VALIDATION_DRAFT_CREATED_AT_KEY, draft.created_at);
  return validation;
}

export function readCriticalValidationDraft(
  now: Date = new Date(),
): MlbCriticalValidationDraftReadResult {
  if (typeof window === "undefined") {
    return {
      draft: null,
      validation: { ...EMPTY_VALIDATION, errors: ["sessionStorage indisponível neste ambiente."] },
    };
  }
  const raw = window.sessionStorage.getItem(ASP_CRITICAL_VALIDATION_DRAFT_KEY);
  if (!raw) return { draft: null, validation: { ...EMPTY_VALIDATION } };
  let parsed: MlbCriticalValidationDraft | null = null;
  try {
    parsed = JSON.parse(raw) as MlbCriticalValidationDraft;
  } catch {
    clearCriticalValidationDraft();
    return { draft: null, validation: { ...EMPTY_VALIDATION, errors: ["Rascunho corrompido."] } };
  }
  const validation = validateCriticalValidationDraft(parsed, now);
  if (validation.expired || validation.errors.some((e) => /incompatível|Versão|Origem|Destino/.test(e))) {
    clearCriticalValidationDraft();
  }
  return { draft: parsed, validation };
}

export function clearCriticalValidationDraft(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ASP_CRITICAL_VALIDATION_DRAFT_KEY);
  window.sessionStorage.removeItem(ASP_CRITICAL_VALIDATION_DRAFT_CREATED_AT_KEY);
}
