import type { Database } from "@/integrations/supabase/types";

type AnaliseIaRow = Database["public"]["Tables"]["analises_ia"]["Row"];
type FeedbackIaRow = Database["public"]["Tables"]["feedback_ia_resultados"]["Row"];

export type AiObservabilityRun = Pick<
  AnaliseIaRow,
  | "id"
  | "run_id"
  | "created_at"
  | "modo_ia"
  | "esporte"
  | "liga"
  | "prompt_versao"
  | "schema_version"
  | "arbiter_version"
  | "provider"
  | "model_id"
  | "latency_ms"
  | "finish_reason"
  | "total_tokens"
  | "parse_status"
  | "error_code"
  | "model_decision"
  | "final_decision"
  | "blocking_codes"
  | "repair_attempted"
  | "rollout_stage"
  | "rollout_variant"
  | "rollout_reason"
  | "search_count"
  | "scrape_count"
  | "source_count"
>;

export type AiObservabilityFeedback = Pick<
  FeedbackIaRow,
  | "analise_ia_id"
  | "modo_ia"
  | "esporte"
  | "decisao_ia_sugerida"
  | "decisao_humana_final"
  | "divergencia_ia_humano"
  | "resultado_teorico"
  | "stake_ia_sugerida"
  | "lucro_teorico_unidades"
  | "acertou_ia"
  | "created_at"
>;

export interface AiObservabilitySummary {
  totalRuns: number;
  instrumentedRuns: number;
  telemetryCoverageRate: number | null;
  validSchemaRate: number | null;
  failedSchemaRuns: number;
  arbiterBlockedConfirmations: number;
  errorRate: number | null;
  repairRate: number | null;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  totalTokens: number;
  averageTokens: number | null;
  divergenceRate: number | null;
  feedbackSample: number;
  onlineRuns: number;
  onlineRunsWithSources: number;
  onlineSourceCoverageRate: number | null;
  averageSourcesPerOnlineRun: number | null;
}

export interface AiObservabilityDailyPoint {
  date: string;
  runs: number;
  valid: number;
  errors: number;
  blocked: number;
  p95LatencyMs: number | null;
}

export interface AiObservabilityDimensionRow {
  key: string;
  modelId: string;
  promptVersion: string;
  mode: string;
  sport: string;
  rolloutStage: string;
  rolloutVariant: string;
  runs: number;
  validSchemaRate: number | null;
  errorRate: number | null;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  averageTokens: number | null;
  feedbackSample: number;
  divergenceRate: number | null;
  aiAccuracyRate: number | null;
  greens: number;
  reds: number;
  theoreticalProfitUnits: number;
  theoreticalRoi: number | null;
}

export interface AiObservabilityBlockerRow {
  code: string;
  count: number;
}

export interface AiObservabilityFailureRow {
  runId: string;
  createdAt: string;
  modelId: string;
  mode: string;
  sport: string;
  parseStatus: string;
  errorCode: string;
}

export interface AiObservabilityDashboard {
  summary: AiObservabilitySummary;
  daily: AiObservabilityDailyPoint[];
  dimensions: AiObservabilityDimensionRow[];
  blockers: AiObservabilityBlockerRow[];
  recentFailures: AiObservabilityFailureRow[];
}

const fallbackLabel = (value: string | null | undefined, fallback: string) =>
  value?.trim() || fallback;

const rate = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

const average = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const bounded = Math.min(1, Math.max(0, percentileValue));
  const index = Math.ceil(bounded * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? null;
}

function isInstrumented(run: AiObservabilityRun) {
  return run.parse_status != null;
}

function isBlockedConfirmation(run: AiObservabilityRun) {
  return run.model_decision === "CONFIRMA" && run.final_decision === "PULAR";
}

function dimensionKey(run: AiObservabilityRun) {
  return [
    fallbackLabel(run.model_id, "Modelo não informado"),
    fallbackLabel(run.prompt_versao, "Prompt não informado"),
    fallbackLabel(run.modo_ia, "Modo não informado"),
    fallbackLabel(run.esporte, "Esporte não informado"),
    fallbackLabel(run.rollout_stage, "Pré-Fase 6"),
    fallbackLabel(run.rollout_variant, "Contrato não informado"),
  ].join("\u001f");
}

export function buildAiObservabilityDashboard(
  runs: AiObservabilityRun[],
  feedback: AiObservabilityFeedback[],
): AiObservabilityDashboard {
  const instrumented = runs.filter(isInstrumented);
  const latencies = instrumented
    .map((run) => run.latency_ms)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const tokenValues = instrumented
    .map((run) => run.total_tokens)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const evaluatedFeedback = feedback.filter((row) => row.divergencia_ia_humano != null);
  const onlineRuns = instrumented.filter((run) => run.modo_ia === "online");
  const onlineSourceValues = onlineRuns.map((run) => run.source_count);

  const summary: AiObservabilitySummary = {
    totalRuns: runs.length,
    instrumentedRuns: instrumented.length,
    telemetryCoverageRate: rate(instrumented.length, runs.length),
    validSchemaRate: rate(
      instrumented.filter((run) => run.parse_status === "VALID").length,
      instrumented.length,
    ),
    failedSchemaRuns: instrumented.filter((run) => run.parse_status !== "VALID").length,
    arbiterBlockedConfirmations: instrumented.filter(isBlockedConfirmation).length,
    errorRate: rate(
      instrumented.filter((run) => run.error_code != null).length,
      instrumented.length,
    ),
    repairRate: rate(
      instrumented.filter((run) => run.repair_attempted).length,
      instrumented.length,
    ),
    averageLatencyMs: average(latencies),
    p95LatencyMs: percentile(latencies, 0.95),
    totalTokens: tokenValues.reduce((sum, value) => sum + value, 0),
    averageTokens: average(tokenValues),
    divergenceRate: rate(
      evaluatedFeedback.filter((row) => row.divergencia_ia_humano === true).length,
      evaluatedFeedback.length,
    ),
    feedbackSample: evaluatedFeedback.length,
    onlineRuns: onlineRuns.length,
    onlineRunsWithSources: onlineRuns.filter((run) => run.source_count > 0).length,
    onlineSourceCoverageRate: rate(
      onlineRuns.filter((run) => run.source_count > 0).length,
      onlineRuns.length,
    ),
    averageSourcesPerOnlineRun: average(onlineSourceValues),
  };

  const dailyBuckets = new Map<
    string,
    { runs: number; valid: number; errors: number; blocked: number; latencies: number[] }
  >();
  for (const run of instrumented) {
    const date = run.created_at.slice(0, 10);
    const bucket = dailyBuckets.get(date) ?? {
      runs: 0,
      valid: 0,
      errors: 0,
      blocked: 0,
      latencies: [],
    };
    bucket.runs += 1;
    if (run.parse_status === "VALID") bucket.valid += 1;
    if (run.error_code != null) bucket.errors += 1;
    if (isBlockedConfirmation(run)) bucket.blocked += 1;
    if (run.latency_ms != null && Number.isFinite(run.latency_ms)) {
      bucket.latencies.push(run.latency_ms);
    }
    dailyBuckets.set(date, bucket);
  }
  const daily = [...dailyBuckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, bucket]) => ({
      date,
      runs: bucket.runs,
      valid: bucket.valid,
      errors: bucket.errors,
      blocked: bucket.blocked,
      p95LatencyMs: percentile(bucket.latencies, 0.95),
    }));

  const feedbackByAnalysis = new Map<string, AiObservabilityFeedback[]>();
  for (const row of feedback) {
    if (!row.analise_ia_id) continue;
    const rows = feedbackByAnalysis.get(row.analise_ia_id) ?? [];
    rows.push(row);
    feedbackByAnalysis.set(row.analise_ia_id, rows);
  }

  const dimensionBuckets = new Map<string, AiObservabilityRun[]>();
  for (const run of instrumented) {
    const key = dimensionKey(run);
    const rows = dimensionBuckets.get(key) ?? [];
    rows.push(run);
    dimensionBuckets.set(key, rows);
  }
  const dimensions = [...dimensionBuckets.entries()]
    .map(([key, dimensionRuns]): AiObservabilityDimensionRow => {
      const sampleRun = dimensionRuns[0];
      const dimensionFeedback = dimensionRuns.flatMap(
        (run) => feedbackByAnalysis.get(run.id) ?? [],
      );
      const evaluatedDivergence = dimensionFeedback.filter(
        (row) => row.divergencia_ia_humano != null,
      );
      const evaluatedAccuracy = dimensionFeedback.filter((row) => row.acertou_ia != null);
      const settled = dimensionFeedback.filter(
        (row) => row.resultado_teorico === "GREEN" || row.resultado_teorico === "RED",
      );
      const roiEligible = settled.filter(
        (row) =>
          row.stake_ia_sugerida != null &&
          Number.isFinite(row.stake_ia_sugerida) &&
          row.stake_ia_sugerida > 0 &&
          row.lucro_teorico_unidades != null &&
          Number.isFinite(row.lucro_teorico_unidades),
      );
      const totalStake = roiEligible.reduce((sum, row) => sum + (row.stake_ia_sugerida ?? 0), 0);
      const profit = roiEligible.reduce((sum, row) => sum + (row.lucro_teorico_unidades ?? 0), 0);
      const dimensionLatencies = dimensionRuns
        .map((run) => run.latency_ms)
        .filter((value): value is number => value != null && Number.isFinite(value));
      const dimensionTokens = dimensionRuns
        .map((run) => run.total_tokens)
        .filter((value): value is number => value != null && Number.isFinite(value));

      return {
        key,
        modelId: fallbackLabel(sampleRun.model_id, "Modelo não informado"),
        promptVersion: fallbackLabel(sampleRun.prompt_versao, "Prompt não informado"),
        mode: fallbackLabel(sampleRun.modo_ia, "Modo não informado"),
        sport: fallbackLabel(sampleRun.esporte, "Esporte não informado"),
        rolloutStage: fallbackLabel(sampleRun.rollout_stage, "Pré-Fase 6"),
        rolloutVariant: fallbackLabel(sampleRun.rollout_variant, "Contrato não informado"),
        runs: dimensionRuns.length,
        validSchemaRate: rate(
          dimensionRuns.filter((run) => run.parse_status === "VALID").length,
          dimensionRuns.length,
        ),
        errorRate: rate(
          dimensionRuns.filter((run) => run.error_code != null).length,
          dimensionRuns.length,
        ),
        averageLatencyMs: average(dimensionLatencies),
        p95LatencyMs: percentile(dimensionLatencies, 0.95),
        averageTokens: average(dimensionTokens),
        feedbackSample: settled.length,
        divergenceRate: rate(
          evaluatedDivergence.filter((row) => row.divergencia_ia_humano === true).length,
          evaluatedDivergence.length,
        ),
        aiAccuracyRate: rate(
          evaluatedAccuracy.filter((row) => row.acertou_ia === true).length,
          evaluatedAccuracy.length,
        ),
        greens: settled.filter((row) => row.resultado_teorico === "GREEN").length,
        reds: settled.filter((row) => row.resultado_teorico === "RED").length,
        theoreticalProfitUnits: profit,
        theoreticalRoi: totalStake > 0 ? (profit / totalStake) * 100 : null,
      };
    })
    .sort((left, right) => right.runs - left.runs || left.key.localeCompare(right.key));

  const blockerCounts = new Map<string, number>();
  for (const run of instrumented) {
    for (const code of new Set(run.blocking_codes)) {
      blockerCounts.set(code, (blockerCounts.get(code) ?? 0) + 1);
    }
  }
  const blockers = [...blockerCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

  const recentFailures = instrumented
    .filter((run) => run.parse_status !== "VALID" || run.error_code != null)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 20)
    .map((run) => ({
      runId: run.run_id,
      createdAt: run.created_at,
      modelId: fallbackLabel(run.model_id, "Modelo não informado"),
      mode: fallbackLabel(run.modo_ia, "Modo não informado"),
      sport: fallbackLabel(run.esporte, "Esporte não informado"),
      parseStatus: fallbackLabel(run.parse_status, "SEM TELEMETRIA"),
      errorCode: fallbackLabel(run.error_code, "SEM_CODIGO"),
    }));

  return { summary, daily, dimensions, blockers, recentFailures };
}
