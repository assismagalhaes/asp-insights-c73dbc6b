import { describe, expect, it } from "vitest";
import { AiLocalGenerationOutputSchema, AiOperationalOutputSchema } from "./ai-validation/schema";
import {
  LOCAL_GATEWAY_JSON_TEMPLATE,
  LOCAL_GATEWAY_MODEL_ID,
  LOCAL_REPAIR_MODEL_ID,
  parseLocalGatewayJson,
} from "./validacao-ia.functions";

describe("configuração do Structured Output local", () => {
  it("usa o Lovable AI Gateway com Gemini 3.6 Flash", () => {
    expect(LOCAL_GATEWAY_MODEL_ID).toBe("google/gemini-3.6-flash");
    expect(LOCAL_REPAIR_MODEL_ID).toBe("google/gemini-2.5-flash");
    expect(parseLocalGatewayJson(LOCAL_GATEWAY_JSON_TEMPLATE)).toMatchObject({
      schema_version: "1.1.0",
      decision: "PULAR",
      stake: 0,
    });
  });

  it("normaliza apenas omissões formais antes do contrato operacional estrito", () => {
    const generated = AiLocalGenerationOutputSchema.parse({
      decision: "PULAR",
      stake: 0,
      gates: Object.fromEntries(
        [
          "technical_consistency",
          "critical_information",
          "structural_risk",
          "context",
          "correlation",
        ].map((gate) => [gate, { status: "APPROVED", reason: "Motivo concreto." }]),
      ),
      narrative: {
        evaluated_entry: "Entrada",
        thesis_for: "Tese favorável",
        thesis_against: "Tese contrária",
        internal_history: "Histórico",
        final_justification: "Justificativa",
      },
      rationale: "Síntese",
      invalidation_condition: "Condição",
    });

    expect(generated).toMatchObject({
      schema_version: "1.1.0",
      selected_prediction_id: null,
      selected_pick: null,
      risks: [],
      limitations: [],
      sources: [],
      searches: [],
    });
    expect(AiOperationalOutputSchema.safeParse(generated).success).toBe(true);
  });

  it("extrai e valida JSON cercado por markdown retornado pelo Gateway", () => {
    const output = {
      decision: "PULAR",
      stake: 0,
      gates: Object.fromEntries(
        [
          "technical_consistency",
          "critical_information",
          "structural_risk",
          "context",
          "correlation",
        ].map((gate) => [gate, { status: "APPROVED", reason: "Motivo concreto." }]),
      ),
      narrative: {
        evaluated_entry: "Entrada",
        thesis_for: "Tese favorável",
        thesis_against: "Tese contrária",
        internal_history: "Histórico",
        final_justification: "Justificativa",
      },
      rationale: "Síntese",
      invalidation_condition: "Condição",
    };

    expect(parseLocalGatewayJson(`\`\`\`json\n${JSON.stringify(output)}\n\`\`\``)).toMatchObject({
      decision: "PULAR",
      schema_version: "1.1.0",
      sources: [],
      searches: [],
    });
  });

  it("rejeita aliases narrativos antes do contrato operacional", () => {
    const invalid = JSON.parse(LOCAL_GATEWAY_JSON_TEMPLATE) as Record<string, unknown>;
    invalid.decision = "CONFIRMAR";

    expect(() => parseLocalGatewayJson(JSON.stringify(invalid))).toThrow();
  });

  it("identifica saída inicial vazia antes do reparo", () => {
    expect(() => parseLocalGatewayJson("   ")).toThrow("EMPTY_INITIAL_OUTPUT");
  });
});
