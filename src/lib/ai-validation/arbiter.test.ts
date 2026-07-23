import { describe, expect, it } from "vitest";
import type { Prognostico } from "@/lib/db";
import { arbitrateAiOutput, type AiArbiterContext } from "./arbiter";
import { adaptLegacyAiResponse } from "./legacy-adapter";
import { formatArbitratedAiValidation } from "./presentation";
import { AiOperationalOutputSchema } from "./schema";
import { AI_VALIDATION_SCHEMA_VERSION, type AiOperationalOutput } from "./types";

function prediction(overrides: Partial<Prognostico> = {}): Prognostico {
  return {
    id: "prediction-1",
    data: "2026-07-23",
    hora: "20:00",
    esporte: "Futebol",
    liga: "Liga Teste",
    jogo: "A vs B",
    mandante: "A",
    visitante: "B",
    mercado: "Total",
    pick: "Over 2.5",
    linha: "2.5",
    odd_ofertada: 2,
    odd_ajustada: 2,
    odd_valor: 1.8,
    probabilidade_final: 60,
    edge: 20,
    edge_ajustado: 20,
    stake: 1,
    status_validacao: "PENDENTE",
    status_publicacao: "NAO_PUBLICADO",
    resultado: "PENDENTE",
    lucro_prejuizo: null,
    observacoes: null,
    dados_tecnicos: null,
    contexto_modelo: null,
    arquivo_contexto: null,
    origem_modelo: null,
    job_id_coleta: null,
    is_top_final: false,
    top_final_rank: null,
    top_final_run_id: null,
    top_final_at: null,
    data_publicacao: null,
    tip_texto: null,
    publicado_em: null,
    publicado_por: null,
    canal_publicacao: null,
    created_at: "2026-07-23T12:00:00Z",
    updated_at: "2026-07-23T12:00:00Z",
    ...overrides,
  };
}

function output(overrides: Partial<AiOperationalOutput> = {}): AiOperationalOutput {
  const gate = {
    status: "APPROVED" as const,
    reason: "Aprovado no parecer.",
  };
  return {
    schema_version: AI_VALIDATION_SCHEMA_VERSION,
    decision: "CONFIRMA",
    stake: 1,
    selected_prediction_id: "prediction-1",
    selected_pick: "Over 2.5",
    gates: {
      technical_consistency: gate,
      critical_information: gate,
      structural_risk: gate,
      context: gate,
      correlation: gate,
    },
    rationale: "Tese consistente com os dados atuais.",
    risks: ["Variância normal do mercado."],
    invalidation_condition: "Mudança material de odd ou contexto.",
    limitations: [],
    sources: [],
    searches: [],
    ...overrides,
  };
}

function context(...predictions: Prognostico[]): AiArbiterContext {
  return {
    mode: "local",
    options: predictions.map((item) => ({ prediction: item, pick: item.pick })),
  };
}

describe("AiOperationalOutputSchema", () => {
  it("aceita somente stakes operacionais previstas", () => {
    expect(AiOperationalOutputSchema.safeParse(output({ stake: 1.5 })).success).toBe(true);
    expect(AiOperationalOutputSchema.safeParse({ ...output(), stake: 2 }).success).toBe(false);
  });

  it("rejeita uma segunda seleção correlata fora do contrato", () => {
    const input = {
      ...output(),
      selected_prediction_ids: ["prediction-1", "prediction-2"],
    };
    expect(AiOperationalOutputSchema.safeParse(input).success).toBe(false);
  });
});

describe("arbitrateAiOutput", () => {
  it("aprova uma confirmação consistente", () => {
    const result = arbitrateAiOutput(output(), context(prediction()));
    expect(result.status).toBe("APPROVED");
    expect(result.output.decision).toBe("CONFIRMA");
    expect(result.blocks).toEqual([]);
  });

  it("fecha schema inválido em PULAR", () => {
    const result = arbitrateAiOutput({ decision: "CONFIRMA" }, context(prediction()));
    expect(result.status).toBe("BLOCKED");
    expect(result.output.decision).toBe("PULAR");
    expect(result.output.stake).toBe(0);
    expect(result.blocks.map((block) => block.code)).toContain("SCHEMA_INVALID");
  });

  it("normaliza PULAR com stake e seleção indevidas", () => {
    const result = arbitrateAiOutput(
      output({
        decision: "PULAR",
        stake: 0.5,
        selected_prediction_id: "prediction-1",
        selected_pick: "Over 2.5",
      }),
      context(prediction()),
    );
    expect(result.output).toMatchObject({
      decision: "PULAR",
      stake: 0,
      selected_prediction_id: null,
      selected_pick: null,
    });
    expect(result.blocks.map((block) => block.code)).toEqual(
      expect.arrayContaining(["PULAR_STAKE_NON_ZERO", "PULAR_SELECTION_PRESENT"]),
    );
  });

  it("bloqueia ID inexistente no grupo", () => {
    const result = arbitrateAiOutput(
      output({ selected_prediction_id: "prediction-missing" }),
      context(prediction()),
    );
    expect(result.output.decision).toBe("PULAR");
    expect(result.blocks.map((block) => block.code)).toContain("SELECTION_ID_NOT_IN_GROUP");
  });

  it("bloqueia pick divergente do ID", () => {
    const result = arbitrateAiOutput(output({ selected_pick: "Under 2.5" }), context(prediction()));
    expect(result.blocks.map((block) => block.code)).toContain("SELECTED_PICK_MISMATCH");
  });

  it("bloqueia grupo correlato com IDs duplicados", () => {
    const duplicate = prediction({ pick: "Over 3.5" });
    const result = arbitrateAiOutput(output(), context(prediction(), duplicate));
    expect(result.blocks.map((block) => block.code)).toContain("CORRELATED_SELECTION_CONFLICT");
  });

  it("bloqueia confirmação quando a própria IA reprova um gate", () => {
    const result = arbitrateAiOutput(
      output({
        gates: {
          ...output().gates,
          structural_risk: { status: "REJECTED", reason: "Risco alto." },
        },
      }),
      context(prediction()),
    );
    expect(result.blocks.map((block) => block.code)).toContain("MODEL_GATE_REJECTED");
  });

  it("revalida edge efetivo e odd de valor", () => {
    const result = arbitrateAiOutput(
      output(),
      context(prediction({ edge_ajustado: -1, odd_ajustada: 1.7 })),
    );
    expect(result.blocks.map((block) => block.code)).toEqual(
      expect.arrayContaining(["EFFECTIVE_EDGE_INVALID", "ODD_BELOW_FAIR_VALUE"]),
    );
  });

  it("revalida Preview enriquecido e os dois starters na MLB", () => {
    const result = arbitrateAiOutput(
      output(),
      context(
        prediction({
          esporte: "Baseball",
          liga: "MLB",
          dados_tecnicos: "Sem preview.",
        }),
      ),
    );
    expect(result.blocks.map((block) => block.code)).toEqual(
      expect.arrayContaining(["MLB_GATE_BLOCKED", "MLB_STARTERS_MISSING", "MLB_PREVIEW_MISSING"]),
    );
  });

  it("aprova MLB com edge, Preview e starters vigentes", () => {
    const result = arbitrateAiOutput(
      output(),
      context(
        prediction({
          esporte: "Baseball",
          liga: "MLB",
          dados_tecnicos:
            "[MATCHUPS / PREVIEW ENRIQUECIDO]\nStarter visitante: Pitcher A ERA 3.10\nStarter mandante: Pitcher B ERA 3.40",
        }),
      ),
    );
    expect(result.status).toBe("APPROVED");
  });

  it("mantém PackBall SEM_PRECO como reserva", () => {
    const result = arbitrateAiOutput(
      output(),
      context(
        prediction({
          mercado: "ASP GoalMatrix",
          origem_modelo: "ASP GoalMatrix",
          odd_ofertada: 1.5,
          odd_ajustada: null,
          odd_valor: 1.6,
          probabilidade_final: 65,
        }),
      ),
    );
    expect(result.blocks.map((block) => block.code)).toEqual(
      expect.arrayContaining([
        "PACKBALL_EXECUTABLE_ODD_MISSING",
        "PACKBALL_SEM_PRECO",
        "PACKBALL_EDGE_BELOW_MIN",
      ]),
    );
  });

  it("impede que a IA eleve o cap de stake do PackBall", () => {
    const result = arbitrateAiOutput(
      output({ stake: 1 }),
      context(
        prediction({
          mercado: "ASP GoalMatrix",
          origem_modelo: "ASP GoalMatrix",
          odd_ofertada: 1.7,
          odd_ajustada: 1.8,
          odd_valor: 1.5,
          probabilidade_final: 65,
          dados_tecnicos: "identity_insufficient_oos_sample",
        }),
      ),
    );
    expect(result.blocks.map((block) => block.code)).toContain("PACKBALL_STAKE_CAP_EXCEEDED");
  });

  it("revalida os diagnósticos MatchMatrix", () => {
    const result = arbitrateAiOutput(
      output(),
      context(
        prediction({
          origem_modelo: "ASP MatchMatrix",
          contexto_modelo: "football_v1_1",
          dados_tecnicos: "Sem diagnóstico versionado.",
        }),
      ),
    );
    expect(result.blocks.map((block) => block.code)).toContain("MATCHMATRIX_GATE_BLOCKED");
  });
});

describe("adaptador legado e apresentação", () => {
  it("adapta o texto legado para o contrato antes da arbitragem", () => {
    const adapted = adaptLegacyAiResponse({
      text: `decisao_grupo: CONFIRMA
prognostico_id_escolhido: 11111111-1111-4111-8111-111111111111
pick_escolhida: Over 2.5
stake_confirmada: 0.5
Justificativa final objetiva: Contexto coerente.
riscos: Variância; Mudança de odd
condicao_invalidacao: Odd abaixo de 1.90`,
    });
    expect(adapted).toMatchObject({
      schema_version: AI_VALIDATION_SCHEMA_VERSION,
      decision: "CONFIRMA",
      stake: 0.5,
      selected_prediction_id: "11111111-1111-4111-8111-111111111111",
      selected_pick: "Over 2.5",
      rationale: "Contexto coerente.",
    });
  });

  it("converte stake legado não permitido em bloqueio seguro", () => {
    const adapted = adaptLegacyAiResponse({
      text: `decisao_grupo: CONFIRMA
prognostico_id_escolhido: 11111111-1111-4111-8111-111111111111
pick_escolhida: Over 2.5
stake_confirmada: 2`,
    });
    const result = arbitrateAiOutput(adapted, {
      mode: "local",
      options: [
        {
          prediction: prediction({ id: "11111111-1111-4111-8111-111111111111" }),
          pick: "Over 2.5",
        },
      ],
    });
    expect(result.output).toMatchObject({ decision: "PULAR", stake: 0 });
    expect(result.blocks.map((block) => block.code)).toContain("CONFIRMA_STAKE_ZERO");
  });

  it("gera parecer somente a partir do resultado arbitrado", () => {
    const result = arbitrateAiOutput(
      output({ selected_prediction_id: "missing" }),
      context(prediction()),
    );
    const text = formatArbitratedAiValidation(result);
    expect(text).toContain("Decisão: PULAR");
    expect(text).toContain("[SELECTION_ID_NOT_IN_GROUP]");
    expect(text).not.toContain("Decisão: CONFIRMA");
  });
});
