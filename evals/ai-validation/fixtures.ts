import type { Prognostico } from "../../src/lib/db";
import type { AiArbiterContext } from "../../src/lib/ai-validation/arbiter";
import type { AiEvaluationCase } from "../../src/lib/ai-validation/evaluation";
import {
  AI_VALIDATION_SCHEMA_VERSION,
  type AiOperationalOutput,
  type AiValidationMode,
} from "../../src/lib/ai-validation/types";

type Profile = {
  id: string;
  mode: AiValidationMode;
  prediction: Partial<Prognostico>;
};

function prediction(id: string, overrides: Partial<Prognostico>): Prognostico {
  return {
    id,
    data: "2026-07-25",
    hora: "20:00",
    esporte: "Futebol",
    liga: "Liga de avaliação",
    jogo: "Equipe A vs Equipe B",
    mandante: "Equipe A",
    visitante: "Equipe B",
    mercado: "Total",
    pick: "Over 2.5",
    linha: "2.5",
    odd_ofertada: 2,
    odd_ajustada: 2,
    odd_valor: 1.7,
    probabilidade_final: 60,
    edge: 20,
    edge_ajustado: 20,
    stake: 1,
    status_validacao: "PENDENTE",
    status_publicacao: "NAO_PUBLICADO",
    resultado: "PENDENTE",
    lucro_prejuizo: null,
    observacoes: null,
    dados_tecnicos: "Amostra e contexto técnico suficientes.",
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
    created_at: "2026-07-24T12:00:00Z",
    updated_at: "2026-07-24T12:00:00Z",
    ...overrides,
  };
}

function output(
  predictionId: string,
  pick: string,
  overrides: Partial<AiOperationalOutput> = {},
): AiOperationalOutput {
  const gate = { status: "APPROVED" as const, reason: "Gate aprovado na fixture." };
  return {
    schema_version: AI_VALIDATION_SCHEMA_VERSION,
    decision: "CONFIRMA",
    stake: 0.5,
    selected_prediction_id: predictionId,
    selected_pick: pick,
    gates: {
      technical_consistency: gate,
      critical_information: gate,
      structural_risk: gate,
      context: gate,
      correlation: gate,
    },
    narrative: {
      evaluated_entry: "Entrada avaliada pela fixture versionada.",
      thesis_for: "Há valor estatístico e contexto suficiente.",
      thesis_against: "A variância do mercado continua presente.",
      internal_history: "Amostra sintética destinada a testar o contrato.",
      final_justification: "A saída satisfaz o contrato operacional.",
      decision_change_condition: "Mudança material de preço ou contexto.",
    },
    rationale: "Fixture determinística de avaliação.",
    risks: ["Variância normal do mercado."],
    invalidation_condition: "Mudança material de preço ou contexto.",
    limitations: [],
    sources: [],
    searches: [],
    ...overrides,
  };
}

const profiles: Profile[] = [
  {
    id: "mlb-local",
    mode: "local",
    prediction: {
      esporte: "Baseball",
      liga: "MLB",
      mercado: "Total de corridas",
      pick: "Under 9.5",
      dados_tecnicos:
        "[MATCHUPS / PREVIEW ENRIQUECIDO]\nStarter visitante: Pitcher A ERA 3.10\nStarter mandante: Pitcher B ERA 3.40\nBullpen e lineup revisados.",
    },
  },
  {
    id: "mlb-online",
    mode: "online",
    prediction: {
      esporte: "Baseball",
      liga: "MLB",
      mercado: "Moneyline",
      pick: "Equipe A ML",
      dados_tecnicos:
        "[MATCHUPS / PREVIEW ENRIQUECIDO]\nStarter visitante: Pitcher A ERA 3.10\nStarter mandante: Pitcher B ERA 3.40\nBullpen e lineup revisados.",
    },
  },
  {
    id: "wnba-local",
    mode: "local",
    prediction: {
      esporte: "Basquete",
      liga: "WNBA",
      mercado: "Total de pontos",
      pick: "Under 165.5",
      dados_tecnicos: "Pace, ORTG, DRTG, lesões, rotação e descanso revisados.",
    },
  },
  {
    id: "wnba-online",
    mode: "online",
    prediction: {
      esporte: "Basquete",
      liga: "WNBA",
      mercado: "Spread",
      pick: "Equipe A -3.5",
      dados_tecnicos: "Net rating, ATS, lesões, rotação e descanso revisados.",
    },
  },
  {
    id: "football-local",
    mode: "local",
    prediction: {
      esporte: "Futebol",
      liga: "Liga nacional",
      mercado: "Total de gols",
      pick: "Over 2.5",
    },
  },
  {
    id: "football-online",
    mode: "online",
    prediction: {
      esporte: "Futebol",
      liga: "Liga nacional",
      mercado: "Ambas marcam",
      pick: "BTTS Sim",
    },
  },
  {
    id: "goalmatrix-local",
    mode: "local",
    prediction: {
      esporte: "Futebol",
      mercado: "ASP GoalMatrix",
      pick: "Over 2.5",
      origem_modelo: "ASP GoalMatrix",
      dados_tecnicos: "Edge exigido: 4%. component_spread_pp=8.",
    },
  },
  {
    id: "goalmatrix-online",
    mode: "online",
    prediction: {
      esporte: "Futebol",
      mercado: "ASP GoalMatrix",
      pick: "BTTS Sim",
      origem_modelo: "ASP GoalMatrix",
      dados_tecnicos: "Edge exigido: 5%. component_spread_pp=7.",
    },
  },
  {
    id: "cornermatrix-local",
    mode: "local",
    prediction: {
      esporte: "Futebol",
      mercado: "ASP CornerMatrix",
      pick: "Over 9.5 escanteios",
      origem_modelo: "ASP CornerMatrix",
      dados_tecnicos: "Edge exigido: 5%. component_spread_pp=6.",
    },
  },
  {
    id: "backmatrix-online",
    mode: "online",
    prediction: {
      esporte: "Futebol",
      mercado: "ASP BackMatrix",
      pick: "Equipe A ML",
      origem_modelo: "ASP BackMatrix",
      dados_tecnicos: "Edge exigido: 4%. component_spread_pp=5.",
    },
  },
];

function context(mode: AiValidationMode, item: Prognostico): AiArbiterContext {
  return { mode, options: [{ prediction: item, pick: item.pick }] };
}

function casesFor(profile: Profile): AiEvaluationCase[] {
  const item = prediction(`prediction-${profile.id}`, profile.prediction);
  const valid = output(item.id, item.pick);
  const onlineTrace = {
    sources: [{ title: "Fonte oficial", url: "https://example.com/official" }],
    searches: ["contexto atual da partida"],
  };
  const sourceDisciplineOutput =
    profile.mode === "online" ? { ...valid, ...onlineTrace } : { ...valid, ...onlineTrace };

  return [
    {
      id: `${profile.id}-safe-skip`,
      category: "safe-skip",
      mode: profile.mode,
      context: context(profile.mode, item),
      candidate_output: output(item.id, item.pick, {
        decision: "PULAR",
        stake: 0,
        selected_prediction_id: null,
        selected_pick: null,
      }),
      expectation: {
        generation_valid: true,
        final_decision: "PULAR",
        arbiter_status: "APPROVED",
      },
    },
    {
      id: `${profile.id}-schema-invalid`,
      category: "schema-invalid",
      mode: profile.mode,
      context: context(profile.mode, item),
      candidate_output: { decision: "CONFIRMA" },
      repair_attempted: true,
      expectation: {
        generation_valid: false,
        final_decision: "PULAR",
        arbiter_status: "BLOCKED",
        required_blocks: ["SCHEMA_INVALID"],
      },
    },
    {
      id: `${profile.id}-provider-failure`,
      category: "provider-failure",
      mode: profile.mode,
      context: context(profile.mode, item),
      provider_error: "429 rate limit",
      expectation: {
        generation_valid: false,
        final_decision: "PULAR",
        arbiter_status: "BLOCKED",
        required_blocks: ["SCHEMA_INVALID"],
      },
    },
    {
      id: `${profile.id}-valid-confirm`,
      category: "valid-confirm",
      mode: profile.mode,
      context: context(profile.mode, item),
      candidate_output: profile.mode === "online" ? { ...valid, ...onlineTrace } : valid,
      expectation: {
        generation_valid: true,
        final_decision: "CONFIRMA",
        arbiter_status: "APPROVED",
        online_research_required: profile.mode === "online",
      },
    },
    {
      id: `${profile.id}-skip-with-stake`,
      category: "skip-with-stake",
      mode: profile.mode,
      context: context(profile.mode, item),
      candidate_output: output(item.id, item.pick, {
        decision: "PULAR",
        stake: 0.5,
        selected_prediction_id: null,
        selected_pick: null,
      }),
      expectation: {
        generation_valid: true,
        final_decision: "PULAR",
        arbiter_status: "BLOCKED",
        required_blocks: ["PULAR_STAKE_NON_ZERO"],
      },
    },
    {
      id: `${profile.id}-pick-mismatch`,
      category: "pick-mismatch",
      mode: profile.mode,
      context: context(profile.mode, item),
      candidate_output: output(item.id, "Pick incompatível"),
      expectation: {
        generation_valid: true,
        final_decision: "PULAR",
        arbiter_status: "BLOCKED",
        required_blocks: ["SELECTED_PICK_MISMATCH"],
      },
    },
    {
      id: `${profile.id}-gate-rejected`,
      category: "gate-rejected",
      mode: profile.mode,
      context: context(profile.mode, item),
      candidate_output: output(item.id, item.pick, {
        gates: {
          ...valid.gates,
          structural_risk: { status: "REJECTED", reason: "Risco estrutural alto." },
        },
      }),
      expectation: {
        generation_valid: true,
        final_decision: "PULAR",
        arbiter_status: "BLOCKED",
        required_blocks: ["MODEL_GATE_REJECTED"],
      },
    },
    {
      id: `${profile.id}-source-discipline`,
      category: "source-discipline",
      mode: profile.mode,
      context: context(profile.mode, item),
      candidate_output: sourceDisciplineOutput,
      expectation:
        profile.mode === "online"
          ? {
              generation_valid: true,
              final_decision: "CONFIRMA",
              arbiter_status: "APPROVED",
              online_research_required: true,
            }
          : {
              generation_valid: false,
              final_decision: "PULAR",
              arbiter_status: "BLOCKED",
              required_blocks: ["SCHEMA_INVALID"],
            },
    },
  ];
}

export const AI_VALIDATION_EVALUATION_CASES: AiEvaluationCase[] = profiles.flatMap(casesFor);
