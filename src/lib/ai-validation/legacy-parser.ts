export type LegacyAiDecision = {
  decisao: "CONFIRMA" | "PULAR";
  stake: number | null;
  prognostico_id_escolhido: string | null;
  pick_escolhida: string | null;
};

export function normalizeLegacyDecision(value: string | null | undefined): "CONFIRMA" | "PULAR" {
  const normalized = value?.toLowerCase() ?? "pular";
  return /\bconfirma|confirmar\b/.test(normalized) ? "CONFIRMA" : "PULAR";
}

export function parseLegacyAiDecision(text: string): LegacyAiDecision {
  const groupDecisionMatch = text.match(
    /decis[aã]o_grupo\s*:\s*"?\s*(confirma|confirmar|pular|pass)/i,
  );
  const decisionMatch =
    groupDecisionMatch ??
    text.match(
      /decis[aã]o(?:\s+final)?\s*:\s*(confirma|confirmar|pular|pass|aguardar not[ií]cia|confirma com cautela)/i,
    );
  const slice = decisionMatch?.index != null ? text.slice(decisionMatch.index) : text;
  const decisao = normalizeLegacyDecision(decisionMatch?.[1]);
  const stakeMatch =
    slice.match(/stake_confirmada\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i) ??
    slice.match(/stake[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);
  const stake =
    decisao === "CONFIRMA" && stakeMatch ? Number(stakeMatch[1].replace(",", ".")) : null;
  const idMatch = text.match(/prognostico_id_escolhido\s*:\s*"?\s*([0-9a-f-]{8,}|null)/i);
  const pickMatch = text.match(/pick_escolhida\s*:\s*"?\s*([^"\n\r]+)/i);
  const prognostico_id_escolhido =
    idMatch?.[1] && idMatch[1].toLowerCase() !== "null" ? idMatch[1].trim() : null;
  const pick_escolhida =
    pickMatch?.[1] && pickMatch[1].trim().toLowerCase() !== "null" ? pickMatch[1].trim() : null;

  return { decisao, stake, prognostico_id_escolhido, pick_escolhida };
}
