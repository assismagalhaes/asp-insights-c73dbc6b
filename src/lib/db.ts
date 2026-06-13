import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Status = "PENDENTE" | "CONFIRMA" | "PULAR";
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
        .select("*, resultados(placar_final, created_at)")
        .order("data", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => {
        const rs = (r.resultados as Array<{ placar_final: string | null; created_at: string }> | null) ?? [];
        const last = rs.length
          ? [...rs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
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
      const { placar_final: _pf, ...rest } = patch;
      const { data, error } = await supabase.from("prognosticos").update(rest).eq("id", id).select().single();
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
  extras?: { justificativa?: string | null; riscos?: string | null },
): string {
  const linha = (p.linha ?? "").trim();
  const pickLower = (p.pick ?? "").toLowerCase();
  const linhaForaDoPick = linha && linha !== "-" && !pickLower.includes(linha.toLowerCase());
  return `🔥 ASP INSIGHTS - PICK CONFIRMADA

🏆 Jogo: ${p.jogo}
🏟️ Liga: ${p.liga || "—"}
📊 Esporte: ${p.esporte}

🎯 Mercado: ${p.mercado}
✅ Pick: ${p.pick}${linhaForaDoPick ? `\n📐 Linha: ${linha}` : ""}
📈 Odd: ${p.odd_ofertada.toFixed(2)}
📉 Odd de Valor: ${p.odd_valor.toFixed(2)}
📊 Probabilidade: ${p.probabilidade_final.toFixed(1)}%
⚖️ Edge: ${p.edge.toFixed(2)}%
💰 Stake: ${p.stake}u

🧠 Base técnica:
${extras?.justificativa?.trim() || "—"}

⚠️ Riscos:
${extras?.riscos?.trim() || "—"}

📌 Status: ${p.status_validacao}`;
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
