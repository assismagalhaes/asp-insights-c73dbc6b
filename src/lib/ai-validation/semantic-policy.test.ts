import { describe, expect, it } from "vitest";
import { AI_VALIDATION_SCHEMA_VERSION, type AiOperationalOutput } from "./types";
import { applyAiSemanticPolicy } from "./semantic-policy";

function output(overrides: Partial<AiOperationalOutput> = {}): AiOperationalOutput {
  const approved = { status: "APPROVED" as const, reason: "Dados coerentes." };
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
      evaluated_entry: "Boston vs Toronto, Over 7.5.",
      thesis_for: "O edge calculado é positivo.",
      thesis_against: "Os starters reduzem a expectativa de corridas.",
      internal_history: "Histórico interno insuficiente para conclusão estatística.",
      final_justification: "Pular pelo risco estrutural.",
      decision_change_condition: "Troca de starter antes do jogo.",
    },
    rationale: "Risco estrutural elevado.",
    risks: ["Starters de alta qualidade."],
    invalidation_condition: "Troca de starter antes do jogo.",
    limitations: [],
    sources: [],
    searches: [],
    ...overrides,
  };
}

describe("política semântica da validação de IA", () => {
  it("substitui condição que depende do jogo iniciado por gatilho pré-jogo", () => {
    const result = applyAiSemanticPolicy(
      output({
        invalidation_condition:
          "A aposta fica invalidada caso o jogo permaneça zerado até a 6ª entrada.",
      }),
    );

    expect(result.invalidation_condition).toContain("pré-jogo");
    expect(result.invalidation_condition).not.toContain("6ª entrada");
    expect(result.limitations).toContain(
      "A condição de invalidação produzida pela IA dependia do jogo iniciado e foi substituída pela política pré-jogo.",
    );
  });

  it("mantém condições operacionais realmente pré-jogo", () => {
    const result = applyAiSemanticPolicy(
      output({ invalidation_condition: "Troca do starter confirmado antes do jogo." }),
    );

    expect(result.invalidation_condition).toBe("Troca do starter confirmado antes do jogo.");
    expect(result.limitations).toEqual([]);
  });

  it("move veto exclusivamente contextual do gate técnico para risco estrutural", () => {
    const result = applyAiSemanticPolicy(
      output({
        gates: {
          ...output().gates,
          technical_consistency: {
            status: "REJECTED",
            reason: "Cease e Gray são starters de alta qualidade para este total.",
          },
        },
      }),
    );

    expect(result.gates.technical_consistency.status).toBe("APPROVED");
    expect(result.gates.structural_risk).toEqual({
      status: "REJECTED",
      reason: "Cease e Gray são starters de alta qualidade para este total.",
    });
  });

  it("não reclassifica inconsistência de preço ou cálculo", () => {
    const result = applyAiSemanticPolicy(
      output({
        gates: {
          ...output().gates,
          technical_consistency: {
            status: "REJECTED",
            reason: "A odd e o edge são incompatíveis com o cálculo informado.",
          },
        },
      }),
    );

    expect(result.gates.technical_consistency.status).toBe("REJECTED");
    expect(result.gates.structural_risk.status).toBe("APPROVED");
  });
});
