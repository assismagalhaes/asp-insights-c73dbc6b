import { getOddEfetiva, type Prognostico, type Resultado, type ResultadoFinanceiro } from "./db";

export const PICK_RESOLVIDA: Resultado[] = ["GREEN", "RED"];
export const PICK_GREEN: Resultado[] = ["GREEN"];
export const PICK_RED: Resultado[] = ["RED"];

/** Lucro/prejuizo em unidades para um prognostico individual. */
export function lucroUnidades(p: Pick<Prognostico, "resultado" | "stake" | "odd_ofertada" | "odd_ajustada">): number {
  const { resultado, stake } = p;
  const odd = getOddEfetiva(p);
  switch (resultado) {
    case "GREEN":
      return stake * (odd - 1);
    case "RED":
      return -stake;
    default:
      return 0;
  }
}

export function lucroReais(
  p: Pick<Prognostico, "resultado" | "stake" | "odd_ofertada" | "odd_ajustada">,
  valorUnidade: number,
): number {
  return lucroUnidades(p) * valorUnidade;
}

export interface Metrics {
  greens: number;
  reds: number;
  resolvidas: number;
  totalApostadoU: number;
  totalApostadoR$: number;
  lucroU: number;
  lucroReais: number;
  roi: number;
  yield: number;
  winRate: number;
  bancaInicial: number;
  bancaAtual: number;
  drawdown: number;
}

export interface TimelinePoint {
  data: string;
  banca: number;
  lucroAcum: number;
  roi: number;
}

/** Calcula metricas a partir da view financeira canonica. */
export function computeFinancialMetrics(
  resultados: ResultadoFinanceiro[],
  cfg: { banca_inicial: number; valor_unidade_padrao: number } | null | undefined,
): Metrics {
  const bancaInicial = cfg?.banca_inicial ?? 0;
  const resolvidas = resultados.filter((p) => PICK_RESOLVIDA.includes(p.resultado));
  const greens = resultados.filter((p) => PICK_GREEN.includes(p.resultado)).length;
  const reds = resultados.filter((p) => PICK_RED.includes(p.resultado)).length;
  const totalApostadoU = resolvidas.reduce((s, p) => s + p.stake, 0);
  const totalApostadoR$ = resolvidas.reduce((s, p) => s + p.stake * p.valor_unidade, 0);
  const lucroU = resultados.reduce((s, p) => s + p.lucro_unidades, 0);
  const lucroR = resultados.reduce((s, p) => s + p.lucro_reais, 0);
  const bancaAtual = bancaInicial + lucroR;
  const roi = totalApostadoR$ > 0 ? (lucroR / totalApostadoR$) * 100 : 0;
  const yld = roi;
  const winRate = resolvidas.length ? (greens / resolvidas.length) * 100 : 0;

  const timeline = bankrollTimelineFromFinanceiros(resultados, bancaInicial);
  let pico = bancaInicial;
  let dd = 0;
  for (const t of timeline) {
    pico = Math.max(pico, t.banca);
    if (pico > 0) dd = Math.max(dd, ((pico - t.banca) / pico) * 100);
  }

  return {
    greens,
    reds,
    resolvidas: resolvidas.length,
    totalApostadoU,
    totalApostadoR$,
    lucroU,
    lucroReais: lucroR,
    roi,
    yield: yld,
    winRate,
    bancaInicial,
    bancaAtual,
    drawdown: dd,
  };
}

/** Evolucao da banca por data de resultado a partir da view financeira. */
export function bankrollTimelineFromFinanceiros(
  resultados: ResultadoFinanceiro[],
  bancaInicial: number,
): TimelinePoint[] {
  const byDate = new Map<string, number>();
  for (const p of resultados) {
    byDate.set(p.data_resultado, (byDate.get(p.data_resultado) ?? 0) + p.lucro_reais);
  }
  const datas = Array.from(byDate.keys()).sort();
  let banca = bancaInicial;
  let lucroAcum = 0;
  return datas.map((d) => {
    const delta = byDate.get(d) ?? 0;
    banca += delta;
    lucroAcum += delta;
    const roi = bancaInicial ? (lucroAcum / bancaInicial) * 100 : 0;
    return {
      data: d,
      banca: Number(banca.toFixed(2)),
      lucroAcum: Number(lucroAcum.toFixed(2)),
      roi: Number(roi.toFixed(2)),
    };
  });
}

// ===== Filtros de periodo =====
export type PeriodoFiltro = "hoje" | "ontem" | "7d" | "30d" | "mes" | "ano" | "tudo" | "custom";

export function dateInRange(d: string, ini?: string | null, fim?: string | null): boolean {
  if (ini && d < ini) return false;
  if (fim && d > fim) return false;
  return true;
}

function brNow(): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(s + "T00:00:00");
}
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function rangeFromPeriodo(p: PeriodoFiltro, customIni?: string, customFim?: string): { ini: string | null; fim: string | null } {
  const hoje = brNow();
  const f = fmt(hoje);
  if (p === "hoje") return { ini: f, fim: f };
  if (p === "ontem") {
    const i = new Date(hoje); i.setDate(i.getDate() - 1);
    const s = fmt(i);
    return { ini: s, fim: s };
  }
  if (p === "7d") {
    const i = new Date(hoje); i.setDate(i.getDate() - 6);
    return { ini: fmt(i), fim: f };
  }
  if (p === "30d") {
    const i = new Date(hoje); i.setDate(i.getDate() - 29);
    return { ini: fmt(i), fim: f };
  }
  if (p === "mes") {
    const i = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return { ini: fmt(i), fim: f };
  }
  if (p === "ano") {
    const i = new Date(hoje.getFullYear(), 0, 1);
    return { ini: fmt(i), fim: f };
  }
  if (p === "custom") return { ini: customIni || null, fim: customFim || null };
  return { ini: null, fim: null };
}

export const PERIODOS_OPCOES: { v: PeriodoFiltro; label: string }[] = [
  { v: "hoje", label: "Hoje" },
  { v: "ontem", label: "Ontem" },
  { v: "7d", label: "Últimos 7 dias" },
  { v: "30d", label: "Últimos 30 dias" },
  { v: "mes", label: "Mês atual" },
  { v: "ano", label: "Ano atual" },
  { v: "tudo", label: "Todo o período" },
  { v: "custom", label: "Personalizado" },
];
