import { describe, expect, it } from "vitest";
import type { Prognostico } from "@/lib/db";
import {
  detectCriticalShortlistRiskFlags,
  evaluateMatchMatrixOperationalGate,
  evaluateMlbOperationalGate,
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

function mlbPrediction(overrides: Partial<Prognostico> = {}): Prognostico {
  return matchMatrixPrediction({
    id: "mlb-1",
    esporte: "Baseball",
    liga: "USA - MLB",
    jogo: "Athletics vs Detroit Tigers",
    mandante: "Athletics",
    visitante: "Detroit Tigers",
    mercado: "Under Corridas",
    pick: "Under 11.5",
    edge: 6,
    edge_ajustado: 6,
    origem_modelo: "ASP Diamond",
    contexto_modelo: "MLB_V2_1_TEMPORAL_UNCERTAINTY",
    dados_tecnicos: [
      "[MATCHUPS / PREVIEW ENRIQUECIDO]",
      "Mandante: Athletics 45-64",
      "Starter visitante: Casey Mize RHP ERA 2.7 K/9 8.83 Last7_ERA 3.23 Recent_HR9 0.69 Quality 73",
      "Starter mandante: Jeffrey Springs LHP ERA 6.23 K/9 7.44 Last7_ERA 10.24 Recent_HR9 3.41 Quality 25",
    ].join("\n"),
    ...overrides,
  });
}

describe("requalificacao contextual MLB pos-Preview", () => {
  it("sinaliza Under com starter de alto risco sem alterar a probabilidade", () => {
    const prediction = mlbPrediction();
    const gate = evaluateMlbOperationalGate(prediction);
    const flags = detectCriticalShortlistRiskFlags(
      prediction,
      new Date("2026-07-31T12:00:00-03:00"),
    );

    expect(gate.approved).toBe(true);
    expect(gate.previewContextStatus).toBe("REVIEW_REQUIRED");
    expect(gate.contextRiskFlags.map((flag) => flag.code)).toContain("mlb_under_starter_run_risk");
    expect(flags.map((flag) => flag.code)).toContain("mlb_under_starter_run_risk");
    expect(prediction.probabilidade_final).toBe(60.6);
  });

  it("sinaliza Over contra dois starters com perfil de supressao", () => {
    const gate = evaluateMlbOperationalGate(
      mlbPrediction({
        jogo: "Houston Astros vs Texas Rangers",
        mandante: "Houston Astros",
        visitante: "Texas Rangers",
        mercado: "Over Corridas",
        pick: "Over 7.5",
        dados_tecnicos: [
          "[MATCHUPS / PREVIEW ENRIQUECIDO]",
          "Mandante: Houston Astros 55-55",
          "Starter visitante: Nathan Eovaldi RHP ERA 4.05 K/9 9.56 Last7_ERA 3.64 Recent_HR9 1.5 Quality 61",
          "Starter mandante: Hunter Brown RHP ERA 3.45 K/9 9.57 Last7_ERA 4.21 Recent_HR9 1.24 Quality 66",
        ].join("\n"),
      }),
    );

    expect(gate.previewContextStatus).toBe("REVIEW_REQUIRED");
    expect(gate.contextRiskFlags.map((flag) => flag.code)).toContain(
      "mlb_over_starter_suppression_risk",
    );
  });

  it("exige revisao de clima para total no mando do Colorado", () => {
    const baseContext = [
      "[MATCHUPS / PREVIEW ENRIQUECIDO]",
      "Mandante: Colorado Rockies 42-67",
      "Starter visitante: Michael Wacha RHP ERA 3.6 K/9 7.07 Last7_ERA 3.65 Recent_HR9 1.22 Quality 58",
      "Starter mandante: Tomoyuki Sugano RHP ERA 4.69 K/9 5.25 Last7_ERA 5.73 Recent_HR9 2.15 Quality 38",
    ].join("\n");
    const withoutWeather = evaluateMlbOperationalGate(
      mlbPrediction({
        jogo: "Colorado Rockies vs Kansas City Royals",
        mandante: "Colorado Rockies",
        visitante: "Kansas City Royals",
        dados_tecnicos: baseContext,
      }),
    );
    const withWeather = evaluateMlbOperationalGate(
      mlbPrediction({
        jogo: "Colorado Rockies vs Kansas City Royals",
        mandante: "Colorado Rockies",
        visitante: "Kansas City Royals",
        dados_tecnicos: `${baseContext}\nClima: vento 8 mph para o campo central`,
      }),
    );

    expect(withoutWeather.contextRiskFlags.map((flag) => flag.code)).toContain(
      "mlb_coors_weather_review_required",
    );
    expect(withWeather.contextRiskFlags.map((flag) => flag.code)).not.toContain(
      "mlb_coors_weather_review_required",
    );
  });
});
