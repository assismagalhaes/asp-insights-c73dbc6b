import { describe, expect, it } from "vitest";
import type { Prognostico } from "@/lib/db";
import {
  detectCriticalShortlistRiskFlags,
  evaluateMatchMatrixOperationalGate,
} from "./critical-shortlist-ranking";

function matchMatrixPrediction(overrides: Partial<Prognostico> = {}): Prognostico {
  return {
    id: "matchmatrix-1",
    data: "2026-07-25",
    hora: "20:00",
    esporte: "Futebol",
    liga: "USA - MLS",
    jogo: "A vs B",
    mandante: "A",
    visitante: "B",
    mercado: "Over Gols",
    pick: "Over 2.5",
    linha: "2.5",
    odd_ofertada: 1.9,
    odd_ajustada: 1.9,
    odd_valor: 1.65,
    probabilidade_final: 60.6,
    edge: 15.14,
    edge_ajustado: 15.14,
    stake: 0,
    status_validacao: "PENDENTE",
    status_publicacao: "NAO_PUBLICADO",
    resultado: "PENDENTE",
    lucro_prejuizo: null,
    observacoes:
      "modelo_versao=FOOTBALL_V1_5 | market_conflict_status=ALINHADO | " +
      "min_edge_required=0.03 | home_venue_gap_days=65 | away_venue_gap_days=66",
    dados_tecnicos: "Amostra e forma recente do confronto.",
    contexto_modelo: "ASP MatchMatrix FOOTBALL_V1_5",
    arquivo_contexto: null,
    origem_modelo: "ASP MatchMatrix",
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
    created_at: "2026-07-24T20:00:00Z",
    updated_at: "2026-07-24T20:00:00Z",
    ...overrides,
  };
}

describe("controles MatchMatrix FOOTBALL_V1_5", () => {
  it("bloqueia Top Final com os dois recortes acima de 60 dias sem Preview", () => {
    const flags = detectCriticalShortlistRiskFlags(
      matchMatrixPrediction(),
      new Date("2026-07-24T20:00:00-03:00"),
    );

    expect(flags).toContainEqual(
      expect.objectContaining({
        code: "matchmatrix_both_venue_samples_stale_60d",
        severity: "hard_block",
      }),
    );
  });

  it("permite reavaliação quando há Preview enriquecido atual", () => {
    const prediction = matchMatrixPrediction({
      dados_tecnicos:
        "Amostra e forma recente.\n[MATCHUPS / PREVIEW ENRIQUECIDO]\nConfronto confirmado.",
    });
    const flags = detectCriticalShortlistRiskFlags(
      prediction,
      new Date("2026-07-24T20:00:00-03:00"),
    );

    expect(flags.map((flag) => flag.code)).not.toContain(
      "matchmatrix_both_venue_samples_stale_60d",
    );
  });

  it("eleva o edge mínimo para alternativa correlacionada", () => {
    const gate = evaluateMatchMatrixOperationalGate(
      matchMatrixPrediction({
        edge: 5.5,
        edge_ajustado: 5.5,
        observacoes:
          "modelo_versao=FOOTBALL_V1_5 | market_conflict_status=ALINHADO | " +
          "min_edge_required=0.03 | selection_role=ALTERNATIVA | " +
          "correlation_penalty_factor=0.75",
      }),
    );

    expect(gate.minimumEdge).toBe(6);
    expect(gate.approved).toBe(false);
  });
});
