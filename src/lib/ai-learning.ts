import { supabase } from "@/lib/supabase-public";
import { getEdgeEfetivo, getOddEfetiva, type FeedbackIaResultado, type Prognostico } from "@/lib/db";

const aiDb = supabase as unknown as {
  from: (table: string) => {
    select: (columns?: string) => any;
    order: (column: string, opts?: { ascending?: boolean }) => any;
    limit: (count: number) => any;
  };
};

export interface SimilarAiHistorySummary {
  total: number;
  greens: number;
  reds: number;
  win_rate: number;
  lucro_unidades: number;
  roi: number;
  yield: number;
  principais_tags_risco: string[];
  principais_padroes_red: string[];
  principais_padroes_green: string[];
  conclusao: string;
}

export interface AiCalibrationSummary {
  total: number;
  taxa_confirmacao: number;
  taxa_pular: number;
  acerto_confirmacoes: number;
  acerto_pulos_teoricos: number;
  principais_tags_red: string[];
  confirmadas_red: string[];
  texto: string;
}

function numberFromLine(line: string | null | undefined): number | null {
  if (!line) return null;
  const match = line.replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function isSimilarPick(a: string | null | undefined, b: string | null | undefined) {
  const aa = (a ?? "").toLowerCase();
  const bb = (b ?? "").toLowerCase();
  if (!aa || !bb) return true;
  return aa.includes(bb) || bb.includes(aa) || aa.split(/\s+/).some((part) => part.length > 3 && bb.includes(part));
}

function topTags(rows: FeedbackIaResultado[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags_risco ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);
}

function topSituations(rows: FeedbackIaResultado[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = [row.esporte, row.liga, row.mercado, row.pick].filter(Boolean).join(" / ") || "Sem contexto";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => `${label} (${count})`);
}

export async function getAiCalibrationSummary(prognostico?: Pick<Prognostico, "esporte" | "mercado">): Promise<AiCalibrationSummary> {
  const { data, error } = await aiDb
    .from("feedback_ia_resultados")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.warn("[Aprendizado IA] Calibração indisponível:", error.message);
    return emptyCalibrationSummary();
  }

  const rows = (data ?? []) as FeedbackIaResultado[];
  const resolved = rows.filter((row) => getOutcome(row) === "GREEN" || getOutcome(row) === "RED");
  const confirmed = resolved.filter((row) => normalizeDecision(row.decisao_ia_sugerida) === "CONFIRMAR");
  const skipped = resolved.filter((row) => normalizeDecision(row.decisao_ia_sugerida) === "PULAR");
  const confirmedGreen = confirmed.filter((row) => getOutcome(row) === "GREEN").length;
  const skippedRed = skipped.filter((row) => getOutcome(row) === "RED").length;
  const redRows = resolved.filter((row) => getOutcome(row) === "RED");
  const confirmedRed = confirmed.filter((row) => getOutcome(row) === "RED");
  const sameSport = prognostico?.esporte ? resolved.filter((row) => row.esporte === prognostico.esporte) : [];
  const sameMarket = prognostico?.mercado ? resolved.filter((row) => row.mercado === prognostico.mercado) : [];
  const taxaConfirmacao = resolved.length ? (confirmed.length / resolved.length) * 100 : 0;
  const taxaPular = resolved.length ? (skipped.length / resolved.length) * 100 : 0;
  const acertoConfirmacoes = confirmed.length ? (confirmedGreen / confirmed.length) * 100 : 0;
  const acertoPulos = skipped.length ? (skippedRed / skipped.length) * 100 : 0;
  const tags = topTags(redRows);
  const situacoes = topSituations(confirmedRed);
  const sportLine = sameSport.length
    ? `- Mesmo esporte (${prognostico?.esporte}): ${sameSport.length} casos, ${greenRedText(sameSport)}.`
    : "- Mesmo esporte: amostra insuficiente ou inexistente.";
  const marketLine = sameMarket.length
    ? `- Mesmo mercado (${prognostico?.mercado}): ${sameMarket.length} casos, ${greenRedText(sameMarket)}.`
    : "- Mesmo mercado: amostra insuficiente ou inexistente.";
  const highConfirmationWarning =
    resolved.length >= 10 && taxaConfirmacao > 85
      ? "\nAtenção: a taxa recente de confirmação está muito alta. Reforce a auditoria de risco e procure motivos reais para PULAR."
      : "";

  return {
    total: resolved.length,
    taxa_confirmacao: taxaConfirmacao,
    taxa_pular: taxaPular,
    acerto_confirmacoes: acertoConfirmacoes,
    acerto_pulos_teoricos: acertoPulos,
    principais_tags_red: tags,
    confirmadas_red: situacoes,
    texto: `Calibração interna ASP Insights:
- Nas últimas ${resolved.length} análises resolvidas, a IA confirmou ${taxaConfirmacao.toFixed(1)}% e pulou ${taxaPular.toFixed(1)}%.
- Confirmações tiveram ${acertoConfirmacoes.toFixed(1)}% de GREEN.
- Picks puladas resolvidas teoricamente tiveram ${acertoPulos.toFixed(1)}% de RED.
${sportLine}
${marketLine}
- Principais riscos associados a RED: ${tags.length ? tags.join(", ") : "sem dados suficientes"}.
- Situações em que IA confirmou e deu RED: ${situacoes.length ? situacoes.join("; ") : "sem dados suficientes"}.
- Use isso apenas como apoio. Não use com menos de 10 amostras semelhantes.${highConfirmationWarning}`,
  };
}

export async function getSimilarAiHistory(prognostico: Prognostico): Promise<SimilarAiHistorySummary> {
  const query = aiDb
    .from("feedback_ia_resultados")
    .select("*")
    .eq("esporte", prognostico.esporte)
    .eq("mercado", prognostico.mercado);

  const { data, error } = prognostico.liga ? await query.eq("liga", prognostico.liga) : await query;
  if (error) {
    console.warn("[Aprendizado IA] Histórico semelhante indisponível:", error.message);
    return emptySimilarSummary();
  }

  const targetLine = numberFromLine(prognostico.linha);
  const rows = ((data ?? []) as FeedbackIaResultado[]).filter((row) => {
    if (!isSimilarPick(row.pick, prognostico.pick)) return false;
    const rowLine = numberFromLine(row.linha);
    if (targetLine == null || rowLine == null) return true;
    return Math.abs(targetLine - rowLine) <= 0.5;
  });

  const greens = rows.filter((r) => getOutcome(r) === "GREEN").length;
  const reds = rows.filter((r) => getOutcome(r) === "RED").length;
  const lucro = rows.reduce((sum, r) => sum + Number(r.lucro_teorico_unidades ?? r.lucro_unidades ?? 0), 0);
  const stake = rows.reduce((sum, r) => sum + Math.abs(Number(r.stake_humana_final ?? r.stake_ia_sugerida ?? 0)), 0);
  const roi = stake > 0 ? (lucro / stake) * 100 : 0;
  const winRate = greens + reds > 0 ? (greens / (greens + reds)) * 100 : 0;
  const redRows = rows.filter((r) => getOutcome(r) === "RED");
  const greenRows = rows.filter((r) => getOutcome(r) === "GREEN");

  return {
    total: rows.length,
    greens,
    reds,
    win_rate: winRate,
    lucro_unidades: lucro,
    roi,
    yield: roi,
    principais_tags_risco: topTags(rows),
    principais_padroes_red: topTags(redRows),
    principais_padroes_green: topTags(greenRows),
    conclusao:
      rows.length < 10
        ? "Histórico interno insuficiente para conclusão estatística."
        : `Histórico semelhante com ${rows.length} casos, ${winRate.toFixed(1)}% de acerto e ${lucro.toFixed(2)}u.`,
  };
}

function getOutcome(row: FeedbackIaResultado): string | null {
  return row.resultado_teorico ?? row.resultado_real ?? null;
}

function normalizeDecision(decision: string | null | undefined): "CONFIRMAR" | "PULAR" | null {
  if (!decision) return null;
  const d = decision.toUpperCase();
  if (d.includes("PULAR") || d.includes("PASS") || d.includes("AGUARDAR")) return "PULAR";
  if (d.includes("CONFIRMA")) return "CONFIRMAR";
  return null;
}

function greenRedText(rows: FeedbackIaResultado[]) {
  const greens = rows.filter((row) => getOutcome(row) === "GREEN").length;
  const reds = rows.filter((row) => getOutcome(row) === "RED").length;
  return `${greens} GREEN / ${reds} RED`;
}

function emptyCalibrationSummary(): AiCalibrationSummary {
  return {
    total: 0,
    taxa_confirmacao: 0,
    taxa_pular: 0,
    acerto_confirmacoes: 0,
    acerto_pulos_teoricos: 0,
    principais_tags_red: [],
    confirmadas_red: [],
    texto: `Calibração interna ASP Insights:
- Histórico interno insuficiente para conclusão estatística.
- Use isso apenas como apoio. Não use com menos de 10 amostras semelhantes.`,
  };
}

function emptySimilarSummary(): SimilarAiHistorySummary {
  return {
    total: 0,
    greens: 0,
    reds: 0,
    win_rate: 0,
    lucro_unidades: 0,
    roi: 0,
    yield: 0,
    principais_tags_risco: [],
    principais_padroes_red: [],
    principais_padroes_green: [],
    conclusao: "Histórico interno insuficiente para conclusão estatística.",
  };
}

export function getAiLearningFinancialContext(p: Prognostico) {
  return {
    odd_usada: getOddEfetiva(p),
    edge_usado: getEdgeEfetivo(p),
  };
}
