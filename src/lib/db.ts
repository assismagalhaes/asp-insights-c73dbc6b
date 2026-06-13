import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Status =
  | "PENDENTE"
  | "CONFIRMA"
  | "PULAR";
export type Resultado = "PENDENTE" | "GREEN" | "RED";

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
  prognostico_id: string;
  modo_ia: "local" | "online";
  esporte: string;
  liga: string;
  mercado: string;
  pick: string;
  linha: string | null;
  odd_original: number | null;
  odd_ajustada: number | null;
  odd_valor: number | null;
  odd_usada: number | null;
  probabilidade_final: number | null;
  edge_original: number | null;
  edge_ajustado: number | null;
  edge_usado: number | null;
  contexto_analisado: string | null;
  parecer_ia: string | null;
  decisao_sugerida: "CONFIRMA" | "PULAR" | null;
  stake_sugerida: number | null;
  riscos_identificados: string | null;
  tags_risco: string[] | null;
  fontes_consultadas: { titulo: string; url: string }[] | null;
  buscas_realizadas: string[] | null;
  alertas_online: string[] | null;
  prompt_versao: string | null;
  created_at: string;
}

export interface FeedbackIaResultado {
  id: string;
  prognostico_id: string;
  analise_ia_id: string | null;
  modo_ia: "local" | "online" | null;
  decisao_ia_sugerida: "CONFIRMA" | "PULAR" | null;
  decisao_humana_final: "CONFIRMA" | "PULAR" | null;
  resultado_real: "GREEN" | "RED" | null;
  lucro_prejuizo: number | null;
  lucro_unidades: number | null;
  esporte: string | null;
  liga: string | null;
  mercado: string | null;
  pick: string | null;
  linha: string | null;
  odd_usada: number | null;
  probabilidade_final: number | null;
  edge_usado: number | null;
  tags_risco: string[] | null;
  fontes_consultadas: { titulo: string; url: string }[] | null;
  acertou_ia: boolean | null;
  acertou_humano: boolean | null;
  divergencia_ia_humano: boolean | null;
  created_at: string;
}

export interface ResumoAprendizadoIa {
  id: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  total_analises: number;
  total_green: number;
  total_red: number;
  win_rate: number;
  roi: number;
  yield: number;
  resumo_geral: string | null;
  aprendizados_por_esporte: Record<string, unknown> | null;
  aprendizados_por_mercado: Record<string, unknown> | null;
  alertas_recorrentes: Record<string, unknown> | null;
  recomendacoes_para_prompt: string | null;
  created_at: string;
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

/** Dados técnicos efetivos: dados_tecnicos se houver, senão observacoes (legado). */
export function getDadosTecnicos(p: Pick<Prognostico, "dados_tecnicos" | "observacoes">): string | null {
  return (p.dados_tecnicos && p.dados_tecnicos.trim()) || (p.observacoes && p.observacoes.trim()) || null;
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

export interface ResultadoFinanceiro {
  resultado_id: string | null;
  prognostico_id: string;
  data: string;
  data_resultado: string;
  esporte: string;
  liga: string;
  mercado: string;
  jogo: string;
  pick: string;
  linha: string | null;
  status_validacao: Status;
  decisao_final: "CONFIRMA" | "PULAR" | "PENDENTE" | null;
  resultado: "GREEN" | "RED";
  stake: number;
  odd_efetiva: number;
  valor_unidade: number;
  lucro_unidades: number;
  lucro_reais: number;
}

export interface BankrollCalculadoRow {
  data: string;
  lucro_dia_reais: number;
  lucro_acum: number;
  banca: number;
  roi: number;
  drawdown: number;
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

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const stringArrayOrNull = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  return v.map(String).filter(Boolean);
};
export function normalizeResultado(value: unknown): Resultado {
  const s = String(value ?? "PENDENTE").trim().toUpperCase();
  if (s === "GREEN" || s === "WIN" || s === "WINS") return "GREEN";
  if (s === "RED" || s === "LOSS" || s === "LOSSES") return "RED";
  return "PENDENTE";
}

const mapPrognostico = (r: Record<string, unknown>): Prognostico => ({
  ...(r as unknown as Prognostico),
  resultado: normalizeResultado(r.resultado),
  odd_ofertada: num(r.odd_ofertada),
  odd_ajustada: numOrNull(r.odd_ajustada),
  odd_valor: num(r.odd_valor),
  probabilidade_final: num(r.probabilidade_final),
  edge: num(r.edge),
  edge_ajustado: numOrNull(r.edge_ajustado),
  stake: num(r.stake),
  lucro_prejuizo: r.lucro_prejuizo == null ? null : Number(r.lucro_prejuizo),
});

// ===== Prognósticos =====
const PROGNOSTICO_LIST_COLUMNS = `
  id,
  data,
  esporte,
  liga,
  jogo,
  mandante,
  visitante,
  mercado,
  pick,
  linha,
  odd_ofertada,
  odd_valor,
  probabilidade_final,
  edge,
  stake,
  status_validacao,
  status_publicacao,
  resultado,
  lucro_prejuizo,
  created_at,
  updated_at
`;

export function usePrognosticos() {
  return useQuery({
    queryKey: ["prognosticos"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prognosticos")
        .select(PROGNOSTICO_LIST_COLUMNS)
        .order("data", { ascending: false })
        .order("created_at", { ascending: false });
      if (!error) return (data ?? []).map((r: Record<string, unknown>) => mapPrognosticoComPlacar(r));

      const fallback = await supabase
        .from("prognosticos")
        .select("*")
        .order("data", { ascending: false })
        .order("created_at", { ascending: false });
      if (fallback.error) throw fallback.error;
      return (fallback.data ?? []).map((r: Record<string, unknown>) => mapPrognosticoComPlacar(r));
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
> & {
  status_publicacao?: StatusPublicacao;
  resultado?: Resultado;
  odd_ajustada?: number | null;
  edge_ajustado?: number | null;
  dados_tecnicos?: string | null;
};

export function useCreatePrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PrognosticoInput) => {
      const { data, error } = await supabase.from("prognosticos").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prognosticos"] }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["resultados-financeiros"] });
      qc.invalidateQueries({ queryKey: ["bankroll-calculado"] });
    },
  });
}

export async function fetchPrognosticoDetail(id: string): Promise<Prognostico> {
  const { data, error } = await supabase
    .from("prognosticos")
    .select("*, resultados(placar_final, created_at)")
    .eq("id", id)
    .single();
  if (!error) return mapPrognosticoComPlacar(data as Record<string, unknown>);

  const fallback = await supabase
    .from("prognosticos")
    .select("*")
    .eq("id", id)
    .single();
  if (fallback.error) throw fallback.error;
  return mapPrognosticoComPlacar(fallback.data as Record<string, unknown>);
}

export function usePrognosticoDetail(id: string | null | undefined) {
  return useQuery({
    queryKey: ["prognostico-detail", id],
    enabled: !!id,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: () => fetchPrognosticoDetail(id!),
  });
}

export function useUpdatePrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Prognostico> & { id: string }) => {
      const { placar_final: _pf, ...rest } = patch;
      const { data, error } = await supabase.from("prognosticos").update(rest).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["prognostico-detail"] });
      qc.invalidateQueries({ queryKey: ["resultados-financeiros"] });
      qc.invalidateQueries({ queryKey: ["bankroll-calculado"] });
    },
  });
}

export function useDeletePrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prognosticos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["prognostico-detail"] });
      qc.invalidateQueries({ queryKey: ["resultados-financeiros"] });
      qc.invalidateQueries({ queryKey: ["bankroll-calculado"] });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["resultados-financeiros"] });
      qc.invalidateQueries({ queryKey: ["bankroll-calculado"] });
    },
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
      const status = input.decisao === "CONFIRMA" ? "CONFIRMA" : "PULAR";
      // espelha decisão no prognóstico
      await supabase
        .from("prognosticos")
        .update({ status_validacao: status, stake: input.stake_confirmada ?? undefined })
        .eq("id", input.prognostico_id);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["prognostico-detail"] });
      qc.invalidateQueries({ queryKey: ["validacoes"] });
      qc.invalidateQueries({ queryKey: ["resultados-financeiros"] });
      qc.invalidateQueries({ queryKey: ["bankroll-calculado"] });
    },
  });
}

// ===== Aprendizado da IA =====
export type AnaliseIaInput = Omit<AnaliseIa, "id" | "created_at">;

const mapAnaliseIa = (r: Record<string, unknown>): AnaliseIa => ({
  ...(r as unknown as AnaliseIa),
  odd_original: numOrNull(r.odd_original),
  odd_ajustada: numOrNull(r.odd_ajustada),
  odd_valor: numOrNull(r.odd_valor),
  odd_usada: numOrNull(r.odd_usada),
  probabilidade_final: numOrNull(r.probabilidade_final),
  edge_original: numOrNull(r.edge_original),
  edge_ajustado: numOrNull(r.edge_ajustado),
  edge_usado: numOrNull(r.edge_usado),
  stake_sugerida: numOrNull(r.stake_sugerida),
  tags_risco: stringArrayOrNull(r.tags_risco),
});

const mapPrognosticoComPlacar = (r: Record<string, unknown>): Prognostico => {
  const rs = (r.resultados as Array<{ placar_final: string | null; created_at: string }> | null) ?? [];
  const last = rs.length
    ? [...rs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
    : null;
  return { ...mapPrognostico(r), placar_final: last?.placar_final ?? null };
};

const mapFeedbackIa = (r: Record<string, unknown>): FeedbackIaResultado => ({
  ...(r as unknown as FeedbackIaResultado),
  resultado_real:
    normalizeResultado(r.resultado_real) === "PENDENTE"
      ? null
      : (normalizeResultado(r.resultado_real) as "GREEN" | "RED"),
  lucro_prejuizo: numOrNull(r.lucro_prejuizo),
  lucro_unidades: numOrNull(r.lucro_unidades),
  odd_usada: numOrNull(r.odd_usada),
  probabilidade_final: numOrNull(r.probabilidade_final),
  edge_usado: numOrNull(r.edge_usado),
  tags_risco: stringArrayOrNull(r.tags_risco),
});

const mapResumoAprendizado = (r: Record<string, unknown>): ResumoAprendizadoIa => ({
  ...(r as unknown as ResumoAprendizadoIa),
  total_analises: num(r.total_analises),
  total_green: num(r.total_green),
  total_red: num(r.total_red),
  win_rate: num(r.win_rate),
  roi: num(r.roi),
  yield: num(r.yield),
});

export function useCreateAnaliseIa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AnaliseIaInput) => {
      const { data, error } = await (supabase as unknown as {
        from: (table: "analises_ia") => {
          insert: (payload: AnaliseIaInput) => {
            select: () => { single: () => Promise<{ data: Record<string, unknown>; error: Error | null }> };
          };
        };
      })
        .from("analises_ia")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return mapAnaliseIa(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["analises-ia"] });
      qc.invalidateQueries({ queryKey: ["aprendizado-ia"] });
    },
  });
}

export function useAnalisesIaByPrognostico(prognosticoId: string | null | undefined) {
  return useQuery({
    queryKey: ["analises-ia", prognosticoId],
    enabled: !!prognosticoId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: "analises_ia") => {
          select: (columns: string) => {
            eq: (column: string, value: string) => {
              order: (
                column: string,
                opts?: { ascending?: boolean },
              ) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }>;
            };
          };
        };
      })
        .from("analises_ia")
        .select("*")
        .eq("prognostico_id", prognosticoId!)
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data ?? []).map(mapAnaliseIa);
    },
  });
}

export function useFeedbackIaResultados() {
  return useQuery({
    queryKey: ["aprendizado-ia", "feedback"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: "feedback_ia_resultados") => {
          select: (columns: string) => {
            order: (
              column: string,
              opts?: { ascending?: boolean },
            ) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }>;
          };
        };
      })
        .from("feedback_ia_resultados")
        .select("id, prognostico_id, analise_ia_id, modo_ia, decisao_ia_sugerida, decisao_humana_final, resultado_real, lucro_prejuizo, lucro_unidades, esporte, liga, mercado, pick, linha, odd_usada, probabilidade_final, edge_usado, tags_risco, acertou_ia, acertou_humano, divergencia_ia_humano, created_at")
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data ?? []).map(mapFeedbackIa);
    },
  });
}

export function useResumosAprendizadoIa() {
  return useQuery({
    queryKey: ["aprendizado-ia", "resumos"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: "resumos_aprendizado_ia") => {
          select: (columns: string) => {
            order: (
              column: string,
              opts?: { ascending?: boolean },
            ) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }>;
          };
        };
      })
        .from("resumos_aprendizado_ia")
        .select("id, periodo_inicio, periodo_fim, total_analises, total_green, total_red, win_rate, roi, yield, resumo_geral, created_at")
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data ?? []).map(mapResumoAprendizado);
    },
  });
}

export function useCreateResumoAprendizadoIa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<ResumoAprendizadoIa, "id" | "created_at">) => {
      const { data, error } = await (supabase as unknown as {
        from: (table: "resumos_aprendizado_ia") => {
          insert: (payload: Omit<ResumoAprendizadoIa, "id" | "created_at">) => {
            select: () => { single: () => Promise<{ data: Record<string, unknown>; error: Error | null }> };
          };
        };
      })
        .from("resumos_aprendizado_ia")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return mapResumoAprendizado(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aprendizado-ia"] }),
  });
}

// ===== Resultados =====
export function useCreateResultado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<ResultadoRow, "id" | "created_at">) => {
      const { data, error } = await supabase.from("resultados").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["bankroll"] });
      qc.invalidateQueries({ queryKey: ["resultados"] });
      qc.invalidateQueries({ queryKey: ["resultados-financeiros"] });
      qc.invalidateQueries({ queryKey: ["bankroll-calculado"] });
      qc.invalidateQueries({ queryKey: ["aprendizado-ia"] });
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

// ===== Views financeiras =====
type ViewClient = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (
        column: string,
        opts?: { ascending?: boolean },
      ) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }>;
    };
  };
};

const mapResultadoFinanceiro = (r: Record<string, unknown>): ResultadoFinanceiro => ({
  ...(r as unknown as ResultadoFinanceiro),
  resultado: normalizeResultado(r.resultado) as "GREEN" | "RED",
  stake: Number(r.stake),
  odd_efetiva: Number(r.odd_efetiva),
  valor_unidade: Number(r.valor_unidade),
  lucro_unidades: Number(r.lucro_unidades),
  lucro_reais: Number(r.lucro_reais),
});

async function fetchResultadosFinanceirosFallback(): Promise<ResultadoFinanceiro[]> {
  const configPromise = supabase
    .from("configuracoes")
    .select("valor_unidade_padrao")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const prognosticosPromise = supabase
    .from("prognosticos")
    .select("*")
    .order("data", { ascending: true })
    .order("created_at", { ascending: true });
  const resultadosPromise = supabase
    .from("resultados")
    .select("*")
    .order("created_at", { ascending: false });

  const [configResult, prognosticosResult, resultadosResult] = await Promise.all([
    configPromise,
    prognosticosPromise,
    resultadosPromise,
  ]);
  if (prognosticosResult.error) throw prognosticosResult.error;

  const configData = configResult.data as { valor_unidade_padrao?: number | string | null } | null;
  const valorUnidade = Number(configData?.valor_unidade_padrao ?? 10);
  const resultadosPorPrognostico = new Map<
    string,
    { resultado: Resultado; data_resultado: string | null; id: string | null }
  >();
  if (!resultadosResult.error) {
    for (const row of resultadosResult.data ?? []) {
      const r = row as Record<string, unknown>;
      const resultado = normalizeResultado(r.resultado);
      const prognosticoId = String(r.prognostico_id ?? "");
      if (!prognosticoId || resultadosPorPrognostico.has(prognosticoId)) continue;
      if (resultado === "GREEN" || resultado === "RED") {
        resultadosPorPrognostico.set(prognosticoId, {
          resultado,
          data_resultado: String(r.data_resultado ?? ""),
          id: r.id == null ? null : String(r.id),
        });
      }
    }
  }

  return (prognosticosResult.data ?? [])
    .map((r: Record<string, unknown>) => {
      const p = mapPrognostico(r);
      const resultadoRegistrado = resultadosPorPrognostico.get(p.id);
      return {
        p: resultadoRegistrado ? { ...p, resultado: resultadoRegistrado.resultado } : p,
        resultadoId: resultadoRegistrado?.id ?? null,
        dataResultado: resultadoRegistrado?.data_resultado || p.data,
      };
    })
    .filter(({ p }) => p.resultado === "GREEN" || p.resultado === "RED")
    .map((p) => {
      const oddEfetiva = getOddEfetiva(p.p);
      const stake = Number(p.p.stake ?? 0);
      const lucroUnidades = p.p.resultado === "GREEN" ? stake * (oddEfetiva - 1) : -stake;
      return {
        resultado_id: p.resultadoId,
        prognostico_id: p.p.id,
        data: p.p.data,
        data_resultado: p.dataResultado,
        esporte: p.p.esporte,
        liga: p.p.liga,
        mercado: p.p.mercado,
        jogo: p.p.jogo,
        pick: p.p.pick,
        linha: p.p.linha,
        status_validacao: p.p.status_validacao,
        decisao_final: p.p.status_validacao,
        resultado: p.p.resultado as "GREEN" | "RED",
        stake,
        odd_efetiva: oddEfetiva,
        valor_unidade: valorUnidade,
        lucro_unidades: lucroUnidades,
        lucro_reais: lucroUnidades * valorUnidade,
      } satisfies ResultadoFinanceiro;
    });
}

export function useResultadosFinanceiros() {
  return useQuery({
    queryKey: ["resultados-financeiros"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as ViewClient)
        .from("vw_resultados_financeiros")
        .select("*")
        .order("data_resultado", { ascending: true });
      if (!error && data && data.length > 0) {
        return data
          .map(mapResultadoFinanceiro)
          .filter((r) => r.resultado === "GREEN" || r.resultado === "RED");
      }
      return fetchResultadosFinanceirosFallback();
    },
  });
}

export function useBankrollCalculado() {
  return useQuery({
    queryKey: ["bankroll-calculado"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as ViewClient)
        .from("vw_bankroll_timeline_calculado")
        .select("*")
        .order("data", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...(r as unknown as BankrollCalculadoRow),
        lucro_dia_reais: Number(r.lucro_dia_reais),
        lucro_acum: Number(r.lucro_acum),
        banca: Number(r.banca),
        roi: Number(r.roi),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configuracao"] });
      qc.invalidateQueries({ queryKey: ["resultados-financeiros"] });
      qc.invalidateQueries({ queryKey: ["bankroll-calculado"] });
    },
  });
}

// ===== Constantes auxiliares =====
export const ESPORTES_DEFAULT = ["Futebol", "Basketball", "Baseball", "American Football", "Hockey"];

export const MERCADOS_DEFAULT = [
  "Resultado Final",
  "Moneyline",
  "Handicap Asiático",
  "Handicap Europeu",
  "Over/Under",
  "Over/Under Pontos",
  "Ambas Marcam",
  "Dupla Chance",
  "Parlay",
  "Spread",
  "Total de Pontos",
  "Total de Corridas",
  "Total de Escanteios",
  "Player Props",
  "ASP GoalMatrix",
  "ASP CornerMatrix",
];

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
export function calcLucro(resultado: Resultado, stake: number, oddEfetiva: number): number {
  switch (resultado) {
    case "GREEN":
      return Number((stake * (oddEfetiva - 1)).toFixed(2));
    case "RED":
      return Number((-stake).toFixed(2));
    default:
      return 0;
  }
}

export function gerarTipTextoLegado(
  p: Prognostico,
  extras?: {
    parecer?: string | null;
    dados_tecnicos?: string | null;
    /** legados — usados apenas como fallback se parecer não vier */
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
  const dados = (extras?.dados_tecnicos?.trim()) || getDadosTecnicos(p) || "—";
  const parecerLegado = [
    extras?.justificativa?.trim(),
    extras?.riscos?.trim() ? `Riscos: ${extras.riscos.trim()}` : "",
    extras?.comentarios?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
  const parecer = extras?.parecer?.trim() || parecerLegado || "—";
  const formatDateBR = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const hora = p.hora ? p.hora.slice(0, 5) : "—";

  return `🔥 ASP INSIGHTS - PICK CONFIRMADA

🏆 Jogo: ${p.jogo}
📅 Data/Hora: ${formatDateBR(p.data)} às ${hora}
📊 Esporte/Liga: ${p.esporte} - ${p.liga || "—"}

🎯 Mercado: ${p.mercado}
✅ Pick: ${p.pick}${linhaForaDoPick ? `\n📌 Linha: ${linha}` : ""}
📈 Odd: ${oddFinal.toFixed(2)}${p.odd_ajustada != null ? ` (original: ${p.odd_ofertada.toFixed(2)})` : ""}
📉 Odd de Valor: ${p.odd_valor.toFixed(2)}
📊 Probabilidade: ${p.probabilidade_final.toFixed(1)}%
⚖️ Edge: ${edgeFinal.toFixed(2)}%
💰 Stake: ${p.stake}u

🧠 Dados técnicos:
${dados}

📋 Parecer:
${parecer}

📌 Status: ${p.status_validacao}`;
}

export function gerarTipTexto(
  p: Prognostico,
  extras?: {
    parecer?: string | null;
    contexto_analise?: string | null;
    pesquisa_online?: string | null;
    stake_confirmada?: number | null;
    dados_tecnicos?: string | null;
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
  const contexto = extras?.contexto_analise?.trim() || extras?.dados_tecnicos?.trim() || getDadosTecnicos(p) || "-";
  const pesquisaOnline = extras?.pesquisa_online?.trim() || "-";
  const stakeFinal = extras?.stake_confirmada ?? p.stake;
  const parecerLegado = [
    extras?.justificativa?.trim(),
    extras?.riscos?.trim() ? `Riscos: ${extras.riscos.trim()}` : "",
    extras?.comentarios?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
  const parecer = extras?.parecer?.trim() || parecerLegado || "-";
  const formatDateBR = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const hora = p.hora ? p.hora.slice(0, 5) : "-";

  return `🔥 ASP INSIGHTS - PICK CONFIRMADA

🏆 Jogo: ${p.jogo}
📅 Data/Hora: ${formatDateBR(p.data)} às ${hora}
📊 Esporte/Liga: ${p.esporte} - ${p.liga || "-"}

🎯 Mercado: ${p.mercado}
✅ Pick: ${p.pick}
📌 Linha: ${linhaForaDoPick ? linha : p.linha || "-"}
📈 Odd: ${oddFinal.toFixed(2)}
📉 Odd de Valor: ${p.odd_valor.toFixed(2)}
📊 Probabilidade: ${p.probabilidade_final.toFixed(1)}%
⚖️ Edge: ${edgeFinal.toFixed(2)}%
💰 Stake: ${stakeFinal}u

🧠 Contexto da análise:
${contexto}

🌐 Pesquisa online:
${pesquisaOnline}

📋 Parecer final:
${parecer}

📌 Status: ${p.status_validacao}`;
}

export function useValidacaoByPrognostico(prognosticoId: string | null | undefined) {
  return useQuery({
    queryKey: ["validacao", prognosticoId],
    enabled: !!prognosticoId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["prognostico-detail"] });
    },
  });
}

export function useCancelarPrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prognosticos").update({ status_publicacao: "CANCELADO" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["prognostico-detail"] });
    },
  });
}
