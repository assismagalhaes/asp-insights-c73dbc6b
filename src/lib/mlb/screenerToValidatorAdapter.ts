import type { MlbPreparedCriticalValidationPayload } from "@/types/mlbCriticalValidation";
import type {
  MlbValidatorHandoffPayload,
  MlbValidatorHandoffPrefill,
  MlbValidatorHandoffReadResult,
  MlbValidatorHandoffValidationResult,
} from "@/types/mlbValidatorHandoff";

export const MLB_VALIDATOR_HANDOFF_VERSION = "1.0.0";
export const ASP_VALIDATOR_HANDOFF_DRAFT_KEY = "asp_validator_handoff_draft";
export const ASP_VALIDATOR_HANDOFF_CREATED_AT_KEY = "asp_validator_handoff_created_at";
export const ASP_VALIDATOR_HANDOFF_TTL_MS = 2 * 60 * 60 * 1000;

const EMPTY_VALIDATION: MlbValidatorHandoffValidationResult = {
  valid: false,
  canSend: false,
  expired: false,
  errors: [],
  warnings: [],
};

export function mapMlbCriticalPayloadToValidatorInput(payload: MlbPreparedCriticalValidationPayload): MlbValidatorHandoffPrefill {
  return {
    sport: "Baseball",
    league: "MLB",
    source_platform: "ASP Screener MLB",
    event_date: payload.game.date,
    event_time: payload.game.time,
    home_team: payload.game.home_team,
    away_team: payload.game.away_team,
    matchup: payload.game.matchup,
    market: payload.opportunity.market,
    pick: payload.opportunity.pick,
    line: payload.opportunity.line,
    odd: payload.opportunity.odd,
    model_probability: payload.opportunity.model_probability,
    market_probability_no_vig: payload.opportunity.market_probability_no_vig,
    probability_edge: payload.opportunity.probability_edge,
    fair_odd: payload.opportunity.fair_odd,
    ev: payload.opportunity.ev,
    opportunity_score: payload.opportunity.opportunity_score,
    confidence_score: payload.opportunity.confidence_score,
    readiness_status: payload.validation_preparation.readiness_status,
  };
}

export function buildMlbValidatorHandoffPayload(payload: MlbPreparedCriticalValidationPayload): MlbValidatorHandoffPayload {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ASP_VALIDATOR_HANDOFF_TTL_MS);
  const prefill = mapMlbCriticalPayloadToValidatorInput(payload);

  return {
    handoff_id: buildHandoffId(payload),
    handoff_version: MLB_VALIDATOR_HANDOFF_VERSION,
    source_module: "ASP Screener MLB",
    target_module: "ASP Validator",
    source_sport: "Baseball",
    source_league: "MLB",
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    validator_prefill: prefill,
    imported_context: {
      summary: buildMlbValidatorImportedContextTextFromParts(payload),
      supporting_factors: payload.context_alignment.supporting_factors,
      conflicting_factors: payload.context_alignment.conflicting_factors,
      neutral_factors: payload.context_alignment.neutral_factors,
      market_specific_notes: payload.context_alignment.market_specific_notes,
      critical_flags: payload.context_alignment.critical_flags,
      critical_questions: payload.validation_preparation.critical_questions,
      recommended_next_step: payload.validation_preparation.recommended_next_step,
    },
    raw_critical_payload: payload,
  };
}

export function validateMlbValidatorHandoffPayload(payload: unknown, now = new Date()): MlbValidatorHandoffValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const handoff = payload as Partial<MlbValidatorHandoffPayload> | null;

  if (!handoff || typeof handoff !== "object") {
    return { ...EMPTY_VALIDATION, errors: ["Payload de handoff ausente ou invalido."] };
  }

  if (handoff.handoff_version !== MLB_VALIDATOR_HANDOFF_VERSION) errors.push("Versao do handoff incompativel.");
  if (handoff.source_module !== "ASP Screener MLB") errors.push("Origem do handoff incompativel.");
  if (handoff.target_module !== "ASP Validator") errors.push("Destino do handoff incompativel.");
  if (handoff.source_sport !== "Baseball" || handoff.source_league !== "MLB") errors.push("Esporte/liga incompativel com ASP Validator MLB.");

  const prefill = handoff.validator_prefill;
  if (!prefill || typeof prefill !== "object") {
    errors.push("Dados de pre-preenchimento ausentes.");
  } else {
    if (prefill.sport !== "Baseball") errors.push("Sport do pre-preenchimento deve ser Baseball.");
    if (prefill.league !== "MLB") errors.push("League do pre-preenchimento deve ser MLB.");
    if (!prefill.home_team) errors.push("Time mandante ausente no handoff.");
    if (!prefill.away_team) errors.push("Time visitante ausente no handoff.");
    if (!prefill.market) errors.push("Mercado ausente no handoff.");
    if (!prefill.pick) errors.push("Pick ausente no handoff.");
    if (prefill.odd == null) errors.push("Odd ofertada ausente no handoff.");
    if (prefill.model_probability == null) errors.push("Probabilidade ASP ausente no handoff.");
    if (prefill.ev == null) errors.push("EV ASP ausente no handoff.");
    if (prefill.readiness_status === "nao_recomendado_para_validator") {
      errors.push("Readiness bloqueado: nao recomendado para Validator.");
    }
    if (prefill.readiness_status === "contexto_incompleto") {
      warnings.push("Contexto incompleto: revise manualmente antes de usar no Validator.");
    }
  }

  if (!handoff.raw_critical_payload) errors.push("Payload critico original ausente.");
  if (!handoff.imported_context?.summary) warnings.push("Resumo de contexto importado ausente.");

  const expiresAt = handoff.expires_at ? Date.parse(handoff.expires_at) : Number.NaN;
  const expired = !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
  if (expired) errors.push("Rascunho de handoff expirado.");

  const valid = errors.length === 0;
  return {
    valid,
    canSend: valid,
    expired,
    errors,
    warnings,
  };
}

export function serializeMlbValidatorHandoff(payload: MlbValidatorHandoffPayload): string {
  return JSON.stringify(payload);
}

export function deserializeMlbValidatorHandoff(value: string | null): MlbValidatorHandoffPayload | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as MlbValidatorHandoffPayload;
  } catch {
    return null;
  }
}

export function storeMlbValidatorHandoffDraft(payload: MlbValidatorHandoffPayload): MlbValidatorHandoffValidationResult {
  const validation = validateMlbValidatorHandoffPayload(payload);
  if (!validation.valid) return validation;
  if (typeof window === "undefined") {
    return { ...validation, valid: false, canSend: false, errors: [...validation.errors, "sessionStorage indisponivel neste ambiente."] };
  }
  window.sessionStorage.setItem(ASP_VALIDATOR_HANDOFF_DRAFT_KEY, serializeMlbValidatorHandoff(payload));
  window.sessionStorage.setItem(ASP_VALIDATOR_HANDOFF_CREATED_AT_KEY, payload.created_at);
  return validation;
}

export function readMlbValidatorHandoffDraft(now = new Date()): MlbValidatorHandoffReadResult {
  if (typeof window === "undefined") {
    return {
      payload: null,
      validation: { ...EMPTY_VALIDATION, errors: ["sessionStorage indisponivel neste ambiente."] },
    };
  }

  const stored = window.sessionStorage.getItem(ASP_VALIDATOR_HANDOFF_DRAFT_KEY);
  if (!stored) {
    return { payload: null, validation: { ...EMPTY_VALIDATION } };
  }

  const payload = deserializeMlbValidatorHandoff(stored);
  const validation = validateMlbValidatorHandoffPayload(payload, now);
  if (!payload || validation.expired || validation.errors.some((error) => /incompativel|Versao|Origem|Destino|Esporte\/liga/.test(error))) {
    clearMlbValidatorHandoffDraft();
  }
  return { payload: validation.valid ? payload : null, validation };
}

export function clearMlbValidatorHandoffDraft() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ASP_VALIDATOR_HANDOFF_DRAFT_KEY);
  window.sessionStorage.removeItem(ASP_VALIDATOR_HANDOFF_CREATED_AT_KEY);
}

export function buildMlbValidatorImportedContextText(payload: MlbValidatorHandoffPayload): string {
  return payload.imported_context.summary;
}

function buildMlbValidatorImportedContextTextFromParts(payload: MlbPreparedCriticalValidationPayload): string {
  const lines = [
    "Importado do ASP Screener MLB para preparacao de validacao controlada.",
    `Jogo: ${payload.game.matchup}`,
    `Mercado: ${payload.opportunity.market}`,
    `Pick: ${payload.opportunity.pick ?? "-"}`,
    `Linha: ${payload.opportunity.line ?? "-"}`,
    `Odd ofertada: ${payload.opportunity.odd ?? "-"}`,
    `Probabilidade ASP: ${formatPercent(payload.opportunity.model_probability)}`,
    `Probabilidade no-vig mercado: ${formatPercent(payload.opportunity.market_probability_no_vig)}`,
    `Odd justa ASP: ${payload.opportunity.fair_odd ?? "-"}`,
    `EV ASP: ${formatPercent(payload.opportunity.ev)}`,
    `Opportunity Score: ${payload.opportunity.opportunity_score}`,
    `Confidence Score: ${payload.opportunity.confidence_score}`,
    `Readiness: ${payload.validation_preparation.readiness_status}`,
    `Alinhamento contexto: ${payload.context_alignment.alignment_status} (${payload.context_alignment.alignment_score})`,
    `Proximo passo recomendado: ${payload.validation_preparation.recommended_next_step}`,
  ];
  const sections = [
    ["Fatores de suporte", payload.context_alignment.supporting_factors],
    ["Fatores de conflito", payload.context_alignment.conflicting_factors],
    ["Notas de mercado", payload.context_alignment.market_specific_notes],
    ["Flags criticos", payload.context_alignment.critical_flags],
    ["Perguntas criticas", payload.validation_preparation.critical_questions],
  ] as const;
  for (const [label, items] of sections) {
    if (!items.length) continue;
    lines.push(`${label}:`);
    for (const item of items) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

function buildHandoffId(payload: MlbPreparedCriticalValidationPayload) {
  const cryptoSource = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  const randomId = cryptoSource && "randomUUID" in cryptoSource ? cryptoSource.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `mlb-validator-handoff:${payload.game.game_id}:${payload.opportunity.market}:${payload.opportunity.pick ?? "pick"}:${randomId}`;
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}
