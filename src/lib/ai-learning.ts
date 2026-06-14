import { supabase } from "@/integrations/supabase/client";
import { getEdgeEfetivo, getOddEfetiva, type FeedbackIaResultado, type Prognostico } from "@/lib/db";

const aiDb = supabase as unknown as {
  from: (table: string) => {
    select: (columns?: string) => any;
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
