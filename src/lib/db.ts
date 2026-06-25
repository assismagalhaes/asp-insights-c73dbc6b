import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase-public";

export type Status =
  | "PENDENTE"
  | "CONFIRMA"
  | "CONFIRMA_CAUTELA"
  | "PASS"
  | "AGUARDAR_NOTICIA"
  | "PULAR"; // legado
export type Resultado = "PENDENTE" | "GREEN" | "RED" | "PUSH" | "VOID" | "HALF GREEN" | "HALF RED";

export type StatusPublicacao = "NAO_PUBLICADO" | "PUBLICADO" | "FINALIZADO" | "CANCELADO";

export interface Prognostico {
  id: string;
  data: string;
  hora: string | null;
  esporte: string;
  liga: string;
  jogo: string;
  mandante: string;
  visitante: string;
  mercado: string;
  pick: string;
  linha: string | null;
  odd_ofertada: number;
  odd_ajustada: number | null;
  odd_valor: number;
  probabilidade_final: number;
  edge: number;
  edge_ajustado: number | null;
  stake: number;
  status_validacao: Status;
  status_publicacao: StatusPublicacao;
  resultado: Resultado;
  lucro_prejuizo: number | null;
  observacoes: string | null;
  dados_tecnicos: string | null;
  contexto_modelo: string | null;
  arquivo_contexto: string | null;
  origem_modelo: string | null;
  job_id_coleta: string | null;
  data_publicacao: string | null;
  tip_texto: string | null;
  publicado_em: string | null;
  publicado_por: string | null;
  canal_publicacao: string | null;
  placar_final?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Validacao {
  id: string;
  prognostico_id: string;
  decisao: string;
  stake_confirmada: number | null;
  justificativa: string | null;
  riscos_identificados: string | null;
  comentarios_analista: string | null;
  parecer_validacao: string | null;
  contexto_adicional: string | null;
  parecer_ia: string | null;
  decisao_ia_sugerida: string | null;
  stake_ia_sugerida: number | null;
  data_analise_ia: string | null;
  prompt_versao: string | null;
  modo_ia: string | null;
  fontes_consultadas: { titulo: string; url: string }[] | null;
  buscas_realizadas: string[] | null;
  created_at: string;
}

export interface AnaliseIa {
  id: string;
  prognostico_id: string | null;
  validacao_id: string | null;
  modo_ia: "local" | "online" | string;
  esporte: string | null;
  liga: string | null;
  mercado: string | null;
  pick: string | null;
  linha: string | null;
  jogo: string | null;
  data_evento: string | null;
  hora_evento: string | null;
  odd_usada: number | null;
  probabilidade_final: number | null;
  edge_usado: number | null;
  contexto_analisado: string | null;
  parecer_ia: string | null;
  decisao_sugerida: string | null;
  stake_sugerida: number | null;
  riscos_identificados: string | null;
  tags_risco: string[] | null;
  fontes_consultadas: { titulo: string; url: string }[] | null;
  buscas_realizadas: string[] | null;
  prompt_versao: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface FeedbackIaResultado {
  id: string;
  prognostico_id: string | null;
  analise_ia_id: string | null;
  modo_ia: "local" | "online" | string | null;
  esporte: string | null;
  liga: string | null;
  mercado: string | null;
  pick: string | null;
  linha: string | null;
  jogo: string | null;
  decisao_ia_sugerida: string | null;
  stake_ia_sugerida: number | null;
  decisao_humana_final: string | null;
  stake_humana_final: number | null;
  resultado_real: "GREEN" | "RED" | string | null;
  resultado_teorico: "GREEN" | "RED" | string | null;
  resultado_financeiro: "GREEN" | "RED" | string | null;
  conta_bankroll: boolean | null;
  lucro_prejuizo: number | null;
  lucro_unidades: number | null;
  lucro_teorico_unidades: number | null;
  lucro_financeiro_unidades: number | null;
  odd_usada: number | null;
  probabilidade_final: number | null;
  edge_usado: number | null;
  tags_risco: string[] | null;
  fontes_consultadas: { titulo: string; url: string }[] | null;
  buscas_realizadas: string[] | null;
  acertou_ia: boolean | null;
  acertou_humano: boolean | null;
  divergencia_ia_humano: boolean | null;
  created_at: string;
  updated_at: string | null;
}

/** Odd efetiva: ajustada se houver, senão a original. */
export function getOddEfetiva(p: Pick<Prognostico, "odd_ofertada" | "odd_ajustada">): number {
  return p.odd_ajustada != null && p.odd_ajustada > 0 ? p.odd_ajustada : p.odd_ofertada;
}

/** Edge efetivo: ajustado se houver, senão o original. */
export function getEdgeEfetivo(p: Pick<Prognostico, "edge" | "edge_ajustado">): number {
  return p.edge_ajustado != null ? p.edge_ajustado : p.edge;
}

/** Calcula edge a partir de prob (%) e odd. */
export function calcEdge(probabilidadePct: number, odd: number): number {
  if (!probabilidadePct || !odd) return 0;
  return Number((((probabilidadePct / 100) * odd - 1) * 100).toFixed(2));
}

/** Dados técnicos efetivos: contexto_modelo, dados_tecnicos ou observacoes legadas. */
export function getDadosTecnicos(
  p: Pick<Prognostico, "dados_tecnicos" | "observacoes"> & Partial<Pick<Prognostico, "contexto_modelo">>,
): string | null {
  return (
    (p.contexto_modelo && p.contexto_modelo.trim()) ||
    (p.dados_tecnicos && p.dados_tecnicos.trim()) ||
    (p.observacoes && p.observacoes.trim()) ||
    null
  );
}

const aiDb = supabase as unknown as {
  from: (table: string) => {
    select: (columns?: string) => any;
    insert: (values: Record<string, unknown> | Record<string, unknown>[]) => any;
    upsert: (values: Record<string, unknown> | Record<string, unknown>[], opts?: Record<string, unknown>) => any;
    update: (values: Record<string, unknown>) => any;
  };
};

export function normalizeAiDecision(decision: string | null | undefined): "CONFIRMAR" | "PULAR" | null {
  if (!decision) return null;
  const d = decision.toUpperCase().trim();
  if (d.includes("PULAR") || d.includes("PASS") || d.includes("AGUARDAR")) return "PULAR";
  if (d.includes("CONFIRMA")) return "CONFIRMAR";
  return null;
}

function decisionHit(decision: "CONFIRMAR" | "PULAR" | null, resultado: Resultado): boolean | null {
  if (resultado !== "GREEN" && resultado !== "RED") return null;
  if (decision === "CONFIRMAR") return resultado === "GREEN";
  if (decision === "PULAR") return resultado === "RED";
  return null;
}

export function extractRiskTags(text: string | null | undefined): string[] {
  const s = (text ?? "").toLowerCase();
  const tags: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ["info_ausente", /não encontrado|nao encontrado|ausente|incert|não confirmad|nao confirmad/],
    ["risco_estrutural", /risco estrutural|lineup|escalação|escalacao|rotação|rotacao|desfalque|lesão|lesao|questionável|questionavel/],
    ["fonte_fraca", /fonte insuficiente|fonte fraca|sem fonte|desatualizad|notícia antiga|noticia antiga/],
    ["duplicidade", /duplicidade|correlaç|correlac|redundan/],
    ["volatilidade", /volátil|volatil|variância|variancia|mercado volátil|mercado volatil/],
    ["clima", /clima|vento|chuva|temperatura|weather/],
  ];
  for (const [tag, pattern] of checks) {
    if (pattern.test(s)) tags.push(tag);
  }
  return tags;
}

export type AnaliseIaInput = Omit<Partial<AnaliseIa>, "id" | "created_at" | "updated_at"> & {
  prognostico_id: string;
  modo_ia: string;
};

export async function saveAnaliseIaSnapshot(input: AnaliseIaInput): Promise<AnaliseIa | null> {
  const payload = {
    ...input,
    decisao_sugerida: normalizeAiDecision(input.decisao_sugerida) ?? input.decisao_sugerida ?? null,
    tags_risco: input.tags_risco ?? extractRiskTags(input.parecer_ia),
  };
  const { data, error } = await aiDb
    .from("analises_ia")
    .insert(payload as Record<string, unknown>)
    .select("*")
    .single();
  if (error) {
    console.warn("[Aprendizado IA] Snapshot não salvo:", error.message);
    return null;
  }
  return data as AnaliseIa;
}

async function createAiFeedbackForResultado(input: Omit<ResultadoRow, "id" | "created_at">): Promise<void> {
  if (input.resultado !== "GREEN" && input.resultado !== "RED") return;

  const { data: prognostico, error: progError } = await supabase
    .from("prognosticos")
    .select("*")
    .eq("id", input.prognostico_id)
    .maybeSingle();
  if (progError || !prognostico) {
    if (progError) console.warn("[Aprendizado IA] Prognóstico não carregado:", progError.message);
    return;
  }

  const p = mapPrognostico(prognostico as Record<string, unknown>);
  const contaBankroll = p.status_validacao === "CONFIRMA";

  const { data: validacao } = await supabase
    .from("validacoes")
    .select("*")
    .eq("prognostico_id", input.prognostico_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: analises, error: analisesError } = await aiDb
    .from("analises_ia")
    .select("*")
    .eq("prognostico_id", input.prognostico_id);
  if (analisesError) {
    console.warn("[Aprendizado IA] Análises não carregadas:", analisesError.message);
    return;
  }

  const rows = ((analises ?? []) as AnaliseIa[]).filter((a) => a.decisao_sugerida);
  if (!rows.length) return;

  const decisaoHumana = normalizeAiDecision((validacao as Validacao | null)?.decisao ?? p.status_validacao);
  const stakeHumana = Number((validacao as Validacao | null)?.stake_confirmada ?? p.stake ?? 0);
  const oddUsada = getOddEfetiva(p);
  const edgeUsado = getEdgeEfetivo(p);
  const lucroTeorico = input.lucro_prejuizo;
  const lucroFinanceiro = contaBankroll ?input.lucro_prejuizo : 0;
  const resultadoFinanceiro = contaBankroll ?input.resultado : null;
  const feedbackRows = rows.map((a) => {
    const decisaoIa = normalizeAiDecision(a.decisao_sugerida);
    const acertouIa = decisionHit(decisaoIa, input.resultado);
    const acertouHumano = decisionHit(decisaoHumana, input.resultado);
    return {
      prognostico_id: input.prognostico_id,
      analise_ia_id: a.id,
      modo_ia: a.modo_ia,
      esporte: p.esporte,
      liga: p.liga,
      mercado: p.mercado,
      pick: p.pick,
      linha: p.linha,
      jogo: p.jogo,
      decisao_ia_sugerida: decisaoIa,
      stake_ia_sugerida: a.stake_sugerida,
      decisao_humana_final: decisaoHumana,
      stake_humana_final: stakeHumana,
      resultado_real: input.resultado,
      resultado_teorico: input.resultado,
      resultado_financeiro: resultadoFinanceiro,
      conta_bankroll: contaBankroll,
      lucro_prejuizo: lucroFinanceiro,
      lucro_unidades: lucroTeorico,
      lucro_teorico_unidades: lucroTeorico,
      lucro_financeiro_unidades: lucroFinanceiro,
      odd_usada: oddUsada,
      probabilidade_final: p.probabilidade_final,
      edge_usado: edgeUsado,
      tags_risco: a.tags_risco ?? extractRiskTags(a.parecer_ia),
      fontes_consultadas: a.fontes_consultadas,
      buscas_realizadas: a.buscas_realizadas,
      acertou_ia: acertouIa,
      acertou_humano: acertouHumano,
      divergencia_ia_humano: decisaoIa != null && decisaoHumana != null ?decisaoIa !== decisaoHumana : null,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await aiDb
    .from("feedback_ia_resultados")
    .upsert(feedbackRows as Record<string, unknown>[], { onConflict: "prognostico_id,analise_ia_id" });
  if (error) console.warn("[Aprendizado IA] Feedback não salvo:", error.message);
}

export interface ResultadoRow {
  id: string;
  prognostico_id: string;
  resultado: Resultado;
  placar_final: string | null;
  odd_fechamento: number | null;
  lucro_prejuizo: number;
  data_resultado: string;
  created_at: string;
}

export interface BankrollRow {
  id: string;
  data: string;
  banca_inicial: number;
  banca_atual: number;
  valor_unidade: number;
  lucro_acumulado: number;
  roi: number;
  yield: number;
  drawdown: number;
  created_at: string;
}

export type TipoStake = "FIXO" | "PERCENTUAL";
export interface Configuracao {
  id: string;
  nome_plataforma: string;
  valor_unidade_padrao: number;
  banca_inicial: number;
  esportes_ativos: string[];
  mercados_ativos: string[];
  tipo_stake: TipoStake;
  percentual_unidade: number;
  created_at: string;
  updated_at: string;
}

const num = (v: unknown) => (v == null ?0 : Number(v));
const numOrNull = (v: unknown) => (v == null ?null : Number(v));
const mapPrognostico = (r: Record<string, unknown>): Prognostico => ({
  ...(r as unknown as Prognostico),
  odd_ofertada: num(r.odd_ofertada),
  odd_ajustada: numOrNull(r.odd_ajustada),
  odd_valor: num(r.odd_valor),
  probabilidade_final: num(r.probabilidade_final),
  edge: num(r.edge),
  edge_ajustado: numOrNull(r.edge_ajustado),
  stake: num(r.stake),
  lucro_prejuizo: r.lucro_prejuizo == null ?null : Number(r.lucro_prejuizo),
});

// ===== Prognósticos =====
export function usePrognosticos() {
  return useQuery({
    queryKey: ["prognosticos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prognosticos")
        .select("*, resultados(placar_final, created_at)")
        .order("data", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => {
        const rs = (r.resultados as Array<{ placar_final: string | null; created_at: string }> | null) ?? [];
        const last = rs.length
          ?[...rs].sort((a, b) => (a.created_at < b.created_at ?1 : -1))[0]
          : null;
        return { ...mapPrognostico(r), placar_final: last?.placar_final ?? null };
      });
    },
  });
}

export type PrognosticoInput = Omit<
  Prognostico,
  | "id"
  | "created_at"
  | "updated_at"
  | "lucro_prejuizo"
  | "status_publicacao"
  | "resultado"
  | "data_publicacao"
  | "tip_texto"
  | "publicado_em"
  | "publicado_por"
  | "canal_publicacao"
  | "placar_final"
  | "odd_ajustada"
  | "edge_ajustado"
  | "dados_tecnicos"
  | "contexto_modelo"
  | "arquivo_contexto"
  | "origem_modelo"
  | "job_id_coleta"
> & {
  status_publicacao?: StatusPublicacao;
  resultado?: Resultado;
  odd_ajustada?: number | null;
  edge_ajustado?: number | null;
  dados_tecnicos?: string | null;
  contexto_modelo?: string | null;
  arquivo_contexto?: string | null;
  origem_modelo?: string | null;
  job_id_coleta?: string | null;
};

export function useCreatePrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PrognosticoInput) => {
      const { data, error } = await supabase.from("prognosticos").insert(input as never).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prognosticos"] }),
  });
}

export function useUpdatePrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Prognostico> & { id: string }) => {
      const { placar_final: _pf, ...rest } = patch;
      const { data, error } = await supabase.from("prognosticos").update(rest as never).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prognosticos"] }),
  });
}

export function useDeletePrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prognosticos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prognosticos"] }),
  });
}

export function useBulkDeletePrognosticos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase.from("prognosticos").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prognosticos"] }),
  });
}

// ===== Validações =====
export type ValidacaoInput = Partial<Omit<Validacao, "id" | "created_at" | "prognostico_id">> & {
  prognostico_id: string;
  decisao: string;
};

export function useCreateValidacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ValidacaoInput) => {
      const { data, error } = await supabase.from("validacoes").insert(input).select().single();
      if (error) throw error;
      const stakeEspelhada =
        input.decisao === "PULAR"
          ? Number(input.stake_confirmada ?? 1) || 1
          : input.stake_confirmada ?? undefined;
      const prognosticoPatch: Partial<Prognostico> = { status_validacao: input.decisao as Status };
      if (stakeEspelhada !== undefined) prognosticoPatch.stake = stakeEspelhada;
      // espelha decisão no prognóstico
      await supabase
        .from("prognosticos")
        .update(prognosticoPatch)
        .eq("id", input.prognostico_id);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["validacoes"] });
    },
  });
}

// ===== Resultados =====
export function useCreateResultado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<ResultadoRow, "id" | "created_at">) => {
      const { data, error } = await supabase.from("resultados").insert(input).select().single();
      if (error) throw error;
      await createAiFeedbackForResultado(input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["bankroll"] });
      qc.invalidateQueries({ queryKey: ["resultados"] });
      qc.invalidateQueries({ queryKey: ["ai-learning"] });
    },
  });
}

// ===== Bankroll =====
export function useBankroll() {
  return useQuery({
    queryKey: ["bankroll"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bankroll_historico")
        .select("*")
        .order("data", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...(r as unknown as BankrollRow),
        banca_inicial: Number(r.banca_inicial),
        banca_atual: Number(r.banca_atual),
        valor_unidade: Number(r.valor_unidade),
        lucro_acumulado: Number(r.lucro_acumulado),
        roi: Number(r.roi),
        yield: Number(r.yield),
        drawdown: Number(r.drawdown),
      }));
    },
  });
}

// ===== Configurações =====
export function useConfiguracao() {
  return useQuery({
    queryKey: ["configuracao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...(data as unknown as Configuracao),
        valor_unidade_padrao: Number(data.valor_unidade_padrao),
        banca_inicial: Number(data.banca_inicial),
        tipo_stake: ((data as Record<string, unknown>).tipo_stake as TipoStake) ?? "FIXO",
        percentual_unidade: Number((data as Record<string, unknown>).percentual_unidade ?? 1),
      };
    },
  });
}

export function useUpdateConfiguracao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Configuracao> & { id: string }) => {
      const { id, ...rest } = patch;
      const { data, error } = await supabase.from("configuracoes").update(rest).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["configuracao"] }),
  });
}

// ===== Constantes auxiliares =====
export const ESPORTES_DEFAULT = ["Futebol", "Basketball", "Baseball", "American Football", "Hockey"];

export const MERCADOS_DEFAULT = [
  "Moneyline",
  "Resultado da Partida",
  "Total de Gols",
  "Total de Pontos",
  "Total de Corridas",
  "Handicap Asiático",
  "Ambas Marcam",
  "Dupla Chance",
  "Total de Escanteios",
  "ASP GoalMatrix",
  "ASP CornerMatrix",
];

export function normalizeMercadoPadrao(mercado: string, esporte?: string | null): string {
  const raw = String(mercado ?? "").trim();
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const sport = String(esporte ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/asp\s*goals?matrix|goals?matrix/.test(normalized)) return "ASP GoalMatrix";
  if (/asp\s*corners?matrix|corners?matrix/.test(normalized)) return "ASP CornerMatrix";
  if (/resultado final|1x2|resultado da partida/.test(normalized)) return "Resultado da Partida";
  if (/ambas marcam|btts/.test(normalized)) return "Ambas Marcam";
  if (/dupla chance|double chance/.test(normalized)) return "Dupla Chance";
  if (/handicap|spread|run line/.test(normalized)) return "Handicap Asiático";
  if (/moneyline|home\/away|home away/.test(normalized)) return "Moneyline";
  if (/over\/under pontos|total de pontos|pontos/.test(normalized)) return "Total de Pontos";
  if (/over\/under corridas|total de corridas|corridas|runs/.test(normalized)) return "Total de Corridas";
  if (/over\/under gols|total de gols|gols|goals/.test(normalized)) return "Total de Gols";
  if (/over\/under|total/.test(normalized)) {
    if (sport.includes("baseball")) return "Total de Corridas";
    if (sport.includes("basketball")) return "Total de Pontos";
    return "Total de Gols";
  }
  return raw;
}

// Mapeia esporte "errado" (que é na verdade uma liga) para esporte real + liga
const LIGA_TO_ESPORTE: Record<string, { esporte: string; liga: string }> = {
  NBA: { esporte: "Basketball", liga: "NBA" },
  WNBA: { esporte: "Basketball", liga: "WNBA" },
  NCAAB: { esporte: "Basketball", liga: "NCAAB" },
  MLB: { esporte: "Baseball", liga: "MLB" },
  NFL: { esporte: "American Football", liga: "NFL" },
  NHL: { esporte: "Hockey", liga: "NHL" },
};

const ESPORTE_ALIAS: Record<string, string> = {
  SOCCER: "Futebol",
  FOOTBALL: "American Football",
  BASKETBALL: "Basketball",
  BASEBALL: "Baseball",
  HOCKEY: "Hockey",
  "AMERICAN FOOTBALL": "American Football",
  "FUTEBOL AMERICANO": "American Football",
};

/** Normaliza par (esporte, liga) para a estrutura oficial. */
export function normalizeEsporteLiga(input: { esporte?: string | null; liga?: string | null }): { esporte: string; liga: string | null } {
  const rawEsp = (input.esporte ?? "").trim();
  const rawLiga = (input.liga ?? "").trim();
  const upEsp = rawEsp.toUpperCase();

  if (LIGA_TO_ESPORTE[upEsp]) {
    const mapped = LIGA_TO_ESPORTE[upEsp];
    return { esporte: mapped.esporte, liga: rawLiga || mapped.liga };
  }
  const esporte = ESPORTE_ALIAS[upEsp] ?? rawEsp;
  return { esporte, liga: rawLiga || null };
}

// ===== Ligas =====
export interface Liga {
  id: string;
  nome: string;
  esporte: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export function useLigas() {
  return useQuery({
    queryKey: ["ligas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ligas")
        .select("*")
        .order("esporte", { ascending: true })
        .order("nome", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Liga[];
    },
  });
}

export function useUpsertLiga() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { nome: string; esporte: string }) => {
      const nome = input.nome.trim();
      const esporte = input.esporte.trim();
      if (!nome || !esporte) return null;
      const { data, error } = await supabase
        .from("ligas")
        .upsert({ nome, esporte }, { onConflict: "esporte,nome", ignoreDuplicates: true })
        .select()
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Liga | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ligas"] }),
  });
}

// Data atual no fuso de Brasília (America/Sao_Paulo) em YYYY-MM-DD
export function todayBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ===== Publicação =====
export function calcLucro(resultado: Resultado, stake: number, odd: number): number {
  switch (resultado) {
    case "GREEN":
      return Number((stake * (odd - 1)).toFixed(2));
    case "RED":
      return Number((-stake).toFixed(2));
    // Resultados legados (mantidos por compatibilidade) convertidos
    case "HALF GREEN":
      return Number((stake * (odd - 1)).toFixed(2));
    case "HALF RED":
    case "PUSH":
    case "VOID":
      return Number((-stake).toFixed(2));
    default:
      return 0;
  }
}

export function gerarTipTexto(
  p: Prognostico,
  extras?: {
    modo?: "completo" | "resumo";
    parecer?: string | null;
    dados_tecnicos?: string | null;
    /** legados - usados apenas como fallback se parecer nao vier */
    justificativa?: string | null;
    riscos?: string | null;
    comentarios?: string | null;
  },
): string {
  const linha = (p.linha ?? "").trim();
  const pickLower = (p.pick ?? "").toLowerCase();
  const linhaForaDoPick = linha && linha !== "-" && !pickLower.includes(linha.toLowerCase());
  const oddFinal = getOddEfetiva(p);
  const edgeFinal = getEdgeEfetivo(p);
  const parecerLegado = [
    extras?.justificativa?.trim(),
    extras?.riscos?.trim() ? `Riscos: ${extras.riscos.trim()}` : "",
    extras?.comentarios?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
  const parecer = extras?.parecer?.trim() || parecerLegado || "Sem justificativa final registrada.";
  const formatDateBR = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const hora = p.hora ? p.hora.slice(0, 5) : "-";
  const pickComLinha = `${p.pick}${linhaForaDoPick ? `\nLinha: ${linha}` : ""}`;
  if (extras?.modo === "resumo") return parecer;

  return `ASP INSIGHTS - PICK CONFIRMADA

Jogo: ${p.jogo}
Data/Hora: ${formatDateBR(p.data)} as ${hora}
Esporte/Liga: ${p.esporte} - ${p.liga || "-"}

Mercado: ${p.mercado}
Pick: ${pickComLinha}
Odd: ${oddFinal.toFixed(2)}${p.odd_ajustada != null ? ` (original: ${p.odd_ofertada.toFixed(2)})` : ""}
Odd de Valor: ${p.odd_valor.toFixed(2)}
Probabilidade: ${p.probabilidade_final.toFixed(1)}%
Edge: ${edgeFinal.toFixed(2)}%
Stake: ${p.stake}u

Justificativa final:
${parecer}`;
}

export function useValidacaoByPrognostico(prognosticoId: string | null | undefined) {
  return useQuery({
    queryKey: ["validacao", prognosticoId],
    enabled: !!prognosticoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("validacoes")
        .select("*")
        .eq("prognostico_id", prognosticoId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Validacao | null) ?? null;
    },
  });
}

export function usePublicarPrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      tip_texto: string;
      canal_publicacao?: string | null;
      publicado_por?: string | null;
    }) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("prognosticos")
        .update({
          status_publicacao: "PUBLICADO",
          data_publicacao: now,
          publicado_em: now,
          tip_texto: input.tip_texto,
          canal_publicacao: input.canal_publicacao ?? "MANUAL",
          publicado_por: input.publicado_por ?? "admin",
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prognosticos"] }),
  });
}

export function useCancelarPrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prognosticos").update({ status_publicacao: "CANCELADO" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prognosticos"] }),
  });
}
