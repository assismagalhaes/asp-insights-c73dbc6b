import { describe, expect, it } from "vitest";
import {
  createAiGenerationFailure,
  createLegacyRollbackResult,
  parseStructuredAiOutput,
} from "./generation-result";
import { AI_VALIDATION_SCHEMA_VERSION, type AiOperationalOutput } from "./types";

function validOutput(): AiOperationalOutput {
  const approved = { status: "APPROVED" as const, reason: "Gate aprovado." };
  return {
    schema_version: AI_VALIDATION_SCHEMA_VERSION,
    decision: "PULAR",
    stake: 0,
    selected_prediction_id: null,
    selected_pick: null,
    gates: {
      technical_consistency: approved,
      critical_information: approved,
      structural_risk: approved,
      context: approved,
      correlation: approved,
    },
    narrative: {
      evaluated_entry: "Jogo e mercado avaliados.",
      thesis_for: "Tese favorável.",
      thesis_against: "Tese contrária.",
      internal_history: "Histórico insuficiente.",
      final_justification: "Risco acima do benefício.",
      decision_change_condition: "Mudança material no contexto.",
    },
    rationale: "Risco acima do benefício.",
    risks: ["Risco estrutural."],
    invalidation_condition: "Mudança material no contexto.",
    limitations: [],
    sources: [],
    searches: [],
  };
}

describe("resultado da geração estruturada", () => {
  it("aceita uma saída compatível com o contrato", () => {
    const output = validOutput();
    const result = parseStructuredAiOutput({ output, latencyMs: 42 });

    expect(result.parse_status).toBe("VALID");
    expect(result.model_output).toEqual(output);
    expect(result.raw_model_text).toContain('"schema_version":"1.1.0"');
    expect(result.latency_ms).toBe(42);
  });

  it("fecha como falha quando o schema é inválido", () => {
    const result = parseStructuredAiOutput({
      output: { ...validOutput(), decision: "CONFIRMAR" },
      rawModelText: '{"decision":"CONFIRMAR"}',
      latencyMs: 10,
    });

    expect(result.parse_status).toBe("FAILED");
    expect(result.model_output).toBeNull();
    expect(result.error_code).toBe("SCHEMA_INVALID");
    expect(result.parse_error).toContain("contrato 1.1.0");
  });

  it("rejeita fontes e buscas externas no modo local", () => {
    const result = parseStructuredAiOutput({
      output: {
        ...validOutput(),
        sources: [{ title: "Fonte indevida", url: "https://example.com" }],
      },
      latencyMs: 20,
    });

    expect(result.parse_status).toBe("FAILED");
    expect(result.model_output).toBeNull();
    expect(result.error_code).toBe("LOCAL_EXTERNAL_TRACE_FORBIDDEN");
  });

  it("classifica erros do provider sem expor a mensagem original", () => {
    const result = createAiGenerationFailure(
      new Error("429 RESOURCE_EXHAUSTED secret-provider-detail"),
      120,
    );

    expect(result).toMatchObject({
      model_output: null,
      parse_status: "FAILED",
      error_code: "PROVIDER_RATE_LIMIT",
      latency_ms: 120,
    });
    expect(result.parse_error).not.toContain("secret-provider-detail");
  });

  it("classifica falha de geração do objeto", () => {
    const result = createAiGenerationFailure(new Error("NoObjectGeneratedError"), 50);

    expect(result.error_code).toBe("SCHEMA_GENERATION_FAILED");
    expect(result.parse_error).toContain("contrato 1.1.0");
  });

  it("marca o parser legado somente como rollback explícito", () => {
    const output = validOutput();
    const result = createLegacyRollbackResult({
      output,
      rawModelText: "parecer legado",
      latencyMs: 8,
    });

    expect(result.parse_status).toBe("LEGACY_ROLLBACK");
    expect(result.model_output).toEqual(output);
  });
});
