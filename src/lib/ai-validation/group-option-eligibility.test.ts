import { describe, expect, it } from "vitest";
import { evaluateAiGroupOptionEligibility } from "./group-option-eligibility";

const preview = `[MATCHUPS / PREVIEW ENRIQUECIDO]
Starter visitante: Luis Castillo RHP ERA 4.85
Starter mandante: Justin Wrobleski LHP ERA 3.10`;

describe("elegibilidade pré-IA das opções concorrentes", () => {
  it("bloqueia total MLB abaixo de 4% e mantém a alternativa elegível", () => {
    const base = {
      esporte: "Baseball",
      liga: "USA - MLB",
      mercado: "Under Corridas",
      odd_original: 1.63,
      odd_valor: 1.54,
      edge_original: 5.7,
      context: preview,
    };

    const under105 = evaluateAiGroupOptionEligibility({
      ...base,
      pick: "Under 10.5",
      odd_ajustada: 1.6,
      edge_ajustado: 3.74,
    });
    const under95 = evaluateAiGroupOptionEligibility({
      ...base,
      pick: "Under 9.5",
      odd_original: 1.85,
      odd_ajustada: 1.83,
      odd_valor: 1.74,
      edge_ajustado: 5.35,
    });

    expect(under105.status).toBe("BLOQUEADA");
    expect(under105.reasons.join(" ")).toContain("minimo MLB de 4.00%");
    expect(under95).toMatchObject({ status: "ELEGÍVEL", reasons: [] });
  });

  it("bloqueia odd executável abaixo da odd de valor", () => {
    const result = evaluateAiGroupOptionEligibility({
      esporte: "Futebol",
      liga: "Liga",
      mercado: "Moneyline",
      pick: "Mandante",
      odd_original: 1.9,
      odd_ajustada: 1.7,
      odd_valor: 1.75,
      edge_original: 4,
      edge_ajustado: 2,
      context: "",
    });

    expect(result.status).toBe("BLOQUEADA");
    expect(result.reasons.join(" ")).toContain("abaixo da odd de valor");
  });
});
