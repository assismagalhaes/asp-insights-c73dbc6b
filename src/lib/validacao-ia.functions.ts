import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO = "validacao-critica-v2";

const InputSchema = z.object({
  prognostico: z.object({
    data: z.string(),
    hora: z.string().nullable().optional(),
    esporte: z.string(),
    liga: z.string(),
    jogo: z.string(),
    mercado: z.string(),
    pick: z.string(),
    linha: z.string().nullable().optional(),
    odd_original: z.number(),
    odd_ajustada: z.number().nullable().optional(),
    odd_valor: z.number(),
    probabilidade_final: z.number(),
    edge_original: z.number(),
    edge_ajustado: z.number().nullable().optional(),
    stake_sugerida: z.number(),
  }),
  dados_tecnicos: z.string().nullable().optional(),
  contexto_adicional: z.string().nullable().optional(),
});

type PrognosticoPrompt = z.infer<typeof InputSchema>["prognostico"];

const SYSTEM_PROMPT = `Papel:
Voce e um analista senior de apostas esportivas. As entradas ja foram previamente filtradas como EV+. Nao recalcule EV e nao otimize linha com base em percentual. Sua funcao e validar ou recusar a entrada com base em coerencia tecnica, contexto informado manualmente, historico interno e riscos que possam quebrar a tese.

Regras:
- Nao reavaliar se e EV+.
- Nao buscar dados online.
- Nao inventar informacoes externas.
- Analisar apenas os dados fornecidos.
- Voce tem acesso a um resumo historico interno da ASP Insights, com analises anteriores e resultados GREEN/RED. Use esse historico apenas como apoio.
- Nao trate historico curto como verdade estatistica.
- Se houver menos de 10 amostras semelhantes, diga: "Historico interno insuficiente para conclusao estatistica."
- Nao confirme apenas porque o historico foi bom.
- Nao pule apenas porque poucas entradas anteriores deram RED.
- Separe claramente: dados do modelo, contexto manual, historico interno e inferencia.
- Se houver bom argumento, mas risco estrutural relevante, a decisao padrao deve ser PULAR.
- A decisao sugerida so pode ser CONFIRMA ou PULAR.
- Stake sugerida:
  - 0.5u = baixa confianca, cenario fragil ou dependente de informacao ausente.
  - 1.0u = confianca moderada, tese solida com riscos normais.
  - 1.5u = alta confianca, tese forte, multiplas confirmacoes e poucos pontos de falha.

Formato OBRIGATORIO da resposta (texto puro, sem markdown):

A) Mercado avaliado
Pick:
Linha e odd:
Tese da entrada:

B) Contexto atual da analise
Dados fornecidos:
Pontos que sustentam:
Pontos frageis:

C) Pesquisa online, se houver
Fatos confirmados:
Informacoes nao encontradas:
Fontes:

D) Historico interno semelhante
Amostra:
GREEN/RED:
ROI/Yield:
Padroes observados:
Limitacao estatistica:

E) Riscos principais
Risco 1:
Risco 2:
Risco 3:

F) Decisao sugerida
Sugestao: CONFIRMA | PULAR
Stake sugerida: 0.5u | 1.0u | 1.5u
Justificativa final:
Condicao de invalidacao:`;

function parseDecisao(text: string): { decisao: string | null; stake: number | null } {
  const lower = text.toLowerCase();
  const fIdx = Math.max(lower.lastIndexOf("decisao:"), lower.lastIndexOf("decisão:"), lower.lastIndexOf("sugestao:"), lower.lastIndexOf("sugestão:"));
  const slice = fIdx >= 0 ? text.slice(fIdx) : text;
  const s = slice.toLowerCase();
  let decisao: string | null = null;
  if (/\bpular|pass|aguardar noticia|aguardar notícia|cautela\b/.test(s)) decisao = "PULAR";
  else if (/\bconfirma|confirmar\b/.test(s)) decisao = "CONFIRMA";
  const stakeMatch = slice.match(/stake[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);
  const stake = stakeMatch ? Number(stakeMatch[1].replace(",", ".")) : null;
  return { decisao, stake };
}

const HISTORICO_INSUFICIENTE = `HISTORICO INTERNO ASP INSIGHTS:
Amostras semelhantes encontradas: 0
GREEN/RED: 0 GREEN e 0 RED
ROI aproximado das amostras: 0.00%
Forca estatistica: limitada
Limitacao estatistica: Historico interno semelhante insuficiente ou inexistente.
Regra anti-overfitting: use como sinal auxiliar, nunca como regra absoluta.
Resumo periodico mais recente:
(nenhum resumo periodico salvo ainda)`;

async function buildLearningContext(supabase: unknown, p: PrognosticoPrompt) {
  const client = supabase as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          order: (column: string, opts?: { ascending?: boolean }) => {
            limit: (count: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: Error | null }>;
          };
        };
        order: (column: string, opts?: { ascending?: boolean }) => {
          limit: (count: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: Error | null }>;
        };
      };
    };
  };

  const similar = await client
    .from("feedback_ia_resultados")
    .select("*")
    .eq("esporte", p.esporte)
    .order("created_at", { ascending: false })
    .limit(50);
  if (similar.error) return HISTORICO_INSUFICIENTE;

  const rows = (similar.data ?? []).filter((r) => {
    const sameLeague = r.liga === p.liga;
    const sameMarket = r.mercado === p.mercado;
    return sameLeague || sameMarket;
  });
  const greens = rows.filter((r) => r.resultado_real === "GREEN").length;
  const reds = rows.filter((r) => r.resultado_real === "RED").length;
  const lucro = rows.reduce((s, r) => s + Number(r.lucro_prejuizo ?? 0), 0);
  const stake = rows.reduce((s, r) => s + Math.abs(Number(r.lucro_unidades ?? 0)), 0);
  const roi = stake > 0 ? (lucro / stake) * 100 : 0;

  const resumo = await client
    .from("resumos_aprendizado_ia")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = resumo.error ? null : resumo.data?.[0];
  return `HISTORICO INTERNO ASP INSIGHTS:
Amostras semelhantes encontradas: ${rows.length}
GREEN/RED: ${greens} GREEN e ${reds} RED
ROI aproximado das amostras: ${roi.toFixed(2)}%
Forca estatistica: ${rows.length >= 30 ? "robusta" : rows.length >= 10 ? "moderada" : "limitada"}
Regra anti-overfitting: use como sinal auxiliar, nunca como regra absoluta.
Resumo periodico mais recente:
${String(latest?.resumo_geral ?? "(nenhum resumo periodico salvo ainda)")}`;
}

export const analisarValidacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      throw new Error("LOVABLE_API_KEY nao configurada no servidor.");
    }

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const p = data.prognostico;
    const oddFinal = p.odd_ajustada ?? p.odd_original;
    const edgeFinal = p.edge_ajustado ?? p.edge_original;
    const aprendizado = await buildLearningContext(context.supabase, p);

    const userPayload = `DADOS DO PROGNOSTICO (somente os abaixo; nao busque nada externo):

Data: ${p.data}${p.hora ? ` ${p.hora}` : ""}
Esporte: ${p.esporte}
Liga: ${p.liga}
Jogo: ${p.jogo}
Mercado: ${p.mercado}
Pick: ${p.pick}
Linha: ${p.linha ?? "-"}
Odd original: ${p.odd_original.toFixed(3)}
Odd ajustada: ${p.odd_ajustada != null ? p.odd_ajustada.toFixed(3) : "-"}
Odd em uso para analise: ${oddFinal.toFixed(3)}
Odd de valor (fair): ${p.odd_valor.toFixed(3)}
Probabilidade final: ${p.probabilidade_final.toFixed(2)}%
Edge original: ${p.edge_original.toFixed(2)}%
Edge ajustado: ${p.edge_ajustado != null ? p.edge_ajustado.toFixed(2) + "%" : "-"}
Edge em uso para analise: ${edgeFinal.toFixed(2)}%
Stake sugerida pelo sistema: ${p.stake_sugerida}u

CONTEXTO DA ANALISE:
${data.dados_tecnicos?.trim() || "(nenhum contexto informado)"}

CONTEXTO ADICIONAL INFORMADO PELO USUARIO:
${data.contexto_adicional?.trim() || "(nenhum contexto adicional informado)"}

${aprendizado}`;

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: userPayload,
      });

      const { decisao, stake } = parseDecisao(text);
      return {
        parecer: text,
        decisao_sugerida: decisao,
        stake_sugerida: stake,
        prompt_versao: PROMPT_VERSAO,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      if (/402|payment|credits/i.test(msg)) {
        throw new Error("Creditos da IA esgotados. Adicione creditos no workspace para continuar.");
      }
      if (/429|rate/i.test(msg)) {
        throw new Error("Limite de requisicoes da IA atingido. Tente novamente em instantes.");
      }
      throw new Error(`Falha ao gerar analise: ${msg}`);
    }
  });
