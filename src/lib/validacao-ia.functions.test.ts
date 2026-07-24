import { describe, expect, it } from "vitest";
import { AiLocalGenerationOutputSchema, AiOperationalOutputSchema } from "./ai-validation/schema";
import { LOCAL_STRUCTURED_OUTPUT_PROVIDER_OPTIONS } from "./validacao-ia.functions";

describe("configuração do Structured Output local", () => {
  it("não envia opções específicas de provider ao Lovable AI Gateway", () => {
    expect(LOCAL_STRUCTURED_OUTPUT_PROVIDER_OPTIONS).toEqual({
      lovable: {},
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
});
