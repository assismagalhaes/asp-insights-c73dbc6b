import { describe, expect, it } from "vitest";
import {
  buildAiObservabilityDashboard,
  percentile,
  type AiObservabilityFeedback,
  type AiObservabilityRun,
} from "./observability-dashboard";

function run(
  overrides: Partial<AiObservabilityRun> & Pick<AiObservabilityRun, "id" | "run_id">,
): AiObservabilityRun {
  return {
    created_at: "2026-07-24T12:00:00.000Z",
    modo_ia: "local",
    esporte: "Baseball",
    liga: "MLB",
    prompt_versao: "prompt-v1",
    schema_version: "1.1.0",
    arbiter_version: "arbiter-v1",
    provider: "lovable",
    model_id: "google/gemini-3.6-flash",
    latency_ms: 1_000,
    finish_reason: "stop",
    total_tokens: 1_000,
    parse_status: "VALID",
    error_code: null,
    model_decision: "PULAR",
    final_decision: "PULAR",
    blocking_codes: [],
    repair_attempted: false,
    rollout_stage: "full",
    rollout_variant: "structured",
    rollout_reason: "stage_full",
    search_count: 0,
    scrape_count: 0,
    source_count: 0,
    ...overrides,
  };
}

function feedback(
  overrides: Partial<AiObservabilityFeedback> & Pick<AiObservabilityFeedback, "analise_ia_id">,
): AiObservabilityFeedback {
  return {
    modo_ia: "local",
    esporte: "Baseball",
    decisao_ia_sugerida: "CONFIRMA",
    decisao_humana_final: "PULAR",
    divergencia_ia_humano: true,
    resultado_teorico: "GREEN",
    stake_ia_sugerida: 1,
    lucro_teorico_unidades: 0.8,
    acertou_ia: true,
    created_at: "2026-07-24T18:00:00.000Z",
    ...overrides,
  };
}

describe("painel de observabilidade da validação IA", () => {
  it("calcula percentil nearest-rank sem mutar a entrada", () => {
    const values = [400, 100, 300, 200];

    expect(percentile(values, 0.95)).toBe(400);
    expect(percentile(values, 0.5)).toBe(200);
    expect(percentile([], 0.95)).toBeNull();
    expect(values).toEqual([400, 100, 300, 200]);
  });

  it("separa cobertura histórica de validade estrutural instrumentada", () => {
    const dashboard = buildAiObservabilityDashboard(
      [
        run({ id: "valid", run_id: "run-valid" }),
        run({
          id: "failed",
          run_id: "run-failed",
          parse_status: "FAILED",
          error_code: "SCHEMA_INVALID",
          repair_attempted: true,
          latency_ms: 3_000,
          total_tokens: 2_000,
          model_decision: "CONFIRMA",
          final_decision: "PULAR",
          blocking_codes: ["SCHEMA_INVALID", "SCHEMA_INVALID"],
        }),
        run({
          id: "legacy",
          run_id: "run-legacy",
          parse_status: null,
          schema_version: null,
          latency_ms: null,
          total_tokens: null,
        }),
      ],
      [],
    );

    expect(dashboard.summary).toMatchObject({
      totalRuns: 3,
      instrumentedRuns: 2,
      validSchemaRate: 50,
      failedSchemaRuns: 1,
      arbiterBlockedConfirmations: 1,
      errorRate: 50,
      repairRate: 50,
      averageLatencyMs: 2_000,
      p95LatencyMs: 3_000,
      totalTokens: 3_000,
      averageTokens: 1_500,
    });
    expect(dashboard.summary.telemetryCoverageRate).toBeCloseTo(200 / 3);
    expect(dashboard.blockers).toEqual([{ code: "SCHEMA_INVALID", count: 1 }]);
    expect(dashboard.recentFailures).toHaveLength(1);
  });

  it("agrega fontes online e desempenho teórico por modelo, prompt, modo e esporte", () => {
    const dashboard = buildAiObservabilityDashboard(
      [
        run({
          id: "online-green",
          run_id: "online-green-run",
          modo_ia: "online",
          source_count: 3,
          search_count: 2,
          scrape_count: 1,
        }),
        run({
          id: "online-red",
          run_id: "online-red-run",
          modo_ia: "online",
          source_count: 0,
        }),
      ],
      [
        feedback({ analise_ia_id: "online-green" }),
        feedback({
          analise_ia_id: "online-red",
          divergencia_ia_humano: false,
          resultado_teorico: "RED",
          lucro_teorico_unidades: -1,
          acertou_ia: false,
        }),
      ],
    );

    expect(dashboard.summary).toMatchObject({
      divergenceRate: 50,
      feedbackSample: 2,
      onlineRuns: 2,
      onlineRunsWithSources: 1,
      onlineSourceCoverageRate: 50,
      averageSourcesPerOnlineRun: 1.5,
    });
    expect(dashboard.dimensions).toHaveLength(1);
    expect(dashboard.dimensions[0]).toMatchObject({
      runs: 2,
      feedbackSample: 2,
      divergenceRate: 50,
      aiAccuracyRate: 50,
      greens: 1,
      reds: 1,
    });
    expect(dashboard.dimensions[0].theoreticalProfitUnits).toBeCloseTo(-0.2);
    expect(dashboard.dimensions[0].theoreticalRoi).toBeCloseTo(-10);
  });

  it("retorna taxas nulas quando não há amostra elegível", () => {
    const dashboard = buildAiObservabilityDashboard([], []);

    expect(dashboard.summary.telemetryCoverageRate).toBeNull();
    expect(dashboard.summary.validSchemaRate).toBeNull();
    expect(dashboard.summary.divergenceRate).toBeNull();
    expect(dashboard.summary.p95LatencyMs).toBeNull();
    expect(dashboard.daily).toEqual([]);
    expect(dashboard.dimensions).toEqual([]);
  });

  it("não inclui lucro sem stake positiva no ROI teórico", () => {
    const dashboard = buildAiObservabilityDashboard(
      [run({ id: "without-stake", run_id: "without-stake-run" })],
      [
        feedback({
          analise_ia_id: "without-stake",
          stake_ia_sugerida: 0,
          lucro_teorico_unidades: 10,
        }),
      ],
    );

    expect(dashboard.dimensions[0].feedbackSample).toBe(1);
    expect(dashboard.dimensions[0].theoreticalProfitUnits).toBe(0);
    expect(dashboard.dimensions[0].theoreticalRoi).toBeNull();
  });
});
