import { describe, expect, it } from "vitest";

import { formatAiOpinionForDisplay, getOnlineResearchAlerts } from "./ai-analysis-panel-utils";

describe("AiAnalysisPanel helpers", () => {
  it("remove campos operacionais ocultos e mantém o parecer legível", () => {
    const result = formatAiOpinionForDisplay(`decisao_grupo: CONFIRMA
prognostico_id_escolhido: abc
stake_confirmada: 0.5
pick_escolhida: Under 8.5
justificativa_pick: Linha protetora
riscos: Volatilidade
condicao_invalidacao: Troca de starter`);

    expect(result).toBe(`Pick escolhida: Under 8.5
Justificativa da pick escolhida: Linha protetora
Principais riscos: Volatilidade
Condição de invalidação: Troca de starter`);
  });

  it("deduplica alertas derivados do parecer online", () => {
    expect(
      getOnlineResearchAlerts(
        "Informação não confirmada; fonte insuficiente; notícia antiga; risco alto; risco alto.",
      ),
    ).toEqual([
      "Informação crítica não confirmada",
      "Risco alto",
      "Fonte insuficiente",
      "Possível dado desatualizado",
    ]);
  });
});
