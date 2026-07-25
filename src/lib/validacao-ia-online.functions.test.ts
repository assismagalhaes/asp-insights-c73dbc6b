import { describe, expect, it } from "vitest";
import {
  buildOnlineFinalSynthesisPrompt,
  buildOnlineResearchPrompt,
  compactOnlineContext,
  getSportChecklist,
  MAX_ONLINE_CONTEXT_CHARACTERS,
  MAX_ONLINE_GATEWAY_STEPS,
  normalizeOnlineHttpUrl,
  ONLINE_GATEWAY_JSON_TEMPLATE,
  ONLINE_GATEWAY_MODEL_ID,
  ONLINE_REPAIR_MODEL_ID,
  parseOnlineGatewayJson,
  recordOnlineSource,
  type OnlineSourceTrace,
} from "./validacao-ia-online.functions";

describe("Structured Output online", () => {
  it("separa hipótese, pesquisa adversarial e síntese final", () => {
    const researchPrompt = buildOnlineResearchPrompt(
      "Jogo: Portland vs Real Salt Lake\nOdd: 1.48",
      "Tese: favoritismo do Portland. Lacuna: escalações.",
    );
    const finalPrompt = buildOnlineFinalSynthesisPrompt({
      userPayload: "Jogo: Portland vs Real Salt Lake\nOdd: 1.48",
      preliminarySynthesis: "Tese preliminar favorável ao Portland.",
      researchNarrative: "A escalação ainda não foi confirmada.",
      researchEvidence: ["[BUSCA] Injury report\nTrecho: dúvida no ataque"],
    });

    expect(researchPrompt).toContain("confirmar ou refutar");
    expect(researchPrompt).toContain("escalações");
    expect(researchPrompt).toContain("Não produza decisão operacional");
    expect(finalPrompt).toContain("HIPÓTESE PRELIMINAR NÃO OPERACIONAL");
    expect(finalPrompt).toContain("dúvida no ataque");
    expect(finalPrompt).toContain("Somente agora produza a decisão operacional");
    expect(finalPrompt).toContain("contrato 1.1.0");
  });

  it("identifica saída inicial vazia antes do reparo", () => {
    expect(() =>
      parseOnlineGatewayJson("   ", {
        sourceTraces: [],
        searches: [],
      }),
    ).toThrow("EMPTY_INITIAL_OUTPUT");
  });

  it("usa o Lovable AI Gateway com Gemini 3.6 Flash e contrato 1.1.0", () => {
    const output = parseOnlineGatewayJson(ONLINE_GATEWAY_JSON_TEMPLATE, {
      sourceTraces: [],
      searches: [],
    });

    expect(ONLINE_GATEWAY_MODEL_ID).toBe("google/gemini-3.6-flash");
    expect(ONLINE_REPAIR_MODEL_ID).toBe("google/gemini-2.5-flash");
    expect(output).toMatchObject({
      schema_version: "1.1.0",
      decision: "PULAR",
      stake: 0,
      sources: [],
      searches: [],
    });
  });

  it("normaliza decision reparável sem aceitar enum desconhecido", () => {
    const reparavel = JSON.parse(ONLINE_GATEWAY_JSON_TEMPLATE) as Record<string, unknown>;
    reparavel.decision = "PULAR VALIDADO";
    expect(
      parseOnlineGatewayJson(JSON.stringify(reparavel), {
        sourceTraces: [],
        searches: [],
      }).decision,
    ).toBe("PULAR");

    reparavel.decision = "AGUARDAR";
    expect(() =>
      parseOnlineGatewayJson(JSON.stringify(reparavel), {
        sourceTraces: [],
        searches: [],
      }),
    ).toThrow();
  });

  it("mantém a síntese final online dentro de um orçamento previsível", () => {
    const prompt = buildOnlineFinalSynthesisPrompt({
      userPayload: "U".repeat(30_000),
      preliminarySynthesis: "P".repeat(20_000),
      researchNarrative: "R".repeat(20_000),
      researchEvidence: ["E".repeat(40_000)],
    });
    expect(prompt.length).toBeLessThan(28_000);
  });

  it("compacta Preview extenso preservando linhas operacionais prioritárias", () => {
    const context = [
      "Resumo inicial",
      "x".repeat(14_000),
      "Starter visitante: Bryan Woo RHP ERA 4.16",
      "Starter mandante: Nathan Eovaldi RHP ERA 4.21",
      "Edge ajustado: 8.72%",
    ].join("\n");
    const compacted = compactOnlineContext(context);

    expect(compacted.length).toBeLessThanOrEqual(MAX_ONLINE_CONTEXT_CHARACTERS);
    expect(compacted).toContain("[CONTEXTO EXTENSO TRUNCADO]");
    expect(compacted).toContain("Starter visitante: Bryan Woo");
    expect(compacted).toContain("Edge ajustado: 8.72%");
  });

  it("limita o loop online a três passos de Gateway", () => {
    expect(MAX_ONLINE_GATEWAY_STEPS).toBe(3);
  });

  it("reconstrói fontes e buscas somente pela telemetria real", () => {
    const modelJson = JSON.parse(ONLINE_GATEWAY_JSON_TEMPLATE) as Record<string, unknown>;
    modelJson.sources = [{ title: "Fonte inventada", url: "javascript:alert(1)" }];
    modelJson.searches = ["busca inventada"];
    const sourceTraces: OnlineSourceTrace[] = [
      {
        titulo: "Resultado não aprofundado",
        url: "https://example.com/search-result",
        consultada_em: "2026-07-24T12:00:00.000Z",
        tipo: "SEARCH_RESULT",
        consultada: false,
      },
      {
        titulo: "MLB probable pitchers",
        url: "https://www.mlb.com/probable-pitchers",
        consultada_em: "2026-07-24T12:01:00.000Z",
        tipo: "SCRAPED",
        consultada: true,
      },
    ];

    const output = parseOnlineGatewayJson(JSON.stringify(modelJson), {
      sourceTraces,
      searches: [" MLB confirmed starters ", "MLB confirmed starters"],
    });

    expect(output.sources).toEqual([
      {
        title: "MLB probable pitchers",
        url: "https://www.mlb.com/probable-pitchers",
      },
    ]);
    expect(output.searches).toEqual(["MLB confirmed starters"]);
  });

  it("bloqueia protocolos não HTTP(S) e promove resultado a fonte consultada", () => {
    expect(normalizeOnlineHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeOnlineHttpUrl("ftp://example.com/file")).toBeNull();

    const traces: OnlineSourceTrace[] = [];
    recordOnlineSource(traces, {
      titulo: "Busca MLB",
      url: "https://example.com/mlb#top",
      tipo: "SEARCH_RESULT",
      consultadaEm: "2026-07-24T12:00:00.000Z",
    });
    recordOnlineSource(traces, {
      titulo: "Página MLB",
      url: "https://example.com/mlb",
      tipo: "SCRAPED",
      consultadaEm: "2026-07-24T12:02:00.000Z",
    });

    expect(traces).toEqual([
      {
        titulo: "Página MLB",
        url: "https://example.com/mlb",
        consultada_em: "2026-07-24T12:02:00.000Z",
        tipo: "SCRAPED",
        consultada: true,
      },
    ]);
  });

  it("mantém os gates críticos do canário de baseball", () => {
    const checklist = getSportChecklist("Baseball / MLB");

    expect(checklist).toContain("starter confirmado");
    expect(checklist).toContain("Bullpen");
    expect(checklist).toContain("Lineup");
    expect(checklist).toContain("vento");
    expect(checklist).toContain("park factor");
  });
});
