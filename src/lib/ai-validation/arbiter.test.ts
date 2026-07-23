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
    narrative: {
      evaluated_entry:
        "Jogo: A vs B\nMercado: Total\nPick: Over 2.5\nOdd: 2.00\nProbabilidade: 60%\nEdge: 20%",
      thesis_for: "O modelo e a precificação sustentam a entrada.",
      thesis_against: "A variância do mercado permanece relevante.",
      internal_history: "Amostra: 10 casos\nGreens/Reds: 6 GREEN / 4 RED",
      final_justification: "Tese consistente com os dados atuais.",
      decision_change_condition: "Mudança material de odd ou contexto.",
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

const PHILLIES_DODGERS_LEGACY_REPORT = `A) Entrada avaliada
Jogo: Philadelphia Phillies vs Los Angeles Dodgers
Mercado: Under Corridas
Pick: Under 10.5
Odd: 1.670 (ajustada)
Probabilidade: 63.64%
Edge: 6.28%

B) Tese a favor
1. Estabilidade Recente: 4 dos últimos 5 jogos entre as equipes na temporada 2026 terminaram com 10 ou menos corridas. O único "outlier" foi o jogo de 20/07 (17 corridas), seguido imediatamente por um jogo de 3 corridas totais no dia 21/07, indicando uma regressão à média defensiva.
2. Starters Confirmados: Eric Lauer (LAD) e Aaron Nola (PHI) estão confirmados. Embora Nola tenha um ERA elevado na temporada (5.68), ele mantém um K/9 de elite (9.44), o que ajuda a mitigar danos em situações de bases ocupadas.
3. Histórico de Confronto do Starter: Eric Lauer possui um histórico excepcional contra os Phillies (ERA de 1.08 nos últimos 5 jogos contra a franquia).
4. Tendência do Under: A média histórica do confronto (H2H) em 2025 e 2026 gira em torno de 8.30 a 8.60 corridas, bem abaixo da linha protetora de 10.5.

C) Tese contra a entrada
1. ERA de Nola: O starter dos Phillies (Aaron Nola) tem sido castigado por Home Runs na temporada (23 HRs em 103 IP), o que é perigoso em um estádio como o Citizens Bank Park (Park Factor favorável a rebatedores).
2. Potencial Ofensivo do Dodgers: O lineup de Los Angeles conta com Shohei Ohtani e Mookie Betts saudáveis, capazes de produzir corridas rápidas através de rebatidas extra-base.
3. Bullpen do Dodgers: Tanner Scott (closer) atuou por 1.2 innings no dia anterior (21/07) para salvar o jogo; se o bullpen de elite estiver cansado, as entradas finais podem ser voláteis.

D) Gates de validação
Coerência técnica: aprovado - A linha de 10.5 oferece uma proteção de 2 corridas acima da média esperada (8.65).
Informação crítica: aprovado - Starters confirmados (Lauer x Nola).
Risco estrutural: aprovado - Bullpens em condições normais, apesar do uso de Tanner Scott (LAD).
Contexto online/manual: aprovado - A vitória magra de 2-1 no dia anterior sugere um ajuste nos arremessadores após o tiroteio de 17 corridas.
Duplicidade/correlação: aprovado - A opção Under 10.5 é preferível à Under 9.5 (embora o edge da 9.5 seja maior) pela margem de segurança no gancho crucial de 10 corridas.

E) Riscos principais
1. Volatilidade de Aaron Nola com HRs permitidos em estádio pequeno.
2. Potencial explosivo do núcleo do lineup dos Dodgers.
3. Citizens Bank Park em um dia quente (fator que ajuda a bola a voar).

F) Histórico interno semelhante
Amostra: 16 casos
Greens/Reds: 10 GREEN / 6 RED
ROI/Yield: N/A (Yield histórico positivo no nicho MLB Under)
Conclusão: Amostra moderada que valida a eficácia do modelo em linhas esticadas de Under (10.5).

G) Decisão final
Decisão: CONFIRMAR
decisao_grupo: CONFIRMA
prognostico_id_escolhido: 1a21dce9-c1ee-429d-9be4-6dc396fd2271
pick_escolhida: Under 10.5
stake_confirmada: 1.0
Stake sugerida: 1.0u
justificativa_pick: A linha de 10.5 é extremamente protetora para um confronto onde a média projetada é de 8.6 corridas. Lauer domina o matchup contra o Phillies historicamente (1.08 ERA).
riscos: Nola ceder HRs múltiplos; Bullpen desgastado se os starters saírem cedo.
condicao_invalidacao: Substituição de Eric Lauer por um bullpen game de última hora.
Justificativa final objetiva: A linha de 10.5 está inflada pelo jogo atípico de 17 corridas ocorrido há dois dias. O mercado ajustou a odd, mas a probabilidade de um jogo de 11 corridas com Lauer e Nola no montinho é baixa o suficiente para justificar a entrada com 1u.
Condição que faria mudar a decisão: Confirmação de ventos fortes soprando para fora (outfield) acima de 15mph no horário do jogo.`;

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
    expect(text).toContain("Decisão original da IA: CONFIRMA");
    expect(text).toContain("Decisão final validada: PULAR");
    expect(text).toContain("decisao_grupo: PULAR");
    expect(text).toContain("[SELECTION_ID_NOT_IN_GROUP]");
    expect(text).not.toContain("Status do árbitro: APPROVED");
  });

  it("preserva as seções A–G do parecer informado e interpreta seus gates", () => {
    const adapted = adaptLegacyAiResponse({ text: PHILLIES_DODGERS_LEGACY_REPORT });
    expect(adapted.schema_version).toBe("1.1.0");
    expect(adapted.narrative).toMatchObject({
      evaluated_entry: expect.stringContaining("Philadelphia Phillies"),
      thesis_for: expect.stringContaining("Starters Confirmados"),
      thesis_against: expect.stringContaining("ERA de Nola"),
      internal_history: expect.stringContaining("10 GREEN / 6 RED"),
      final_justification: expect.stringContaining("A linha de 10.5 está inflada"),
      decision_change_condition: expect.stringContaining("ventos fortes soprando para fora"),
    });
    expect(adapted.gates).toMatchObject({
      technical_consistency: { status: "APPROVED" },
      critical_information: { status: "APPROVED" },
      structural_risk: { status: "APPROVED" },
      context: { status: "APPROVED" },
      correlation: { status: "APPROVED" },
    });
    expect(adapted.risks).toEqual(
      expect.arrayContaining([
        "Volatilidade de Aaron Nola com HRs permitidos em estádio pequeno.",
        "Potencial explosivo do núcleo do lineup dos Dodgers.",
        "Nola ceder HRs múltiplos",
        "Bullpen desgastado se os starters saírem cedo.",
      ]),
    );

    const result = arbitrateAiOutput(adapted, {
      mode: "online",
      options: [
        {
          prediction: prediction({
            id: "1a21dce9-c1ee-429d-9be4-6dc396fd2271",
            jogo: "Philadelphia Phillies vs Los Angeles Dodgers",
            pick: "Under 10.5",
          }),
          pick: "Under 10.5",
        },
      ],
    });
    const text = formatArbitratedAiValidation(result);
    expect(result.blocks).toEqual([]);
    expect(text).toContain("A) Entrada avaliada");
    expect(text).toContain("B) Tese a favor");
    expect(text).toContain("C) Tese contra a entrada");
    expect(text).toContain("D) Gates de validação");
    expect(text).toContain("Risco estrutural: aprovado - Bullpens em condições normais");
    expect(text).toContain("E) Riscos principais");
    expect(text).toContain("F) Histórico interno semelhante");
    expect(text).toContain("G) Decisão final");
    expect(text).toContain("Decisão original da IA: CONFIRMA");
    expect(text).toContain("Decisão final validada: CONFIRMA");
    expect(text).toContain("Validação determinística: CONFIRMA VALIDADO");
    expect(text).not.toContain("Status do árbitro: APPROVED");
  });

  it("nomeia uma decisão segura de PULAR sem usar o status ambíguo APPROVED", () => {
    const result = arbitrateAiOutput(
      output({
        decision: "PULAR",
        stake: 0,
        selected_prediction_id: null,
        selected_pick: null,
      }),
      context(prediction()),
    );
    const text = formatArbitratedAiValidation(result);
    expect(text).toContain("Validação determinística: PULAR VALIDADO");
    expect(text).toContain("Decisão final validada: PULAR");
    expect(text).not.toContain("Status do árbitro: APPROVED");
  });
});
