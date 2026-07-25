import { describe, expect, it } from "vitest";
import {
  getSportChecklist,
  normalizeOnlineHttpUrl,
  ONLINE_GATEWAY_JSON_TEMPLATE,
  ONLINE_GATEWAY_MODEL_ID,
  parseOnlineGatewayJson,
  recordOnlineSource,
  type OnlineSourceTrace,
} from "./validacao-ia-online.functions";

describe("Structured Output online", () => {
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
    expect(output).toMatchObject({
      schema_version: "1.1.0",
      decision: "PULAR",
      stake: 0,
      sources: [],
      searches: [],
    });
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
