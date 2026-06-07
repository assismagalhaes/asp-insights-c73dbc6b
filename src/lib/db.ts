import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Status =
  | "PENDENTE"
  | "CONFIRMA"
  | "CONFIRMA COM CAUTELA"
  | "AGUARDAR NOTÍCIA"
  | "PASS";
export type Resultado =
  | "PENDENTE"
  | "GREEN"
  | "RED"
  | "PUSH"
  | "VOID"
  | "HALF GREEN"
  | "HALF RED";

export type StatusPublicacao =
  | "NAO_PUBLICADO"
  | "PUBLICADO"
  | "FINALIZADO"
  | "CANCELADO";

export interface Prognostico {
  id: string;
  data: string;
  esporte: string;
  liga: string;
  jogo: string;
  mandante: string;
  visitante: string;
  mercado: string;
  pick: string;
  linha: string | null;
  odd_ofertada: number;
  odd_valor: number;
  probabilidade_final: number;
  edge: number;
  stake: number;
  status_validacao: Status;
  status_publicacao: StatusPublicacao;
  resultado: Resultado;
  lucro_prejuizo: number | null;
  observacoes: string | null;
  data_publicacao: string | null;
  tip_texto: string | null;
  publicado_em: string | null;
  publicado_por: string | null;
  canal_publicacao: string | null;
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
  created_at: string;
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

export interface Configuracao {
  id: string;
  nome_plataforma: string;
  valor_unidade_padrao: number;
  banca_inicial: number;
  esportes_ativos: string[];
  mercados_ativos: string[];
  created_at: string;
  updated_at: string;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const mapPrognostico = (r: Record<string, unknown>): Prognostico => ({
  ...(r as unknown as Prognostico),
  odd_ofertada: num(r.odd_ofertada),
  odd_valor: num(r.odd_valor),
  probabilidade_final: num(r.probabilidade_final),
  edge: num(r.edge),
  stake: num(r.stake),
  lucro_prejuizo: r.lucro_prejuizo == null ? null : Number(r.lucro_prejuizo),
});

// ===== Prognósticos =====
export function usePrognosticos() {
  return useQuery({
    queryKey: ["prognosticos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prognosticos")
        .select("*")
        .order("data", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapPrognostico);
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
> & {
  status_publicacao?: StatusPublicacao;
  resultado?: Resultado;
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
  });
}

export function useUpdatePrognostico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Prognostico> & { id: string }) => {
      const { data, error } = await supabase
        .from("prognosticos")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
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

// ===== Validações =====
export function useCreateValidacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Validacao, "id" | "created_at">) => {
      const { data, error } = await supabase.from("validacoes").insert(input).select().single();
      if (error) throw error;
      // espelha decisão no prognóstico
      await supabase
        .from("prognosticos")
        .update({ status_validacao: input.decisao, stake: input.stake_confirmada ?? undefined })
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
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prognosticos"] });
      qc.invalidateQueries({ queryKey: ["bankroll"] });
      qc.invalidateQueries({ queryKey: ["resultados"] });
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
      };
    },
  });
}

export function useUpdateConfiguracao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Configuracao> & { id: string }) => {
      const { id, ...rest } = patch;
      const { data, error } = await supabase
        .from("configuracoes")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["configuracao"] }),
  });
}

// ===== Constantes auxiliares =====
export const ESPORTES_DEFAULT = ["Futebol", "NBA", "WNBA", "MLB", "NFL", "NHL"];
export const MERCADOS_DEFAULT = [
  "Resultado Final",
  "Handicap Asiático",
  "Handicap Europeu",
  "Over/Under",
  "BTTS",
  "Moneyline",
  "Spread",
  "Total de Pontos",
  "Total de Corridas",
  "Total de Escanteios",
  "Player Props",
];
