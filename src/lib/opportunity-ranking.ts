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
import {
  calculateCriticalShortlistConfidence,
  calculateCriticalShortlistScore,
  classifyCriticalShortlistCandidate,
} from "@/lib/critical-validation/critical-shortlist-ranking";

export const MAX_FINAL_OPPORTUNITIES = 3;
export const DEFAULT_PRE_AI_SHORTLIST_LIMIT = 12;
export const PRELIMINARY_SCORE_WEIGHTS = {
  valueScore: 0.38,
  probabilityMarginScore: 0.24,
  dataReadinessScore: 0.20,
  marketRiskScore: 0.10,
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

export function getOpportunityMarketLabel(prognostico: Pick<Prognostico, "mercado" | "pick">) {
  if (!isSourceOnlyMarket(prognostico.mercado)) return prognostico.mercado;
  const [market] = splitCompoundPick(prognostico.pick);
  return market || "Mercado do modelo";
}

export function getOpportunityPickLabel(prognostico: Pick<Prognostico, "mercado" | "pick">) {
  if (!isSourceOnlyMarket(prognostico.mercado)) return prognostico.pick;
  const [, pick] = splitCompoundPick(prognostico.pick);
  return pick || prognostico.pick;
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

export function useGeneratePreAiOpportunityShortlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generateAndPersistPreAiOpportunityShortlist,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunity-ranking"] });
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
    },
  });
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
    throw new Error("Cole o Matchups/Preview antes de enriquecer a oportunidade.");
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

  const warnings = parsedContext?.data_quality?.warnings ?? [];
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
    "[PROGNOSTICO]",
    `Mercado: ${getOpportunityMarketLabel(prognostico)}`,
    `Pick: ${getOpportunityPickLabel(prognostico)}${prognostico.linha ? ` ${prognostico.linha}` : ""}`,
    `Origem: ${getOpportunitySourceLabel(prognostico)}`,
    `Odd ofertada: ${formatNumber(prognostico.odd_ofertada)}`,
    `Odd valor: ${formatNumber(prognostico.odd_valor)}`,
    `Probabilidade: ${formatNumber(prognostico.probabilidade_final)}%`,
    `Edge: ${formatNumber(getEdgeEfetivo(prognostico))}%`,
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
  const confirmed = ((rows ?? []) as OpportunityRankingItem[])
    .map((item) => ({
      item,
      finalScore: calculateFinalOpportunityScore(item),
    }))
    .sort(
      (a, b) =>
        b.finalScore - a.finalScore ||
        numericOrZero(b.item.confidence_score) - numericOrZero(a.item.confidence_score) ||
        numericOrZero(b.item.opportunity_score_pre) - numericOrZero(a.item.opportunity_score_pre),
    );

  await Promise.all(
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

function calculateFinalOpportunityScore(item: OpportunityRankingItem): number {
  const preScore = numericOrZero(item.opportunity_score_pre);
  const confidence = numericOrZero(item.confidence_score);
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

  const candidates = buildPreAiShortlist(prognosticos, limit);
  const { data: runRow, error: runError } = await supabase
    .from("opportunity_ranking_runs")
    .upsert(
      {
        user_id: userId,
        run_date: runDate,
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
          generated_from: "validacao_critica_pendentes",
          generated_at: new Date().toISOString(),
        } as Json,
      },
      { onConflict: "user_id,run_date,source_stage" },
    )
    .select("*")
    .single();
  if (runError) throw runError;
  const run = runRow as OpportunityRankingRun;

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
  return `${buildOpportunityEventKey(prognostico)}|${getMarketFamilyKey(prognostico)}`;
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
  const rawScore = round(
    clamp(critical.score + critical.components.risk_penalty, 0, 100),
    1,
  );
  const score_components: OpportunityScoreComponents = {
    edge_quality_score: critical.components.value_score,
    probability_quality_score: critical.components.probability_margin_score,
    odd_quality_score: critical.components.odds_operational_score,
    value_gap_score: critical.valueGap != null ? normalizePositive(critical.valueGap, 18) : critical.components.value_score,
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
  };
}

export function buildPreAiShortlist(
  prognosticos: Prognostico[],
  limit = DEFAULT_PRE_AI_SHORTLIST_LIMIT,
): RankedOpportunityCandidate[] {
  return prognosticos
    .filter((p) => p.resultado === "PENDENTE" && p.status_validacao === "PENDENTE")
    .map(calculatePreliminaryOpportunityScore)
    .filter((item) => item.ranking_status !== "BLOQUEADA")
    .sort(comparePreliminaryCandidates)
    .slice(0, limit);
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
  if (critical.valueGap != null) reasons.push(`Gap de valor da odd: ${critical.valueGap.toFixed(2)}%.`);
  if (getDadosTecnicos(prognostico)?.trim()) {
    reasons.push("Contexto tecnico do modelo disponivel para enriquecimento/IA.");
  }
  if (critical.missingFields.length) {
    reasons.push(`Campos a revisar antes da IA: ${critical.missingFields.join(", ")}.`);
  }
  return reasons;
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
  const mercado = normalizeKeyPart(getOpportunityMarketLabel(prognostico));
  if (
    /moneyline|1x2|resultado final|resultadofinal|vencedor|handicap|dupla chance|duplachance|double chance|doublechance/.test(
      mercado,
    )
  ) {
    return "resultado-protecao";
  }
  if (/overunder|over under|total/.test(mercado)) return "totais";
  return `mercado:${mercado}`;
}

function isSourceOnlyMarket(value: string): boolean {
  return /asp screener/i.test(value);
}

function splitCompoundPick(value: string): [string, string] {
  const parts = value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return ["", value.trim()];
  return [parts[0], parts.slice(1).join(" | ")];
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
