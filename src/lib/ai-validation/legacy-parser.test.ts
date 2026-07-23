import { describe, expect, it } from "vitest";
import { normalizeLegacyDecision, parseLegacyAiDecision } from "./legacy-parser";

describe("normalizeLegacyDecision", () => {
  it.each([
    ["CONFIRMA", "CONFIRMA"],
    ["confirmar", "CONFIRMA"],
    ["confirma com cautela", "CONFIRMA"],
    ["PULAR", "PULAR"],
    ["PASS", "PULAR"],
    ["aguardar notícia", "PULAR"],
    [null, "PULAR"],
  ] as const)("normaliza %s como %s", (input, expected) => {
    expect(normalizeLegacyDecision(input)).toBe(expected);
  });
});

describe("parseLegacyAiDecision", () => {
  it("preserva uma confirmação completa do formato legado", () => {
    const result = parseLegacyAiDecision(`G) Decisão final
Decisão: CONFIRMAR
decisao_grupo: CONFIRMA
prognostico_id_escolhido: 123e4567-e89b-12d3-a456-426614174000
pick_escolhida: Over 7.5
stake_confirmada: 0,5`);

    expect(result).toEqual({
      decisao: "CONFIRMA",
      stake: 0.5,
      prognostico_id_escolhido: "123e4567-e89b-12d3-a456-426614174000",
      pick_escolhida: "Over 7.5",
    });
  });

  it("prioriza decisao_grupo sobre a decisão textual", () => {
    const result = parseLegacyAiDecision(`Decisão: CONFIRMAR
Stake sugerida: 1.5u
decisão_grupo: PULAR
stake_confirmada: 0`);

    expect(result.decisao).toBe("PULAR");
    expect(result.stake).toBeNull();
  });

  it("usa o primeiro campo de stake depois da decisão encontrada", () => {
    const result = parseLegacyAiDecision(`Stake histórica: 1.5u
Decisão final: CONFIRMA
Stake sugerida: 1.0u`);

    expect(result.stake).toBe(1);
  });

  it.each(["PULAR", "PASS", "AGUARDAR NOTÍCIA"])(
    "fecha %s para PULAR e não retorna stake operacional",
    (decision) => {
      const result = parseLegacyAiDecision(`Decisão final: ${decision}
stake_confirmada: 1.5`);

      expect(result.decisao).toBe("PULAR");
      expect(result.stake).toBeNull();
    },
  );

  it("fecha para PULAR quando não encontra uma decisão", () => {
    expect(parseLegacyAiDecision("Parecer sem o bloco final")).toEqual({
      decisao: "PULAR",
      stake: null,
      prognostico_id_escolhido: null,
      pick_escolhida: null,
    });
  });

  it("converte campos null explícitos em null", () => {
    const result = parseLegacyAiDecision(`decisao_grupo: PULAR
prognostico_id_escolhido: null
pick_escolhida: null
stake_confirmada: 0`);

    expect(result.prognostico_id_escolhido).toBeNull();
    expect(result.pick_escolhida).toBeNull();
  });

  it("aceita valores entre aspas no formato textual legado", () => {
    const result = parseLegacyAiDecision(`decisao_grupo: "CONFIRMA"
prognostico_id_escolhido: "123e4567-e89b-12d3-a456-426614174000"
pick_escolhida: "Home -1.5"
stake_confirmada: 1.5`);

    expect(result).toEqual({
      decisao: "CONFIRMA",
      stake: 1.5,
      prognostico_id_escolhido: "123e4567-e89b-12d3-a456-426614174000",
      pick_escolhida: "Home -1.5",
    });
  });
});
