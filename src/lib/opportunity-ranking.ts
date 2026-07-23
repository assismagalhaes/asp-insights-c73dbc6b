import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDadosTecnicos,
  getEdgeEfetivo,
  getOddEfetiva,
  type OpportunityRankingItem,
  type OpportunityRankingRun,
  type Prognostico,
} from "@/lib/db";
import { parseBaseballReferenceMatchupText } from "@/lib/mlb/baseballReferenceMatchupParser";
import { supabase } from "@/lib/supabase-public";
import type { Json } from "@/integrations/supabase/types";
import { standardizePredictionContract } from "@/lib/market-contract";
import {
  calculateCriticalShortlistConfidence,
  calculateCriticalShortlistScore,
  classifyCriticalShortlistCandidate,
  evaluateMatchMatrixOperationalGate,
  evaluateMlbOperationalGate,
} from "@/lib/critical-validation/critical-shortlist-ranking";

export const MAX_FINAL_OPPORTUNITIES = 3;
export const DEFAULT_PRE_AI_SHORTLIST_LIMIT = 12;
export const MAX_PRE_AI_THESES_PER_EVENT = 2;
export const PRELIMINARY_SCORE_WEIGHTS = {
  valueScore: 0.38,
  probabilityMarginScore: 0.24,
  dataReadinessScore: 0.2,
  marketRiskScore: 0.1,
  timingScore: 0.06,
  sourceIntegrityScore: 0.02,
} as const;

export type OpportunityRankingStatus =
  | "CANDIDATA"
  | "CONFIRMA_IA"
  | "TOP_FINAL"
  | "RESERVA"
  | "PULAR"
  | "BLOQUEADA";

export type MatchupPreviewStatus = "not_requested" | "queued" | "loaded" | "missing" | "error";

export interface OpportunityScoreComponents {
  edge_quality_score: number;
  probability_quality_score: number;
  odd_quality_score: number;
  value_gap_score: number;
  data_quality_score: number;
  model_origin_score: number;
  risk_penalty: number;
  raw_score: number;
  final_score: number;
}

export interface RankedOpportunityCandidate {
  prognostico: Prognostico;
  event_key: string;
  group_key: string;
  ranking_status: OpportunityRankingStatus;
  opportunity_score_pre: number;
  confidence_score: number;
  score_components: OpportunityScoreComponents;
  risk_flags: string[];
  reasons: string[];
  group_size: number;
  group_alternatives: RankedOpportunityAlternative[];
}

export interface RankedOpportunityAlternative {
  prognostico_id: string;
  mercado: string;
  pick: string;
  odd_ofertada: number;
  edge: number;
  opportunity_score_pre: number;
  confidence_score: number;
}

export interface PersistedOpportunityRankingRun {
  run: OpportunityRankingRun;
  items: OpportunityRankingItem[];
}

export interface GeneratePreAiShortlistInput {
  prognosticos: Prognostico[];
  runDate?: string;
  limit?: number;
  filtersPayload?: Record<string, unknown>;
}

export interface OpportunityRankingScope {
  eventDateFrom: string | null;
  eventDateTo: string | null;
  sport: string;
  league: string;
  market: string;
  scopeKey: string;
}

export interface EnrichOpportunityRankingItemPreviewInput {
  itemId: string;
  prognostico: Prognostico;
  rawPreviewText: string;
  source?: string;
}

export interface ApplyCriticalValidationToRankingInput {
  prognosticoId: string;
  decisao: string;
  aiDecision?: string | null;
  aiStakeSuggested?: number | null;
  finalStake?: number | null;
  parecer?: string | null;
}

export interface MatchupPreviewEnrichment {
  context: string;
  status: MatchupPreviewStatus;
  metadata: Record<string, unknown>;
}

export function isFinalExecutableStatus(status: OpportunityRankingStatus): boolean {
  return status === "TOP_FINAL";
}

export function getOpportunityMarketLabel(prognostico: Prognostico) {
  return standardizePredictionContract(prognostico).mercado;
}

export function getOpportunityPickLabel(prognostico: Prognostico) {
  return standardizePredictionContract(prognostico).pick;
}

export function getOpportunitySourceLabel(
  prognostico: Pick<Prognostico, "mercado" | "origem_modelo">,
) {
  return prognostico.origem_modelo?.trim() || prognostico.mercado;
}

export function useLatestPreAiOpportunityShortlist() {
  return useQuery({
    queryKey: ["opportunity-ranking", "pre-ai-latest"],
    queryFn: fetchLatestPreAiOpportunityShortlist,
  });
}

export function usePreAiOpportunityShortlistHistory(limit = 50) {
  return useQuery({
    queryKey: ["opportunity-ranking", "pre-ai-history", limit],
    queryFn: () => fetchPreAiOpportunityShortlistHistory(limit),
  });
}

export function useGeneratePreAiOpportunityShortlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generateAndPersistPreAiOpportunityShortlist,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunity-ranking"] });
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
    },
  });
}

export function useEnrichOpportunityRankingItemPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: enrichOpportunityRankingItemPreview,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunity-ranking"] });
    },
  });
}

export function useApplyCriticalValidationToOpportunityRanking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: applyCriticalValidationToOpportunityRanking,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunity-ranking"] });
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
    },
  });
}

export async function fetchPreAiOpportunityShortlistHistory(
  limit = 50,
): Promise<PersistedOpportunityRankingRun[]> {
  const { data: runRows, error: runError } = await supabase
    .from("opportunity_ranking_runs")
    .select("*")
    .eq("source_stage", "pre_ai_shortlist")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (runError) throw runError;

  const runs = (runRows ?? []) as OpportunityRankingRun[];
  if (!runs.length) return [];

  const { data: itemRows, error: itemError } = await supabase
    .from("opportunity_ranking_items")
    .select("*")
    .in(
      "run_id",
      runs.map((run) => run.id),
    )
    .order("rank_prelim", { ascending: true });
  if (itemError) throw itemError;

  const itemsByRun = new Map<string, OpportunityRankingItem[]>();
  for (const item of (itemRows ?? []) as OpportunityRankingItem[]) {
    const items = itemsByRun.get(item.run_id) ?? [];
    items.push(item);
    itemsByRun.set(item.run_id, items);
  }

  return runs.map((run) => ({ run, items: itemsByRun.get(run.id) ?? [] }));
}

export async function fetchLatestPreAiOpportunityShortlist(): Promise<PersistedOpportunityRankingRun | null> {
  const { data: runs, error: runError } = await supabase
    .from("opportunity_ranking_runs")
    .select("*")
    .eq("source_stage", "pre_ai_shortlist")
    .order("created_at", { ascending: false })
    .limit(1);
  if (runError) throw runError;
  const run = runs?.[0] as OpportunityRankingRun | undefined;
  if (!run) return null;

  const { data: items, error: itemError } = await supabase
    .from("opportunity_ranking_items")
    .select("*")
    .eq("run_id", run.id)
    .order("rank_prelim", { ascending: true });
  if (itemError) throw itemError;

  return {
    run,
    items: (items ?? []) as OpportunityRankingItem[],
  };
}

export async function applyCriticalValidationToOpportunityRanking({
  prognosticoId,
  decisao,
  aiDecision,
  aiStakeSuggested,
  finalStake,
  parecer,
}: ApplyCriticalValidationToRankingInput): Promise<OpportunityRankingItem | null> {
  const { data: itemRows, error: itemError } = await supabase
    .from("opportunity_ranking_items")
    .select("*")
    .eq("prognostico_id", prognosticoId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (itemError) throw itemError;
  const item = itemRows?.[0] as OpportunityRankingItem | undefined;
  if (!item) return null;

  const { data: prognosticoRow, error: prognosticoError } = await supabase
    .from("prognosticos")
    .select("*")
    .eq("id", prognosticoId)
    .single();
  if (prognosticoError) throw prognosticoError;
  const currentPrognostico = prognosticoRow as unknown as Prognostico;
  const mlbGate = evaluateMlbOperationalGate(currentPrognostico);
  if (
    normalizeValidationDecision(decisao) === "CONFIRMA" &&
    mlbGate.applicable &&
    !mlbGate.approved
  ) {
    throw new Error(mlbGate.reasons.join(" "));
  }
  const matchMatrixGate = evaluateMatchMatrixOperationalGate(currentPrognostico);
  if (
    normalizeValidationDecision(decisao) === "CONFIRMA" &&
    matchMatrixGate.applicable &&
    !matchMatrixGate.approved
  ) {
    throw new Error(matchMatrixGate.reasons.join(" "));
  }

  const normalizedDecision = normalizeValidationDecision(decisao);
  const rankingStatus: OpportunityRankingStatus =
    normalizedDecision === "CONFIRMA" ? "CONFIRMA_IA" : "PULAR";
  const metadata = {
    ...asRecord(item.metadata),
    critical_validation: {
      applied_at: new Date().toISOString(),
      decisao: normalizedDecision,
      ai_decision: aiDecision ?? null,
      parecer: parecer ?? null,
    },
  };

  const { data: updatedRow, error: updateError } = await supabase
    .from("opportunity_ranking_items")
    .update({
      ranking_status: rankingStatus,
      ai_decision: aiDecision ?? normalizedDecision,
      ai_stake_suggested: aiStakeSuggested ?? null,
      final_stake: finalStake ?? null,
      metadata,
    })
    .eq("id", item.id)
    .select("*")
    .single();
  if (updateError) throw updateError;

  await recomputeFinalRankingForRun(item.run_id);
  return updatedRow as OpportunityRankingItem;
}

export async function enrichOpportunityRankingItemPreview({
  itemId,
  prognostico,
  rawPreviewText,
  source = "manual_matchup_preview",
}: EnrichOpportunityRankingItemPreviewInput): Promise<OpportunityRankingItem> {
  const preview = buildMatchupPreviewEnrichment(prognostico, rawPreviewText, source);
  if (preview.status !== "loaded") {
    const validationErrors = asStringArray(preview.metadata.validation_errors);
    throw new Error(
      validationErrors[0] ?? "Cole o Matchups/Preview antes de enriquecer a oportunidade.",
    );
  }

  const { data: currentItem, error: currentError } = await supabase
    .from("opportunity_ranking_items")
    .select("metadata")
    .eq("id", itemId)
    .single();
  if (currentError) throw currentError;

  const metadata = {
    ...asRecord(currentItem?.metadata),
    matchup_preview: preview.metadata,
  };

  const { data, error } = await supabase
    .from("opportunity_ranking_items")
    .update({
      matchup_preview_context: preview.context,
      matchup_preview_status: preview.status,
      metadata: metadata as Json,
    })
    .eq("id", itemId)
    .select("*")
    .single();
  if (error) throw error;
  return data as OpportunityRankingItem;
}

export function buildMatchupPreviewEnrichment(
  prognostico: Prognostico,
  rawPreviewText: string,
  source = "manual_matchup_preview",
): MatchupPreviewEnrichment {
  const raw = rawPreviewText.trim();
  if (!raw) {
    return {
      context: "",
      status: "missing",
      metadata: {
        source,
        enriched_at: new Date().toISOString(),
        raw_length: 0,
      },
    };
  }

  const isMlb = isMlbPrognostico(prognostico);
  const parsedContext = isMlb
    ? parseBaseballReferenceMatchupText(raw, {
        home_team: prognostico.mandante,
        away_team: prognostico.visitante,
      })
    : null;

  const genericValidation = isMlb
    ? { errors: [] as string[], warnings: [] as string[] }
    : validateGenericMatchupPreview(prognostico, raw);
  if (genericValidation.errors.length) {
    return {
      context: "",
      status: "error",
      metadata: {
        source,
        parser: "generic_preview_text",
        enriched_at: new Date().toISOString(),
        raw_length: raw.length,
        validation_errors: genericValidation.errors,
        warnings: genericValidation.warnings,
      },
    };
  }

  const warnings = [
    ...(parsedContext?.data_quality?.warnings ?? []),
    ...genericValidation.warnings,
  ];
  const missingFields = parsedContext?.data_quality?.missing_fields ?? [];
  const context = [
    "[MATCHUPS / PREVIEW ENRIQUECIDO]",
    `Origem: ${source}`,
    `Processado em: ${new Date().toISOString()}`,
    "",
    "[JOGO]",
    `${prognostico.jogo || `${prognostico.mandante} vs ${prognostico.visitante}`}`,
    `Esporte/Liga: ${prognostico.esporte} / ${prognostico.liga}`,
    `Data/Hora: ${prognostico.data}${prognostico.hora ? ` ${prognostico.hora}` : ""}`,
    "",
    "[VALIDACAO DO PREVIEW]",
    "Confronto confirmado para as duas equipes.",
    ...(genericValidation.warnings.length
      ? genericValidation.warnings.map((warning) => `Alerta: ${warning}`)
      : ["Data e liga consistentes com os metadados disponiveis."]),
    "",
    ...(parsedContext
      ? [
          "[QUALIDADE DO MATCHUP/PREVIEW]",
          `Parser: Baseball-Reference Matchup`,
          `Confianca do contexto: ${parsedContext.data_quality.confidence}`,
          `Visitante: ${parsedContext.teams.away.team_name ?? "-"} ${parsedContext.teams.away.record?.raw ?? ""}`.trim(),
          `Mandante: ${parsedContext.teams.home.team_name ?? "-"} ${parsedContext.teams.home.record?.raw ?? ""}`.trim(),
          `Starter visitante: ${formatStarter(parsedContext.starting_pitchers.away)}`,
          `Starter mandante: ${formatStarter(parsedContext.starting_pitchers.home)}`,
          ...(warnings.length ? ["Alertas:", ...warnings.map((warning) => `- ${warning}`)] : []),
          ...(missingFields.length
            ? ["Campos ausentes:", ...missingFields.map((field) => `- ${field}`)]
            : []),
          "",
        ]
      : []),
    "[TEXTO MATCHUPS / PREVIEW]",
    raw,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    context,
    status: "loaded",
    metadata: {
      source,
      parser: parsedContext ? "baseball_reference_matchup_text" : "generic_preview_text",
      enriched_at: new Date().toISOString(),
      raw_length: raw.length,
      confidence: parsedContext?.data_quality?.confidence ?? null,
      warnings,
      validation_errors: [],
      missing_fields: missingFields,
      parsed_context: parsedContext,
    },
  };
}

async function recomputeFinalRankingForRun(runId: string): Promise<void> {
  const { data: rows, error } = await supabase
    .from("opportunity_ranking_items")
    .select("*")
    .eq("run_id", runId)
    .in("ranking_status", ["CONFIRMA_IA", "TOP_FINAL", "RESERVA"]);
  if (error) throw error;
  const rankingItems = (rows ?? []) as OpportunityRankingItem[];
  const prognosticoIds = rankingItems.map((item) => item.prognostico_id);
  const { data: prognosticoRows, error: prognosticosError } = prognosticoIds.length
    ? await supabase.from("prognosticos").select("*").in("id", prognosticoIds)
    : { data: [], error: null };
  if (prognosticosError) throw prognosticosError;
  const prognosticoById = new Map(
    ((prognosticoRows ?? []) as unknown as Prognostico[]).map((row) => [row.id, row]),
  );
  const confirmed = rankingItems
    .map((item) => {
      const prognostico = prognosticoById.get(item.prognostico_id);
      if (!prognostico) return null;
      const mlbGate = evaluateMlbOperationalGate(prognostico);
      if (mlbGate.applicable && !mlbGate.approved) return null;
      const matchMatrixGate = evaluateMatchMatrixOperationalGate(prognostico);
      if (matchMatrixGate.applicable && !matchMatrixGate.approved) return null;
      const current = calculatePreliminaryOpportunityScore(prognostico);
      return {
        item,
        finalScore: calculateFinalOpportunityScore(item, current),
      };
    })
    .filter((entry): entry is { item: OpportunityRankingItem; finalScore: number } => entry != null)
    .sort(
      (a, b) =>
        b.finalScore - a.finalScore ||
        numericOrZero(b.item.confidence_score) - numericOrZero(a.item.confidence_score) ||
        numericOrZero(b.item.opportunity_score_pre) - numericOrZero(a.item.opportunity_score_pre),
    );

  const itemUpdates = await Promise.all(
    confirmed.map(({ item, finalScore }, index) =>
      supabase
        .from("opportunity_ranking_items")
        .update({
          ranking_status: index < MAX_FINAL_OPPORTUNITIES ? "TOP_FINAL" : "RESERVA",
          rank_final: index < MAX_FINAL_OPPORTUNITIES ? index + 1 : null,
          opportunity_score_final: finalScore,
        })
        .eq("id", item.id),
    ),
  );
  const failedItemUpdate = itemUpdates.find((result) => result.error);
  if (failedItemUpdate?.error) throw failedItemUpdate.error;

  const eligibleIds = new Set(confirmed.map(({ item }) => item.id));
  const ineligibleUpdates = await Promise.all(
    rankingItems
      .filter((item) => !eligibleIds.has(item.id))
      .map((item) =>
        supabase
          .from("opportunity_ranking_items")
          .update({ ranking_status: "RESERVA", rank_final: null, opportunity_score_final: 0 })
          .eq("id", item.id),
      ),
  );
  const failedIneligibleUpdate = ineligibleUpdates.find((result) => result.error);
  if (failedIneligibleUpdate?.error) throw failedIneligibleUpdate.error;

  const { error: clearMarkerError } = await supabase
    .from("prognosticos")
    .update({
      is_top_final: false,
      top_final_rank: null,
      top_final_run_id: null,
      top_final_at: null,
    })
    .eq("top_final_run_id", runId);
  if (clearMarkerError) throw clearMarkerError;

  const topFinal = confirmed.slice(0, MAX_FINAL_OPPORTUNITIES);
  const markedAt = new Date().toISOString();
  const markerUpdates = await Promise.all(
    topFinal.map(({ item }, index) =>
      supabase
        .from("prognosticos")
        .update({
          is_top_final: true,
          top_final_rank: index + 1,
          top_final_run_id: runId,
          top_final_at: markedAt,
        })
        .eq("id", item.prognostico_id),
    ),
  );
  const failedMarkerUpdate = markerUpdates.find((result) => result.error);
  if (failedMarkerUpdate?.error) throw failedMarkerUpdate.error;

  const { data: runRows, error: runFetchError } = await supabase
    .from("opportunity_ranking_runs")
    .select("metadata")
    .eq("id", runId)
    .limit(1);
  if (runFetchError) throw runFetchError;
  const runMetadata = asRecord(runRows?.[0]?.metadata);

  const { error: runError } = await supabase
    .from("opportunity_ranking_runs")
    .update({
      status: "computed",
      confirmed_ia_count: confirmed.length,
      top_final_count: Math.min(confirmed.length, MAX_FINAL_OPPORTUNITIES),
      metadata: {
        ...runMetadata,
        final_ranking_recomputed_at: new Date().toISOString(),
        final_ranking_rule:
          "Somente itens confirmados na validacao critica entram no TOP_FINAL; limite maximo de 3.",
      },
    })
    .eq("id", runId);
  if (runError) throw runError;
}

function calculateFinalOpportunityScore(
  item: OpportunityRankingItem,
  current?: RankedOpportunityCandidate,
): number {
  const preScore = current?.opportunity_score_pre ?? numericOrZero(item.opportunity_score_pre);
  const confidence = current?.confidence_score ?? numericOrZero(item.confidence_score);
  const aiSignal = item.ai_decision === "CONFIRMA" ? 100 : 85;
  const previewSignal = item.matchup_preview_status === "loaded" ? 100 : 45;
  const riskPenalty = asStringArray(item.risk_flags).length * 2.5;
  const finalScore =
    preScore * 0.5 + confidence * 0.2 + aiSignal * 0.22 + previewSignal * 0.08 - riskPenalty;
  return round(clamp(finalScore, 0, 100), 1);
}

export async function generateAndPersistPreAiOpportunityShortlist({
  prognosticos,
  runDate = todayIsoDate(),
  limit = DEFAULT_PRE_AI_SHORTLIST_LIMIT,
  filtersPayload = {},
}: GeneratePreAiShortlistInput): Promise<PersistedOpportunityRankingRun> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) throw new Error("Sessao Supabase nao encontrada para gerar ranking.");

  const allEligibleCandidates = buildEligiblePreAiCandidates(prognosticos);
  const candidates = selectDiversifiedPreAiShortlist(allEligibleCandidates, limit);
  const scope = buildOpportunityRankingScope(prognosticos, filtersPayload);
  const { data: runRow, error: runError } = await supabase
    .from("opportunity_ranking_runs")
    .upsert(
      {
        user_id: userId,
        run_date: runDate,
        event_date_from: scope.eventDateFrom,
        event_date_to: scope.eventDateTo,
        sport_scope: scope.sport,
        league_scope: scope.league,
        market_scope: scope.market,
        scope_key: scope.scopeKey,
        source_stage: "pre_ai_shortlist",
        status: "computed",
        max_final_picks: MAX_FINAL_OPPORTUNITIES,
        candidate_count: candidates.length,
        confirmed_ia_count: 0,
        top_final_count: 0,
        filters_payload: filtersPayload as Json,
        score_weights: PRELIMINARY_SCORE_WEIGHTS as unknown as Json,
        metadata: {
          limit,
          total_eligible_before_grouping: allEligibleCandidates.length,
          max_theses_per_event: MAX_PRE_AI_THESES_PER_EVENT,
          generated_from: "validacao_critica_pendentes",
          generated_at: new Date().toISOString(),
        } as Json,
      },
      { onConflict: "user_id,run_date,source_stage,scope_key" },
    )
    .select("*")
    .single();
  if (runError) throw runError;
  const run = runRow as OpportunityRankingRun;

  const { error: clearMarkerError } = await supabase
    .from("prognosticos")
    .update({
      is_top_final: false,
      top_final_rank: null,
      top_final_run_id: null,
      top_final_at: null,
    })
    .eq("top_final_run_id", run.id);
  if (clearMarkerError) throw clearMarkerError;

  const { error: deleteError } = await supabase
    .from("opportunity_ranking_items")
    .delete()
    .eq("run_id", run.id);
  if (deleteError) throw deleteError;

  if (!candidates.length) return { run, items: [] };

  const payload = candidates.map((candidate, index) => ({
    run_id: run.id,
    prognostico_id: candidate.prognostico.id,
    user_id: userId,
    event_key: candidate.event_key,
    group_key: candidate.group_key,
    rank_prelim: index + 1,
    ranking_status: candidate.ranking_status,
    opportunity_score_pre: candidate.opportunity_score_pre,
    confidence_score: candidate.confidence_score,
    score_components: candidate.score_components,
    risk_flags: candidate.risk_flags,
    reasons: candidate.reasons,
    metadata: {
      esporte: candidate.prognostico.esporte,
      liga: candidate.prognostico.liga,
      mercado: candidate.prognostico.mercado,
      mercado_operacional: getOpportunityMarketLabel(candidate.prognostico),
      pick: candidate.prognostico.pick,
      pick_operacional: getOpportunityPickLabel(candidate.prognostico),
      origem: getOpportunitySourceLabel(candidate.prognostico),
      data: candidate.prognostico.data,
      hora: candidate.prognostico.hora,
      jogo: candidate.prognostico.jogo,
      thesis_group_key: candidate.group_key,
      thesis_group_size: candidate.group_size,
      alternatives: candidate.group_alternatives,
    },
  }));

  const { data: itemsRows, error: itemsError } = await supabase
    .from("opportunity_ranking_items")
    .insert(payload as unknown as never)
    .select("*")
    .order("rank_prelim", { ascending: true });
  if (itemsError) throw itemsError;

  return {
    run,
    items: (itemsRows ?? []) as OpportunityRankingItem[],
  };
}

export function buildOpportunityRankingScope(
  prognosticos: Prognostico[],
  filtersPayload: Record<string, unknown>,
): OpportunityRankingScope {
  const dates = prognosticos
    .map((item) => item.data)
    .filter(isIsoDate)
    .sort();
  const eventDateFrom = asIsoDate(filtersPayload.ini) ?? dates[0] ?? null;
  const eventDateTo = asIsoDate(filtersPayload.fim) ?? dates.at(-1) ?? null;
  const sport = resolveScopeValue(
    filtersPayload.esporte,
    prognosticos.map((item) => item.esporte),
  );
  const league = resolveScopeValue(
    filtersPayload.liga,
    prognosticos.map((item) => item.liga),
  );
  const market = resolveScopeValue(
    filtersPayload.mercado,
    prognosticos.map((item) => item.mercado),
  );
  const scopeKey = [eventDateFrom ?? "all", eventDateTo ?? "all", sport, league, market]
    .map(normalizeKeyPart)
    .join("|");

  return { eventDateFrom, eventDateTo, sport, league, market, scopeKey };
}

function resolveScopeValue(filterValue: unknown, values: string[]): string {
  const filter = String(filterValue ?? "").trim();
  if (filter && filter.toLowerCase() !== "all") return filter;

  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return uniqueValues.length === 1 ? uniqueValues[0] : "all";
}

function asIsoDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return isIsoDate(text) ? text : null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeRankingStatus(value: unknown): OpportunityRankingStatus {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (
    raw === "CANDIDATA" ||
    raw === "CONFIRMA_IA" ||
    raw === "TOP_FINAL" ||
    raw === "RESERVA" ||
    raw === "PULAR" ||
    raw === "BLOQUEADA"
  ) {
    return raw;
  }
  return "CANDIDATA";
}

export function buildOpportunityEventKey(prognostico: Prognostico): string {
  const jogoBase =
    prognostico.jogo || `${prognostico.mandante ?? ""} vs ${prognostico.visitante ?? ""}`;
  const mandante = prognostico.mandante || jogoBase.split(/\s+vs\s+/i)[0] || jogoBase;
  const visitante = prognostico.visitante || jogoBase.split(/\s+vs\s+/i)[1] || "";

  return [
    prognostico.esporte,
    prognostico.liga,
    prognostico.data,
    prognostico.hora,
    mandante,
    visitante,
  ]
    .map(normalizeKeyPart)
    .join("|");
}

export function buildOpportunityGroupKey(prognostico: Prognostico): string {
  return `${buildOpportunityEventKey(prognostico)}|${getMarketFamilyKey(prognostico)}|${getSelectionSideKey(prognostico)}`;
}

export function calculatePreliminaryOpportunityScore(
  prognostico: Prognostico,
): RankedOpportunityCandidate {
  const critical = calculateCriticalShortlistScore(prognostico);
  const confidence = calculateCriticalShortlistConfidence(prognostico, critical.flags);
  const rankingStatus = classifyCriticalShortlistCandidate(
    critical.score,
    confidence,
    critical.flags,
    prognostico,
  );
  const riskFlags = critical.flags.map((flag) => flag.code);
  const rawScore = round(clamp(critical.score + critical.components.risk_penalty, 0, 100), 1);
  const score_components: OpportunityScoreComponents = {
    edge_quality_score: critical.components.value_score,
    probability_quality_score: critical.components.probability_margin_score,
    odd_quality_score: critical.components.odds_operational_score,
    value_gap_score:
      critical.valueGap != null
        ? normalizePositive(critical.valueGap, 18)
        : critical.components.value_score,
    data_quality_score: critical.components.data_readiness_score,
    model_origin_score: critical.components.source_integrity_score,
    risk_penalty: critical.components.risk_penalty,
    raw_score: rawScore,
    final_score: critical.score,
  };

  return {
    prognostico,
    event_key: buildOpportunityEventKey(prognostico),
    group_key: buildOpportunityGroupKey(prognostico),
    ranking_status: rankingStatus === "BLOQUEADA" ? "BLOQUEADA" : "CANDIDATA",
    opportunity_score_pre: critical.score,
    confidence_score: confidence,
    score_components,
    risk_flags: riskFlags,
    reasons: buildPreliminaryReasonsFromCritical(prognostico, critical),
    group_size: 1,
    group_alternatives: [],
  };
}

export function buildPreAiShortlist(
  prognosticos: Prognostico[],
  limit = DEFAULT_PRE_AI_SHORTLIST_LIMIT,
): RankedOpportunityCandidate[] {
  return selectDiversifiedPreAiShortlist(buildEligiblePreAiCandidates(prognosticos), limit);
}

function buildEligiblePreAiCandidates(prognosticos: Prognostico[]): RankedOpportunityCandidate[] {
  return prognosticos
    .filter((p) => p.resultado === "PENDENTE" && p.status_validacao === "PENDENTE")
    .map(calculatePreliminaryOpportunityScore)
    .filter((item) => item.ranking_status !== "BLOQUEADA")
    .sort(comparePreliminaryCandidates);
}

function selectDiversifiedPreAiShortlist(
  candidates: RankedOpportunityCandidate[],
  limit: number,
): RankedOpportunityCandidate[] {
  const representatives = Array.from(groupCandidatesByThesis(candidates).values())
    .map((group) => buildThesisRepresentative(group))
    .sort(comparePreliminaryCandidates);
  const eventCounts = new Map<string, number>();
  const selected: RankedOpportunityCandidate[] = [];

  for (const candidate of representatives) {
    if (selected.length >= limit) break;
    const count = eventCounts.get(candidate.event_key) ?? 0;
    if (count >= MAX_PRE_AI_THESES_PER_EVENT) continue;
    selected.push(candidate);
    eventCounts.set(candidate.event_key, count + 1);
  }

  return selected;
}

function groupCandidatesByThesis(
  candidates: RankedOpportunityCandidate[],
): Map<string, RankedOpportunityCandidate[]> {
  const groups = new Map<string, RankedOpportunityCandidate[]>();
  for (const candidate of candidates) {
    const existing = groups.get(candidate.group_key);
    if (existing) existing.push(candidate);
    else groups.set(candidate.group_key, [candidate]);
  }
  return groups;
}

function buildThesisRepresentative(
  group: RankedOpportunityCandidate[],
): RankedOpportunityCandidate {
  const sorted = group.slice().sort(comparePreliminaryCandidates);
  const [best, ...alternatives] = sorted;
  return {
    ...best,
    group_size: sorted.length,
    group_alternatives: alternatives.map(candidateToAlternative),
    reasons: [
      ...best.reasons,
      ...(alternatives.length
        ? [
            `${alternatives.length} opção(ões) correlacionada(s) agrupada(s) como alternativas desta tese.`,
          ]
        : []),
    ],
  };
}

function candidateToAlternative(
  candidate: RankedOpportunityCandidate,
): RankedOpportunityAlternative {
  return {
    prognostico_id: candidate.prognostico.id,
    mercado: getOpportunityMarketLabel(candidate.prognostico),
    pick: getOpportunityPickLabel(candidate.prognostico),
    odd_ofertada: getOddEfetiva(candidate.prognostico),
    edge: getEdgeEfetivo(candidate.prognostico),
    opportunity_score_pre: candidate.opportunity_score_pre,
    confidence_score: candidate.confidence_score,
  };
}

function comparePreliminaryCandidates(
  a: RankedOpportunityCandidate,
  b: RankedOpportunityCandidate,
): number {
  return (
    b.opportunity_score_pre - a.opportunity_score_pre ||
    b.confidence_score - a.confidence_score ||
    getEdgeEfetivo(b.prognostico) - getEdgeEfetivo(a.prognostico) ||
    getOddEfetiva(b.prognostico) - getOddEfetiva(a.prognostico)
  );
}

function buildPreliminaryReasonsFromCritical(
  prognostico: Prognostico,
  critical: ReturnType<typeof calculateCriticalShortlistScore>,
): string[] {
  const reasons = [
    `Score preliminar neutro ${critical.score.toFixed(1)} com edge efetivo ${(critical.effectiveEdge ?? getEdgeEfetivo(prognostico)).toFixed(2)}%.`,
    `Probabilidade implicita ${formatNumber(critical.impliedProbability)}% e margem ${formatNumber(critical.probabilityMargin)} p.p.`,
    `Odd efetiva ${getOddEfetiva(prognostico).toFixed(2)} contra odd de valor ${prognostico.odd_valor.toFixed(2)}.`,
  ];
  if (critical.valueGap != null)
    reasons.push(`Gap de valor da odd: ${critical.valueGap.toFixed(2)}%.`);
  if (getDadosTecnicos(prognostico)?.trim()) {
    reasons.push("Contexto tecnico do modelo disponivel para enriquecimento/IA.");
  }
  if (critical.missingFields.length) {
    reasons.push(`Campos a revisar antes da IA: ${critical.missingFields.join(", ")}.`);
  }
  return reasons;
}

export function validateGenericMatchupPreview(
  prognostico: Prognostico,
  rawPreviewText: string,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalizedRaw = normalizePreviewComparable(rawPreviewText);
  const home = prognostico.mandante?.trim() || prognostico.jogo.split(/\s+vs\s+/i)[0]?.trim();
  const away = prognostico.visitante?.trim() || prognostico.jogo.split(/\s+vs\s+/i)[1]?.trim();

  if (!home || !previewContainsTeam(normalizedRaw, home)) {
    errors.push(
      `Preview rejeitado: o mandante "${home || "nao identificado"}" nao foi encontrado.`,
    );
  }
  if (!away || !previewContainsTeam(normalizedRaw, away)) {
    errors.push(
      `Preview rejeitado: o visitante "${away || "nao identificado"}" nao foi encontrado.`,
    );
  }

  const lines = rawPreviewText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const dateLines = lines.filter(
    (line, index) =>
      index < 8 || /\b(data|date|horario|horário|kickoff|inicio|início)\b/i.test(line),
  );
  const previewDates = new Set(dateLines.flatMap(extractCanonicalDates));
  const eventDate = canonicalDate(prognostico.data);
  if (previewDates.size && eventDate && !previewDates.has(eventDate)) {
    errors.push(`Preview rejeitado: a data informada nao corresponde ao evento ${eventDate}.`);
  } else if (!previewDates.size) {
    warnings.push("Data do evento nao identificada no texto colado.");
  }

  const leagueLines = lines.filter((line) =>
    /\b(liga|league|competicao|competição|competition)\b/i.test(line),
  );
  if (leagueLines.length) {
    const leagueText = normalizePreviewComparable(leagueLines.join(" "));
    const leagueTokens = significantPreviewTokens(prognostico.liga).filter(
      (token) => !["league", "liga", "serie", "division", "football", "futebol"].includes(token),
    );
    if (leagueTokens.length && !leagueTokens.some((token) => leagueText.includes(token))) {
      errors.push(`Preview rejeitado: a liga informada nao corresponde a "${prognostico.liga}".`);
    }
  } else {
    warnings.push("Liga do evento nao identificada no texto colado.");
  }

  return { errors, warnings };
}

function normalizePreviewComparable(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantPreviewTokens(value: unknown): string[] {
  const ignored = new Set(["fc", "cf", "sc", "ac", "ec", "afc", "club", "clube", "de", "da", "do"]);
  return normalizePreviewComparable(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !ignored.has(token));
}

function previewContainsTeam(normalizedRaw: string, team: string): boolean {
  const normalizedTeam = normalizePreviewComparable(team);
  if (normalizedTeam && normalizedRaw.includes(normalizedTeam)) return true;
  const tokens = significantPreviewTokens(team);
  if (!tokens.length) return false;
  const matches = tokens.filter((token) => normalizedRaw.includes(token)).length;
  return matches >= Math.max(1, Math.ceil(tokens.length * 0.75));
}

function canonicalDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  let match = raw.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return null;
}

function extractCanonicalDates(value: string): string[] {
  const matches =
    value.match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/g) ?? [];
  return matches.map(canonicalDate).filter((date): date is string => Boolean(date));
}

function isMlbPrognostico(prognostico: Prognostico): boolean {
  return /baseball/i.test(prognostico.esporte) || /\bMLB\b/i.test(prognostico.liga);
}

function normalizeValidationDecision(value: unknown): "CONFIRMA" | "PULAR" {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  return raw === "CONFIRMA" || raw === "CONFIRMAR" ? "CONFIRMA" : "PULAR";
}

function numericOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function formatStarter(starter: {
  name?: string | null;
  throwing_hand?: string | null;
  era?: number | null;
  k_per_9?: number | null;
}) {
  return `${starter.name ?? "-"} ${starter.throwing_hand ?? ""} ERA ${starter.era ?? "-"} K/9 ${starter.k_per_9 ?? "-"}`.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatNumber(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? value.toFixed(2) : "-";
}

function getMarketFamilyKey(prognostico: Prognostico): string {
  const mercado = normalizeKeyPart(
    `${getOpportunityMarketLabel(prognostico)} ${getOpportunityPickLabel(prognostico)}`,
  );
  if (/player prop|props|jogador|rebotes|assistencias|pra\b/.test(mercado)) return "player-props";
  if (/escanteio|corner/.test(mercado)) return "escanteios";
  if (/handicap|spread|run line|asian/.test(mercado)) return "handicap-spread";
  if (/overunder|over under|total|over\b|under\b|gols|pontos|corridas|runs/.test(mercado))
    return "totais";
  if (/dupla chance|duplachance|double chance|doublechance/.test(mercado)) return "dupla-chance";
  if (/moneyline|backmatrix|1x2|resultado final|resultadofinal|vencedor/.test(mercado))
    return "resultado";
  return `mercado:${normalizeKeyPart(getOpportunityMarketLabel(prognostico))}`;
}

function getSelectionSideKey(prognostico: Prognostico): string {
  const marketFamily = getMarketFamilyKey(prognostico);
  const pick = normalizeKeyPart(getOpportunityPickLabel(prognostico));
  const pickWithoutNumbers = pick
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, " ")
    .replace(/\bmeio\b|\bhalf\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (marketFamily === "totais") {
    if (/\bover\b|\bmais\b|acima/.test(pick)) return "over";
    if (/\bunder\b|\bmenos\b|abaixo/.test(pick)) return "under";
  }

  if (marketFamily === "handicap-spread") {
    return pickWithoutNumbers || "handicap-side";
  }

  if (marketFamily === "resultado" || marketFamily === "dupla-chance") {
    return pickWithoutNumbers || "resultado-side";
  }

  if (marketFamily === "escanteios" || marketFamily === "player-props") {
    return pickWithoutNumbers || marketFamily;
  }

  return pickWithoutNumbers || "default-side";
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizePositive(value: number | null, cap: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  return round(clamp(value / cap, 0, 1) * 100, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
