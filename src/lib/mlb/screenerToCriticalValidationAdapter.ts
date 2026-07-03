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
  median_odd: number | null;
  market_base_odd: number | null;
  bookmaker_melhor: string | null;
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

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value as number)) return "-";
  return (value as number).toFixed(digits);
}

function formatBrDate(iso: string | null): string {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function buildDraftId(payload: MlbPreparedCriticalValidationPayload): string {
  const cryptoSource = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  const randomId =
    cryptoSource && "randomUUID" in cryptoSource
      ? cryptoSource.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `mlb-critical-validation-draft:${payload.game.game_id}:${payload.opportunity.market}:${payload.opportunity.pick ?? "pick"}:${randomId}`;
}

type StarterLike = NonNullable<MlbPreparedCriticalValidationPayload["baseball_reference_context"]>["starting_pitchers"]["home"] | null | undefined;
type TeamLike = NonNullable<MlbPreparedCriticalValidationPayload["baseball_reference_context"]>["teams"]["home"] | null | undefined;

function rawOf(r: { raw?: string | null } | null | undefined): string {
  return r?.raw ? r.raw : "não informado";
}

function buildTeamStatsBlock(label: string, team: TeamLike): string[] {
  if (!team) return [`${label}: dados não disponíveis`];
  return [
    `${label}:`,
    `- Record: ${rawOf(team.record)}`,
    `- Last10: ${rawOf(team.last10)}`,
    `- Last20: ${rawOf(team.last20)}`,
    `- Last30: ${rawOf(team.last30)}`,
    `- Home: ${rawOf(team.home_record)}`,
    `- Away: ${rawOf(team.away_record)}`,
    `- vs LHP: ${rawOf(team.vs_lhp_record)}`,
    `- vs RHP: ${rawOf(team.vs_rhp_record)}`,
    `- Extra innings: ${rawOf(team.extra_innings_record)}`,
    `- One run: ${rawOf(team.one_run_record)}`,
    `- Standing: ${team.standing ?? "não informado"}${team.games_back ? ` (GB ${team.games_back})` : ""}`,
  ];
}

function buildStarterBlock(label: string, s: StarterLike): string[] {
  if (!s || !s.name) return [`${label}: não identificado`];
  return [
    `${label}:`,
    `- Nome: ${s.name}`,
    `- Mão: ${s.throwing_hand ?? "não informado"}`,
    `- ERA: ${s.era ?? "não informado"}`,
    `- IP: ${s.innings_pitched_display ?? formatNumber(s.innings_pitched_decimal)}`,
    `- K: ${s.strikeouts ?? "não informado"}`,
    `- BB: ${s.walks ?? "não informado"}`,
    `- HR: ${s.home_runs_allowed ?? "não informado"}`,
    `- K/9: ${s.k_per_9 ?? "não informado"}`,
    `- BB/9: ${s.bb_per_9 ?? "não informado"}`,
    `- HR/9: ${s.hr_per_9 ?? "não informado"}`,
    `- K/BB: ${s.k_bb_ratio ?? "não informado"}`,
    `- Últimos 7: ${rawOf(s.last_7_games_record)} · ERA ${s.last_7_era ?? "-"} · IP ${s.last_7_ip_display ?? "-"}`,
    `- vs oponente: ${s.vs_opponent_summary ?? "não informado"}`,
  ];
}

function buildTechnicalProjectionBlock(payload: MlbPreparedCriticalValidationPayload): string[] {
  const src = payload.source_projection_payload as unknown as Record<string, unknown> | null;
  if (!src) return ["- Projeção técnica: dados não disponíveis"];
  const num = (k: string, digits = 2): string => {
    const v = src[k];
    return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "-";
  };
  const str = (k: string): string => {
    const v = src[k];
    return typeof v === "string" && v ? v : "-";
  };
  const bool = (k: string): string => {
    const v = src[k];
    return typeof v === "boolean" ? (v ? "sim" : "não") : "-";
  };
  const modelProb = src["recommended_model_prob"];
  const ev = src["recommended_ev"];
  return [
    `- home_expected_runs: ${num("home_expected_runs")}`,
    `- away_expected_runs: ${num("away_expected_runs")}`,
    `- projected_total_runs: ${num("projected_total_runs")}`,
    `- total_gap_vs_line: ${num("total_gap_vs_line")}`,
    `- model_prob: ${formatPercent(typeof modelProb === "number" ? modelProb : null)}`,
    `- fair_odd: ${num("recommended_fair_odd")}`,
    `- EV: ${formatPercent(typeof ev === "number" ? ev : null)}`,
    `- line_type: ${str("line_type")}`,
    `- is_main_line: ${bool("is_main_total_line") !== "-" ? bool("is_main_total_line") : bool("is_main_line")}`,
    `- distance_from_main_line: ${num("distance_from_main_line")}`,
    `- candidate_status: ${str("candidate_status")}`,
    `- projection_status: ${str("projection_status")}`,
  ];
}

function buildImportedContextSummary(payload: MlbPreparedCriticalValidationPayload): string {
  const ctx = payload.baseball_reference_context;
  const homeStarter = ctx?.starting_pitchers?.home ?? null;
  const awayStarter = ctx?.starting_pitchers?.away ?? null;
  const homeTeam = ctx?.teams?.home ?? null;
  const awayTeam = ctx?.teams?.away ?? null;

  const out: string[] = [];

  out.push("[ORIGEM]");
  out.push("Importado do ASP Screener MLB para Validação Crítica.");
  out.push("");

  out.push("[JOGO]");
  out.push(`${payload.game.home_team} vs ${payload.game.away_team}`);
  out.push(
    `Data/Hora: ${formatBrDate(payload.game.date)}${payload.game.time ? ` às ${payload.game.time}` : ""}`,
  );
  out.push(`Liga: ${payload.league}`);
  out.push(`Mercado: ${payload.opportunity.market}`);
  out.push(`Pick: ${payload.opportunity.pick ?? "-"}`);
  out.push(`Linha: ${payload.opportunity.line ?? "-"}`);
  out.push(`Odd ofertada: ${payload.opportunity.odd ?? "-"}`);
  out.push(`Odd mediana/base mercado: ${payload.opportunity.market_base_odd ?? payload.opportunity.median_odd ?? "-"}`);
  out.push(`Bookmaker melhor: ${payload.opportunity.bookmaker_melhor ?? "-"}`);
  out.push("");

  out.push("[PROJEÇÃO DO SCREENER]");
  out.push(`Probabilidade ASP: ${formatPercent(payload.opportunity.model_probability)}`);
  out.push(`Probabilidade no-vig mercado: ${formatPercent(payload.opportunity.market_probability_no_vig)}`);
  const edgePP =
    payload.opportunity.probability_edge != null && Number.isFinite(payload.opportunity.probability_edge)
      ? `${(payload.opportunity.probability_edge * 100).toFixed(2)} p.p.`
      : "-";
  out.push(`Edge de probabilidade: ${edgePP}`);
  out.push(`Odd justa ASP: ${payload.opportunity.fair_odd ?? "-"}`);
  out.push(`EV ASP: ${formatPercent(payload.opportunity.ev)}`);
  out.push(`Opportunity Score bruto: ${payload.validation_preparation.raw_opportunity_score}`);
  out.push(`Confidence bruto: ${payload.validation_preparation.raw_confidence_score}`);
  out.push(`Score pós-contexto: ${payload.validation_preparation.critical_adjusted_score}`);
  out.push(`Confiança pós-contexto: ${payload.validation_preparation.critical_adjusted_confidence}`);
  out.push(
    `Alinhamento: ${payload.context_alignment.alignment_status} (${payload.context_alignment.alignment_score})`,
  );
  out.push(`Readiness: ${payload.validation_preparation.readiness_status}`);
  out.push(`Próximo passo recomendado: ${payload.validation_preparation.recommended_next_step}`);
  out.push("");

  const sections: [string, string[]][] = [
    ["[FATORES DE SUPORTE]", payload.context_alignment.supporting_factors],
    ["[FATORES DE CONFLITO]", payload.context_alignment.conflicting_factors],
    [
      "[ALERTAS / RISK FLAGS]",
      [
        ...payload.opportunity.alerts,
        ...payload.opportunity.risk_flags,
        ...payload.validation_preparation.post_context_risk_flags,
        ...payload.context_alignment.critical_flags,
      ],
    ],
    ["[PERGUNTAS CRÍTICAS]", payload.validation_preparation.critical_questions],
    ["[NOTAS DE MERCADO]", payload.context_alignment.market_specific_notes],
    ["[MOTIVOS DO SCREENER]", payload.opportunity.reasons],
  ];
  for (const [label, items] of sections) {
    if (!items?.length) continue;
    out.push(label);
    for (const item of items) out.push(`- ${item}`);
    out.push("");
  }

  out.push("[ESTATÍSTICAS DA PARTIDA]");
  out.push(...buildTeamStatsBlock(`Mandante (${payload.game.home_team})`, homeTeam));
  out.push("");
  out.push(...buildTeamStatsBlock(`Visitante (${payload.game.away_team})`, awayTeam));
  out.push("");

  out.push("[STARTERS PROVÁVEIS / CONFIRMADOS]");
  out.push(...buildStarterBlock(`Mandante (${payload.game.home_team})`, homeStarter));
  out.push("");
  out.push(...buildStarterBlock(`Visitante (${payload.game.away_team})`, awayStarter));
  out.push("");

  const seasonSummary = ctx?.season_series?.summary;
  const h2hSummary = ctx?.head_to_head?.summary;
  const h2hLast = ctx?.head_to_head?.last_10_games ?? [];
  const completed = ctx?.season_series?.completed_games ?? [];
  const upcoming = ctx?.season_series?.upcoming_games ?? [];
  if (seasonSummary || h2hSummary || h2hLast.length || completed.length || upcoming.length) {
    out.push("[MATCHUPS / PREVIEW]");
    if (seasonSummary) out.push(`Season series: ${seasonSummary}`);
    if (h2hSummary) out.push(`H2H: ${h2hSummary}`);
    if (h2hLast.length) {
      out.push("Últimos H2H:");
      for (const g of h2hLast.slice(0, 5)) out.push(`- ${g.raw_line}`);
    }
    if (completed.length) {
      out.push("Season series (jogos concluídos):");
      for (const g of completed.slice(0, 6)) out.push(`- ${g.raw_line}`);
    }
    if (upcoming.length) {
      out.push("Season series (próximos):");
      for (const g of upcoming.slice(0, 4)) out.push(`- ${g.raw_line}`);
    }
    out.push("");
  }

  out.push("[PROJEÇÃO TÉCNICA DO SCREENER]");
  out.push(...buildTechnicalProjectionBlock(payload));

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
    median_odd: opp.median_odd,
    market_base_odd: opp.market_base_odd,
    bookmaker_melhor: opp.bookmaker_melhor,
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
