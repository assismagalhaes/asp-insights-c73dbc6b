import { supabase } from "@/lib/supabase-public";
import {
  getEdgeEfetivo,
  getOddEfetiva,
  normalizeAiDecision,
  type FeedbackIaResultado,
  type Prognostico,
  type Validacao,
} from "@/lib/db";

type QueryErrorLike = { message: string };
type QueryResultLike<T = unknown> = { data: T | null; error: QueryErrorLike | null };
type AiQueryLike<T = unknown> = PromiseLike<QueryResultLike<T>> & {
  select: (columns?: string) => AiQueryLike<T>;
  eq: (column: string, value: unknown) => AiQueryLike<T>;
  in: (column: string, values: readonly unknown[]) => AiQueryLike<T>;
  order: (column: string, opts?: { ascending?: boolean }) => AiQueryLike<T>;
  limit: (count: number) => AiQueryLike<T>;
};

const aiDb = supabase as unknown as {
  from: (table: string) => AiQueryLike;
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
  total_semelhantes: number;
  confiabilidade: "SEM_AMOSTRA" | "BAIXA" | "MODERADA" | "ALTA";
  taxa_confirmacao: number;
  taxa_pular: number;
  acerto_confirmacoes: number;
  acerto_pulos_teoricos: number;
  principais_tags_red: string[];
  confirmadas_red: string[];
  texto: string;
}

type LearningTarget = Pick<
  Prognostico,
  "id" | "data" | "hora" | "esporte" | "liga" | "mercado" | "pick"
>;

type HistoricalPrognostico = Prognostico & {
  resultados?: Array<{
    resultado: string;
    lucro_prejuizo: number | null;
    created_at: string;
    data_resultado: string | null;
  }>;
  validacoes?: Array<Partial<Validacao>>;
};

function numberFromLine(line: string | null | undefined): number | null {
  if (!line) return null;
  const match = line.replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalized(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pickSignature(value: string | null | undefined) {
  const pick = normalized(value);
  if (/\b1x\b/.test(pick)) return "double:1x";
  if (/\bx2\b/.test(pick)) return "double:x2";
  if (/\b12\b/.test(pick)) return "double:12";

  const direction = /\bunder\b/.test(pick) ? "under" : /\bover\b/.test(pick) ? "over" : "";
  const side = /\b(casa|mandante|home)\b/.test(pick)
    ? "home"
    : /\b(visitante|fora|away)\b/.test(pick)
      ? "away"
      : /\b(empate|draw)\b/.test(pick)
        ? "draw"
        : "";
  const btts = /\b(btts|ambas)\b/.test(pick)
    ? /\b(nao|no)\b/.test(pick)
      ? "btts:no"
      : "btts:yes"
    : "";
  return [direction, side, btts].filter(Boolean).join(":");
}

function isSimilarPick(a: string | null | undefined, b: string | null | undefined) {
  const signatureA = pickSignature(a);
  const signatureB = pickSignature(b);
  return Boolean(signatureA && signatureB && signatureA === signatureB);
}

function lineTolerance(prognostico: Pick<Prognostico, "esporte" | "mercado">) {
  const context = normalized(`${prognostico.esporte} ${prognostico.mercado}`);
  if (/basketball|nba|wnba/.test(context)) return /handicap/.test(context) ? 2.5 : 5;
  return 0.5;
}

function resolvedAt(row: FeedbackIaResultado) {
  const timestamp = Date.parse(String(row.created_at ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function targetCutoff(prognostico?: LearningTarget) {
  if (!prognostico?.data) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(`${prognostico.data}T${prognostico.hora || "23:59:59"}-03:00`);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function dedupeByPrediction(rows: FeedbackIaResultado[]) {
  const sorted = [...rows].sort((a, b) => resolvedAt(b) - resolvedAt(a));
  const seen = new Set<string>();
  return sorted.filter((row) => {
    const key = row.prognostico_id || row.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function conservativeRate(successes: number, total: number, prior = 0.5, strength = 8) {
  return total ? ((successes + prior * strength) / (total + strength)) * 100 : 0;
}

function sampleReliability(total: number): AiCalibrationSummary["confiabilidade"] {
  if (!total) return "SEM_AMOSTRA";
  if (total < 10) return "BAIXA";
  if (total < 30) return "MODERADA";
  return "ALTA";
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
    const key =
      [row.esporte, row.liga, row.mercado, row.pick].filter(Boolean).join(" / ") || "Sem contexto";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => `${label} (${count})`);
}

export async function getAiCalibrationSummary(
  prognostico?: LearningTarget,
): Promise<AiCalibrationSummary> {
  const { data, error } = await aiDb
    .from("feedback_ia_resultados")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) console.warn("[Aprendizado IA] Memória persistente indisponível:", error.message);
  const persistedRows = error ? [] : ((data ?? []) as FeedbackIaResultado[]);
  const cutoff = targetCutoff(prognostico);
  const rows = dedupeByPrediction(
    mergeFeedbackRows(persistedRows, await getHistoricalFeedbackRows(500)),
  ).filter(
    (row) =>
      row.prognostico_id !== prognostico?.id &&
      resolvedAt(row) < cutoff &&
      (getOutcome(row) === "GREEN" || getOutcome(row) === "RED"),
  );
  const decided = rows.filter((row) => normalizeDecision(row.decisao_ia_sugerida) != null);
  if (!decided.length) return emptyCalibrationSummary();

  const confirmed = decided.filter(
    (row) => normalizeDecision(row.decisao_ia_sugerida) === "CONFIRMAR",
  );
  const skipped = decided.filter((row) => normalizeDecision(row.decisao_ia_sugerida) === "PULAR");
  const confirmedGreen = confirmed.filter((row) => getOutcome(row) === "GREEN").length;
  const skippedRed = skipped.filter((row) => getOutcome(row) === "RED").length;
  const redRows = decided.filter((row) => getOutcome(row) === "RED");
  const confirmedRed = confirmed.filter((row) => getOutcome(row) === "RED");
  const sameSportMarket = prognostico
    ? decided.filter(
        (row) =>
          normalized(row.esporte) === normalized(prognostico.esporte) &&
          normalized(row.mercado) === normalized(prognostico.mercado),
      )
    : [];
  const similar = prognostico
    ? sameSportMarket.filter((row) => {
        if (prognostico.liga && row.liga && normalized(row.liga) !== normalized(prognostico.liga))
          return false;
        if (!isSimilarPick(row.pick, prognostico.pick)) return false;
        const targetLine = numberFromLine(prognostico.pick);
        const rowLine = numberFromLine(row.pick) ?? numberFromLine(row.linha);
        return (
          targetLine == null ||
          rowLine == null ||
          Math.abs(targetLine - rowLine) <= lineTolerance(prognostico)
        );
      })
    : [];
  const similarGreens = similar.filter((row) => getOutcome(row) === "GREEN").length;
  const taxaConfirmacao = (confirmed.length / decided.length) * 100;
  const taxaPular = (skipped.length / decided.length) * 100;
  const acertoConfirmacoes = conservativeRate(confirmedGreen, confirmed.length);
  const acertoPulos = conservativeRate(skippedRed, skipped.length);
  const similarRate = conservativeRate(similarGreens, similar.length);
  const tags = topTags(redRows);
  const situacoes = topSituations(confirmedRed);
  const cohortLine = sameSportMarket.length
    ? `- Coorte esporte + mercado (${prognostico?.esporte} / ${prognostico?.mercado}): ${sameSportMarket.length} casos, ${greenRedText(sameSportMarket)}.`
    : "- Coorte esporte + mercado: amostra inexistente.";
  const similarLine = similar.length
    ? `- Casos realmente semelhantes (liga, lado/direção e faixa da pick): n=${similar.length}, ${greenRedText(similar)}, taxa conservadora ${similarRate.toFixed(1)}%, confiabilidade ${sampleReliability(similar.length)}.`
    : "- Casos realmente semelhantes: amostra inexistente.";
  const highConfirmationWarning =
    decided.length >= 10 && taxaConfirmacao > 85
      ? "\nAtenção: a taxa recente de confirmação está muito alta. Reforce a auditoria de risco e procure motivos reais para PULAR."
      : "";

  return {
    total: decided.length,
    total_semelhantes: similar.length,
    confiabilidade: sampleReliability(similar.length),
    taxa_confirmacao: taxaConfirmacao,
    taxa_pular: taxaPular,
    acerto_confirmacoes: acertoConfirmacoes,
    acerto_pulos_teoricos: acertoPulos,
    principais_tags_red: tags,
    confirmadas_red: situacoes,
    texto: `Memória operacional ASP Insights (somente casos resolvidos antes deste evento):
- Base deduplicada: ${decided.length} prognósticos com decisão da IA; confirmação ${taxaConfirmacao.toFixed(1)}%, pulo ${taxaPular.toFixed(1)}%.
- Confirmações: n=${confirmed.length}, taxa de GREEN conservadora ${acertoConfirmacoes.toFixed(1)}%.
- Pulos: n=${skipped.length}, taxa conservadora de RED evitado ${acertoPulos.toFixed(1)}%.
${cohortLine}
${similarLine}
- Principais riscos associados a RED: ${tags.length ? tags.join(", ") : "sem dados suficientes"}.
- Situações em que IA confirmou e deu RED: ${situacoes.length ? situacoes.join("; ") : "sem dados suficientes"}.
- Use como apoio de calibração, nunca como gatilho automático. Ignore conclusões direcionais com menos de 10 casos semelhantes.${highConfirmationWarning}`,
  };
}

export async function getSimilarAiHistory(
  prognostico: Prognostico,
): Promise<SimilarAiHistorySummary> {
  const query = aiDb
    .from("feedback_ia_resultados")
    .select("*")
    .eq("esporte", prognostico.esporte)
    .eq("mercado", prognostico.mercado);
  const { data, error } = prognostico.liga ? await query.eq("liga", prognostico.liga) : await query;
  if (error) console.warn("[Aprendizado IA] Histórico persistente indisponível:", error.message);

  const targetLine = numberFromLine(prognostico.pick);
  const sourceRows = dedupeByPrediction(
    mergeFeedbackRows(
      error ? [] : ((data ?? []) as FeedbackIaResultado[]),
      await getHistoricalFeedbackRows(500),
    ),
  );
  const rows = sourceRows.filter((row) => {
    if (row.prognostico_id === prognostico.id || resolvedAt(row) >= targetCutoff(prognostico))
      return false;
    if (
      normalized(row.esporte) !== normalized(prognostico.esporte) ||
      normalized(row.mercado) !== normalized(prognostico.mercado)
    )
      return false;
    if (prognostico.liga && row.liga && normalized(row.liga) !== normalized(prognostico.liga))
      return false;
    if (!isSimilarPick(row.pick, prognostico.pick)) return false;
    const rowLine = numberFromLine(row.pick) ?? numberFromLine(row.linha);
    return (
      targetLine == null ||
      rowLine == null ||
      Math.abs(targetLine - rowLine) <= lineTolerance(prognostico)
    );
  });

  const greens = rows.filter((row) => getOutcome(row) === "GREEN").length;
  const reds = rows.filter((row) => getOutcome(row) === "RED").length;
  const lucro = rows.reduce(
    (sum, row) => sum + Number(row.lucro_teorico_unidades ?? row.lucro_unidades ?? 0),
    0,
  );
  const stake = rows.reduce(
    (sum, row) => sum + Math.abs(Number(row.stake_ia_sugerida ?? row.stake_humana_final ?? 0)),
    0,
  );
  const roi = stake > 0 ? (lucro / stake) * 100 : 0;
  const winRate = greens + reds > 0 ? (greens / (greens + reds)) * 100 : 0;
  const redRows = rows.filter((row) => getOutcome(row) === "RED");
  const greenRows = rows.filter((row) => getOutcome(row) === "GREEN");

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
        : `Histórico semelhante com ${rows.length} casos, ${winRate.toFixed(1)}% de acerto observado e ${lucro.toFixed(2)}u teóricas.`,
  };
}

function getOutcome(row: FeedbackIaResultado): string | null {
  return normalizeOutcome(row.resultado_teorico ?? row.resultado_real);
}

function mergeFeedbackRows(
  primary: FeedbackIaResultado[],
  historical: FeedbackIaResultado[],
): FeedbackIaResultado[] {
  const ids = new Set(primary.map((row) => row.prognostico_id).filter(Boolean));
  return [...primary, ...historical.filter((row) => !ids.has(row.prognostico_id))];
}

async function getHistoricalFeedbackRows(limit: number): Promise<FeedbackIaResultado[]> {
  const { data, error } = await supabase
    .from("prognosticos")
    .select("*, resultados(resultado, lucro_prejuizo, data_resultado, created_at), validacoes(*)")
    .in("resultado", ["GREEN", "RED", "WIN", "WINS", "LOSS", "LOSSES"])
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[Aprendizado IA] Histórico retroativo indisponível:", error.message);
    return [];
  }

  return ((data ?? []) as HistoricalPrognostico[])
    .map((p): FeedbackIaResultado | null => {
      const resultado = normalizeOutcome(p.resultado);
      if (!resultado) return null;
      const validacao = latestByCreatedAt(p.validacoes ?? []);
      const resultadoRow = latestByCreatedAt(p.resultados ?? []);
      const decisaoHumana = normalizeAiDecision(validacao?.decisao ?? p.status_validacao);
      const decisaoIa = normalizeAiDecision(validacao?.decisao_ia_sugerida);
      const contaBankroll = decisaoHumana === "CONFIRMAR";
      const lucro = Number(resultadoRow?.lucro_prejuizo ?? p.lucro_prejuizo ?? 0);
      return {
        id: `retro-${p.id}`,
        prognostico_id: p.id,
        analise_ia_id: null,
        modo_ia: validacao?.modo_ia ?? null,
        esporte: p.esporte,
        liga: p.liga,
        mercado: p.mercado,
        pick: p.pick,
        linha: null,
        jogo: p.jogo,
        decisao_ia_sugerida: decisaoIa,
        stake_ia_sugerida: validacao?.stake_ia_sugerida ?? null,
        decisao_humana_final: decisaoHumana,
        stake_humana_final: Number(validacao?.stake_confirmada ?? p.stake ?? 0),
        resultado_real: resultado,
        resultado_teorico: resultado,
        resultado_financeiro: contaBankroll ? resultado : null,
        conta_bankroll: contaBankroll,
        lucro_prejuizo: contaBankroll ? lucro : 0,
        lucro_unidades: lucro,
        lucro_teorico_unidades: lucro,
        lucro_financeiro_unidades: contaBankroll ? lucro : 0,
        odd_usada: getOddEfetiva(p),
        probabilidade_final: p.probabilidade_final,
        edge_usado: getEdgeEfetivo(p),
        tags_risco: extractTags(
          validacao?.parecer_ia ?? validacao?.parecer_validacao ?? p.observacoes,
        ),
        fontes_consultadas: validacao?.fontes_consultadas ?? null,
        buscas_realizadas: validacao?.buscas_realizadas ?? null,
        acertou_ia: decisaoIa ? decisionHit(decisaoIa, resultado) : null,
        acertou_humano: decisaoHumana ? decisionHit(decisaoHumana, resultado) : null,
        divergencia_ia_humano: decisaoIa && decisaoHumana ? decisaoIa !== decisaoHumana : null,
        created_at: resultadoRow?.created_at ?? p.updated_at ?? p.created_at,
        updated_at: p.updated_at,
      } satisfies FeedbackIaResultado;
    })
    .filter((row): row is FeedbackIaResultado => Boolean(row));
}

function normalizeOutcome(resultado: string | null | undefined): "GREEN" | "RED" | null {
  const value = String(resultado ?? "")
    .toUpperCase()
    .trim();
  if (["GREEN", "WIN", "WINS"].includes(value)) return "GREEN";
  if (["RED", "LOSS", "LOSSES"].includes(value)) return "RED";
  return null;
}

function latestByCreatedAt<T extends { created_at?: string | null }>(rows: T[]): T | null {
  if (!rows.length) return null;
  return (
    [...rows].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0] ?? null
  );
}

function decisionHit(
  decision: "CONFIRMAR" | "PULAR" | null,
  resultado: "GREEN" | "RED",
): boolean | null {
  if (decision === "CONFIRMAR") return resultado === "GREEN";
  if (decision === "PULAR") return resultado === "RED";
  return null;
}

function extractTags(text: string | null | undefined): string[] {
  const value = normalized(text);
  const tags: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ["info_ausente", /nao encontrado|ausente|incert|nao confirmad/],
    [
      "risco_estrutural",
      /risco estrutural|lineup|escalacao|rotacao|desfalque|lesao|questionavel|bullpen|starter/,
    ],
    ["fonte_fraca", /fonte insuficiente|fonte fraca|sem fonte|desatualizad|noticia antiga/],
    ["duplicidade", /duplicidade|correlac|redundan/],
    ["volatilidade", /volatil|variancia|amostra pequena|baixa consistencia/],
    ["conflito_modelo_mercado", /conflito forte|divergencia.*mercado|conflito.*mercado/],
    ["preco_insuficiente", /odd insuficiente|edge fraco|edge negativo|sem valor/],
    ["clima", /clima|vento|chuva|temperatura|weather/],
  ];
  for (const [tag, pattern] of checks) {
    if (pattern.test(value)) tags.push(tag);
  }
  return tags;
}

function normalizeDecision(decision: string | null | undefined): "CONFIRMAR" | "PULAR" | null {
  return normalizeAiDecision(decision);
}

function greenRedText(rows: FeedbackIaResultado[]) {
  const greens = rows.filter((row) => getOutcome(row) === "GREEN").length;
  const reds = rows.filter((row) => getOutcome(row) === "RED").length;
  return `${greens} GREEN / ${reds} RED`;
}

function emptyCalibrationSummary(): AiCalibrationSummary {
  return {
    total: 0,
    total_semelhantes: 0,
    confiabilidade: "SEM_AMOSTRA",
    taxa_confirmacao: 0,
    taxa_pular: 0,
    acerto_confirmacoes: 0,
    acerto_pulos_teoricos: 0,
    principais_tags_red: [],
    confirmadas_red: [],
    texto: `Memória operacional ASP Insights:
- Histórico com decisão da IA e resultado resolvido indisponível.
- Não use o aprendizado como sinal até existir amostra válida.`,
  };
}

export function getAiLearningFinancialContext(p: Prognostico) {
  return {
    odd_usada: getOddEfetiva(p),
    edge_usado: getEdgeEfetivo(p),
  };
}
