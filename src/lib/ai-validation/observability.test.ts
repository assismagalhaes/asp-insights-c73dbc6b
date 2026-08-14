import { describe, expect, it } from "vitest";
import type { ArbitratedAiValidation } from "./types";
import { AI_ARBITER_VERSION, buildAiObservabilitySnapshot, sumAiTokenUsage } from "./observability";

function arbitration(overrides: Partial<ArbitratedAiValidation> = {}): ArbitratedAiValidation {
  const gate = { status: "UNKNOWN" as const, reason: "Fixture." };
  return {
    status: "BLOCKED",
    model_output: null,
    blocks: [{ code: "SCHEMA_INVALID", reason: "Schema inválido." }],
    output: {
      schema_version: "1.1.0",
      decision: "PULAR",
      stake: 0,
      selected_prediction_id: null,
      selected_pick: null,
      gates: {
        technical_consistency: gate,
        critical_information: gate,
        structural_risk: gate,
        context: gate,
        correlation: gate,
      },
      narrative: {
        evaluated_entry: "Entrada indisponível.",
        thesis_for: "Indisponível.",
        thesis_against: "Indisponível.",
        internal_history: "Indisponível.",
        final_justification: "Falha segura.",
        decision_change_condition: null,
      },
      rationale: "Falha segura.",
      risks: ["Contrato inválido."],
      invalidation_condition: "Gerar novamente.",
      limitations: ["Schema inválido."],
      sources: [],
      searches: [],
    },
    ...overrides,
  };
}

describe("observabilidade da validação IA", () => {
  it("soma o uso de tokens da geração inicial e do reparo", () => {
    expect(
      sumAiTokenUsage(
        { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        { inputTokens: 140, outputTokens: 30, totalTokens: 170 },
      ),
    ).toEqual({
      inputTokens: 240,
      outputTokens: 50,
      totalTokens: 290,
    });
  });

  it("preserva null quando o Gateway não informa tokens", () => {
    expect(sumAiTokenUsage(undefined, {})).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });

  it("registra falha do provider separada da decisão final segura", () => {
    const snapshot = buildAiObservabilitySnapshot({
      telemetry: {
        run_id: "7e464ea4-ad67-4e53-a3d8-99f9c1ad1a6d",
        provider: "google-ai-studio",
        model: "gemini-3.6-flash",
        started_at: "2026-07-24T12:00:00.000Z",
        finished_at: "2026-07-24T12:00:03.000Z",
        latency_ms: 3_000,
        parse_status: "FAILED",
        error_code: "PROVIDER_TIMEOUT",
        repair_attempted: false,
      },
      arbitration: arbitration(),
    });

    expect(snapshot).toMatchObject({
      schema_version: "1.1.0",
      arbiter_version: AI_ARBITER_VERSION,
      model_decision: null,
      final_decision: "PULAR",
      parse_status: "FAILED",
      error_code: "PROVIDER_TIMEOUT",
      blocking_codes: ["SCHEMA_INVALID", "PROVIDER_TIMEOUT"],
      latency_ms: 3_000,
      input_tokens: null,
    });
  });

  it("conta buscas, fontes e scrapes reais no modo online", () => {
    const snapshot = buildAiObservabilitySnapshot({
      telemetry: {
        run_id: "33a21da4-65da-45e7-90d9-adf7f58b0bd5",
        parse_status: "VALID",
        usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
        repair_attempted: true,
        rollout_stage: "canary",
        rollout_variant: "structured",
        rollout_reason: "canary_allowlist",
      },
      arbitration: arbitration({
        status: "APPROVED",
        blocks: [],
      }),
      searches: ["starter confirmado", "clima do jogo"],
      sourceTraces: [{ consultada: false }, { consultada: true }, { consultada: true }],
    });

    expect(snapshot).toMatchObject({
      search_count: 2,
      source_count: 3,
      scrape_count: 2,
      repair_attempted: true,
      rollout_stage: "canary",
      rollout_variant: "structured",
      rollout_reason: "canary_allowlist",
      input_tokens: 500,
      output_tokens: 200,
      total_tokens: 700,
    });
  });
});
