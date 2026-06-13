import { getOddEfetiva, type FeedbackIaResultado, type Prognostico, type Resultado, type ResultadoFinanceiro } from "./db";

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

export interface PerformanceFilters {
  ini?: string | null;
  fim?: string | null;
  esporte?: string;
  liga?: string;
  mercado?: string;
  resultado?: Resultado | "all";
  decisaoHumana?: "CONFIRMA" | "PULAR" | "PENDENTE" | "all";
  modoIa?: "local" | "online" | "all";
}

export interface PerformanceBucket {
  nome: string;
  greens: number;
  reds: number;
  resolvidas: number;
  lucroU: number;
  lucroReais: number;
  totalApostadoU: number;
  totalApostadoR$: number;
  roi: number;
  yield: number;
  winRate: number;
}

export interface MonthlyPerformance {
  mes: string;
  greens: number;
  reds: number;
  lucroU: number;
  lucroReais: number;
  roi: number;
}

export interface PerformanceStats extends Metrics {
  filtrados: ResultadoFinanceiro[];
  evolucaoBanca: TimelinePoint[];
  evolucaoRoi: TimelinePoint[];
  resultadoPorEsporte: PerformanceBucket[];
  resultadoPorLiga: PerformanceBucket[];
  resultadoPorMercado: PerformanceBucket[];
  resultadoPorMes: MonthlyPerformance[];
  roiPorEsporte: PerformanceBucket[];
  roiPorLiga: PerformanceBucket[];
  roiPorMercado: PerformanceBucket[];
}

function applyPerformanceFilters(resultados: ResultadoFinanceiro[], filters: PerformanceFilters = {}) {
  return resultados.filter((p) => {
    if (!dateInRange(p.data, filters.ini, filters.fim)) return false;
    if (filters.esporte && filters.esporte !== "all" && p.esporte !== filters.esporte) return false;
    if (filters.liga && filters.liga !== "all" && p.liga !== filters.liga) return false;
    if (filters.mercado && filters.mercado !== "all" && p.mercado !== filters.mercado) return false;
    if (filters.resultado && filters.resultado !== "all" && p.resultado !== filters.resultado) return false;
    if (filters.decisaoHumana && filters.decisaoHumana !== "all" && p.decisao_final !== filters.decisaoHumana && p.status_validacao !== filters.decisaoHumana) return false;
    return true;
  });
}

function bucketFromRows(nome: string, rows: ResultadoFinanceiro[]): PerformanceBucket {
  const greens = rows.filter((p) => p.resultado === "GREEN").length;
  const reds = rows.filter((p) => p.resultado === "RED").length;
  const totalApostadoU = rows.reduce((s, p) => s + p.stake, 0);
  const totalApostadoR$ = rows.reduce((s, p) => s + p.stake * p.valor_unidade, 0);
  const lucroU = rows.reduce((s, p) => s + p.lucro_unidades, 0);
  const lucroReais = rows.reduce((s, p) => s + p.lucro_reais, 0);
  const resolvidas = greens + reds;
  const roi = totalApostadoR$ > 0 ? (lucroReais / totalApostadoR$) * 100 : 0;
  const winRate = resolvidas ? (greens / resolvidas) * 100 : 0;
  return {
    nome,
    greens,
    reds,
    resolvidas,
    lucroU,
    lucroReais,
    totalApostadoU,
    totalApostadoR$,
    roi,
    yield: roi,
    winRate,
  };
}

function groupPerformance(resultados: ResultadoFinanceiro[], key: "esporte" | "liga" | "mercado"): PerformanceBucket[] {
  const map = new Map<string, ResultadoFinanceiro[]>();
  for (const row of resultados) {
    const name = row[key] || "-";
    map.set(name, [...(map.get(name) ?? []), row]);
  }
  return Array.from(map.entries())
    .map(([nome, rows]) => bucketFromRows(nome, rows))
    .sort((a, b) => Math.abs(b.lucroU) - Math.abs(a.lucroU));
}

function monthlyPerformance(resultados: ResultadoFinanceiro[]): MonthlyPerformance[] {
  const map = new Map<string, ResultadoFinanceiro[]>();
  for (const row of resultados) {
    const mes = row.data_resultado.slice(0, 7);
    map.set(mes, [...(map.get(mes) ?? []), row]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, rows]) => {
      const bucket = bucketFromRows(mes, rows);
      return {
        mes,
        greens: bucket.greens,
        reds: bucket.reds,
        lucroU: Number(bucket.lucroU.toFixed(2)),
        lucroReais: Number(bucket.lucroReais.toFixed(2)),
        roi: Number(bucket.roi.toFixed(2)),
      };
    });
}

export function calculatePerformanceStats(
  resultados: ResultadoFinanceiro[],
  cfg: { banca_inicial: number; valor_unidade_padrao: number } | null | undefined,
  filters: PerformanceFilters = {},
): PerformanceStats {
  const filtrados = applyPerformanceFilters(resultados, filters);
  const bancaInicial = cfg?.banca_inicial ?? 0;
  const resolvidas = filtrados.filter((p) => PICK_RESOLVIDA.includes(p.resultado));
  const greens = filtrados.filter((p) => PICK_GREEN.includes(p.resultado)).length;
  const reds = filtrados.filter((p) => PICK_RED.includes(p.resultado)).length;
  const totalApostadoU = resolvidas.reduce((s, p) => s + p.stake, 0);
  const totalApostadoR$ = resolvidas.reduce((s, p) => s + p.stake * p.valor_unidade, 0);
  const lucroU = filtrados.reduce((s, p) => s + p.lucro_unidades, 0);
  const lucroR = filtrados.reduce((s, p) => s + p.lucro_reais, 0);
  const bancaAtual = bancaInicial + lucroR;
  const roi = totalApostadoR$ > 0 ? (lucroR / totalApostadoR$) * 100 : 0;
  const yld = roi;
  const winRate = resolvidas.length ? (greens / resolvidas.length) * 100 : 0;

  const timeline = bankrollTimelineFromFinanceiros(filtrados, bancaInicial);
  let pico = bancaInicial;
  let dd = 0;
  for (const t of timeline) {
    pico = Math.max(pico, t.banca);
    if (pico > 0) dd = Math.max(dd, ((pico - t.banca) / pico) * 100);
  }

  const resultadoPorEsporte = groupPerformance(filtrados, "esporte");
  const resultadoPorLiga = groupPerformance(filtrados, "liga");
  const resultadoPorMercado = groupPerformance(filtrados, "mercado");

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
    filtrados,
    evolucaoBanca: timeline,
    evolucaoRoi: timeline,
    resultadoPorEsporte,
    resultadoPorLiga,
    resultadoPorMercado,
    resultadoPorMes: monthlyPerformance(filtrados),
    roiPorEsporte: resultadoPorEsporte,
    roiPorLiga: resultadoPorLiga,
    roiPorMercado: resultadoPorMercado,
  };
}

/** Compatibilidade: use calculatePerformanceStats em novas telas. */
export function computeFinancialMetrics(
  resultados: ResultadoFinanceiro[],
  cfg: { banca_inicial: number; valor_unidade_padrao: number } | null | undefined,
): Metrics {
  return calculatePerformanceStats(resultados, cfg);
}

export function calculateLearningPerformanceStats(rows: FeedbackIaResultado[], filters: PerformanceFilters = {}) {
  const filtered = rows.filter((r) => {
    const d = r.created_at.slice(0, 10);
    if (!dateInRange(d, filters.ini, filters.fim)) return false;
    if (filters.esporte && filters.esporte !== "all" && r.esporte !== filters.esporte) return false;
    if (filters.liga && filters.liga !== "all" && r.liga !== filters.liga) return false;
    if (filters.mercado && filters.mercado !== "all" && r.mercado !== filters.mercado) return false;
    if (filters.modoIa && filters.modoIa !== "all" && r.modo_ia !== filters.modoIa) return false;
    if (filters.resultado && filters.resultado !== "all" && r.resultado_real !== filters.resultado) return false;
    if (filters.decisaoHumana && filters.decisaoHumana !== "all" && r.decisao_humana_final !== filters.decisaoHumana) return false;
    return true;
  });
  const greens = filtered.filter((r) => r.resultado_real === "GREEN").length;
  const reds = filtered.filter((r) => r.resultado_real === "RED").length;
  const withIa = filtered.filter((r) => r.acertou_ia != null);
  const acertoIa = withIa.length ? (withIa.filter((r) => r.acertou_ia).length / withIa.length) * 100 : 0;
  const lucroU = filtered.reduce((s, r) => s + Number(r.lucro_unidades ?? 0), 0);
  const totalApostadoU = filtered.reduce((s, r) => s + Math.abs(Number(r.lucro_unidades ?? 0)), 0);
  const roi = totalApostadoU > 0 ? (lucroU / totalApostadoU) * 100 : 0;
  const lucroIaConfirma = filtered.filter((r) => r.decisao_ia_sugerida === "CONFIRMA").reduce((s, r) => s + Number(r.lucro_unidades ?? 0), 0);
  const lucroDivergente = filtered.filter((r) => r.divergencia_ia_humano).reduce((s, r) => s + Number(r.lucro_unidades ?? 0), 0);
  return { filtered, greens, reds, totalResolvidos: greens + reds, acertoIa, lucroU, totalApostadoU, roi, yield: roi, lucroIaConfirma, lucroDivergente };
}

/** Evolucao da banca por data de resultado a partir da view financeira. */
export function bankrollTimelineFromFinanceiros(
  resultados: ResultadoFinanceiro[],
  bancaInicial: number,
): TimelinePoint[] {
  const byDate = new Map<string, { lucro: number; apostado: number }>();
  for (const p of resultados) {
    const cur = byDate.get(p.data_resultado) ?? { lucro: 0, apostado: 0 };
    cur.lucro += p.lucro_reais;
    cur.apostado += p.stake * p.valor_unidade;
    byDate.set(p.data_resultado, cur);
  }
  const datas = Array.from(byDate.keys()).sort();
  let banca = bancaInicial;
  let lucroAcum = 0;
  let apostadoAcum = 0;
  return datas.map((d) => {
    const delta = byDate.get(d) ?? { lucro: 0, apostado: 0 };
    banca += delta.lucro;
    lucroAcum += delta.lucro;
    apostadoAcum += delta.apostado;
    const roi = apostadoAcum ? (lucroAcum / apostadoAcum) * 100 : 0;
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
