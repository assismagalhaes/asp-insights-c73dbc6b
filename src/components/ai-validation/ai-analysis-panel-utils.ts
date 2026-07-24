export function formatAiOpinionForDisplay(opinion: string): string {
  return opinion
    .split(/\r?\n/)
    .filter((line) => !/^\s*"?decis[aã]o_grupo"?\s*:/i.test(line))
    .filter((line) => !/^\s*"?prognostico_id_escolhido"?\s*:/i.test(line))
    .filter((line) => !/^\s*"?stake_confirmada"?\s*:/i.test(line))
    .map((line) =>
      line
        .replace(/^\s*"?pick_escolhida"?\s*:/i, "Pick escolhida:")
        .replace(/^\s*"?justificativa_(?:linha|pick)"?\s*:/i, "Justificativa da pick escolhida:")
        .replace(/^\s*"?riscos"?\s*:/i, "Principais riscos:")
        .replace(/^\s*"?condicao_invalidacao"?\s*:/i, "Condição de invalidação:")
        .replace(/\bCONFIRMA\b/g, "CONFIRMAR")
        .replace(/\bPASS\b/g, "PULAR"),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getOnlineResearchAlerts(opinion: string): string[] {
  const text = opinion.toLowerCase();
  const alerts: string[] = [];

  if (
    /aguardar confirma|não confirmad|nao confirmad|incert|não encontrado|nao encontrado/.test(text)
  ) {
    alerts.push("Informação crítica não confirmada");
  }
  if (/risco alto|impacto na aposta:\s*alto/.test(text)) {
    alerts.push("Risco alto");
  }
  if (
    /fonte insuficiente|sem fonte confiável|sem fonte confiavel|fonte não confiável|fonte nao confiavel/.test(
      text,
    )
  ) {
    alerts.push("Fonte insuficiente");
  }
  if (/desatualizad|notícia antiga|noticia antiga|sem data/.test(text)) {
    alerts.push("Possível dado desatualizado");
  }

  return Array.from(new Set(alerts));
}
