import type { ArbitratedAiValidation } from "./types";

export const AI_ARBITER_VERSION = "deterministic-arbiter-v1" as const;

export type AiTokenUsageLike = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export type AiTokenUsageSnapshot = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type AiServerRunTelemetry = {
  run_id: string;
  provider?: string;
  model?: string;
  started_at?: string;
  finished_at?: string;
  latency_ms?: number;
  finish_reason?: string;
  usage?: AiTokenUsageLike;
  parse_status?: "VALID" | "FAILED" | "LEGACY_ROLLBACK";
  error_code?: string | null;
  repair_attempted?: boolean;
};

function finiteNonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function sumAiTokenUsage(
  ...usages: Array<AiTokenUsageLike | null | undefined>
): AiTokenUsageSnapshot {
  const values = usages.filter((usage): usage is AiTokenUsageLike => Boolean(usage));
  const sum = (key: keyof AiTokenUsageLike) => {
    const tokens = values
      .map((usage) => finiteNonnegative(usage[key]))
      .filter((value): value is number => value != null);
    return tokens.length ? tokens.reduce((total, value) => total + value, 0) : null;
  };
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens"),
  };
}

export function buildAiObservabilitySnapshot({
  telemetry,
  arbitration,
  sourceTraces = [],
  searches = [],
}: {
  telemetry: AiServerRunTelemetry;
  arbitration: ArbitratedAiValidation;
  sourceTraces?: Array<{ consultada?: boolean }>;
  searches?: string[];
}) {
  const blockingCodes = Array.from(
    new Set([
      ...arbitration.blocks.map((block) => block.code),
      ...(telemetry.error_code ? [telemetry.error_code] : []),
    ]),
  );
  const usage = sumAiTokenUsage(telemetry.usage);

  return {
    run_id: telemetry.run_id,
    schema_version: arbitration.output.schema_version,
    arbiter_version: AI_ARBITER_VERSION,
    provider: telemetry.provider ?? null,
    model_id: telemetry.model ?? null,
    started_at: telemetry.started_at ?? null,
    finished_at: telemetry.finished_at ?? null,
    latency_ms: finiteNonnegative(telemetry.latency_ms),
    finish_reason: telemetry.finish_reason ?? null,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    parse_status: telemetry.parse_status ?? null,
    error_code: telemetry.error_code ?? null,
    model_decision: arbitration.model_output?.decision ?? null,
    final_decision: arbitration.output.decision,
    blocking_codes: blockingCodes,
    repair_attempted: telemetry.repair_attempted ?? false,
    search_count: searches.length,
    scrape_count: sourceTraces.filter((source) => source.consultada).length,
    source_count: sourceTraces.length,
  };
}
