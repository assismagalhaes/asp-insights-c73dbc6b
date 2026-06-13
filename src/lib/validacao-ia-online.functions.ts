import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO_ONLINE = "validacao-critica-online-v1";

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

const SYSTEM_PROMPT = `Papel:
Você é um analista sênior de apostas esportivas com acesso a duas ferramentas de pesquisa online:
- web_search(query, recency): busca notícias e páginas relevantes na web.
- web_scrape(url): lê o conteúdo completo de uma página específica em markdown.

Política de pesquisa (use as ferramentas de forma proativa, mas eficiente):
1. SEMPRE faça pelo menos 1 busca por notícias recentes do confronto (ex: "<time A> vs <time B> news", "<time A> injuries", "<jogo> probable lineup").
2. Conforme o mercado, busque o que for relevante:
   - Player props, handicap, ML → status do elenco, lineups confirmadas, lesões e suspensões.
   - Esportes outdoor (MLB, NFL, futebol) → clima/condições do local quando relevante.
   - Total de pontos/runs/gols → ritmo recente, lineups, clima, parque (MLB).
3. Use no máximo 4 buscas e 2 scrapes para não desperdiçar créditos.
4. Priorize fontes confiáveis (ESPN, MLB.com, sites oficiais, Rotowire, BBC, Globo Esporte, etc.).
5. Use recency "day" para lineups/lesões do dia do jogo, "week" para forma recente.
6. NÃO invente informações: se a busca não trouxer nada relevante, declare "informação não encontrada".

Regras analíticas:
- Não reavaliar se a entrada é EV+ (já foi filtrada).
- Avaliar coerência técnica, matchup, forma, projeções, linha, odd, risco e notícias encontradas.
- Se houver risco estrutural relevante (lesão chave, lineup desfavorável, clima ruim para a tese), a decisão padrão deve ser PULAR.
- Stake sugerida:
  - 0.5u = baixa confiança, cenário frágil.
  - 1.0u = confiança moderada, tese sólida.
  - 1.5u = alta confiança, múltiplas confirmações.

Formato OBRIGATÓRIO da resposta final (texto puro, sem markdown):

A) Mercado avaliado
Pick:
Linha e odd:
Tese da aposta:

B) Dados técnicos
Matchup e vantagem estrutural:
Tendências consistentes vs ruído:
Aderência ao mercado:
Sinais de alerta estatísticos:

C) Contexto adicional informado
O que foi considerado:
Informações ausentes ou incertas:
Impacto prático:

D) Notícias e contexto online encontrados
Lineups/lesões:
Notícias recentes relevantes:
Clima/condições (se aplicável):
Outras informações:

E) Fatores qualitativos
Leitura provável do jogo:
Motivação/contexto competitivo:
Pontos que favorecem a tese:

F) Riscos potenciais
Risco 1:
Risco 2:
Risco 3:
O que faria mudar a decisão:

G) Decisão final
Decisão: CONFIRMA | PULAR
Stake sugerida: 0.5u | 1.0u | 1.5u
Justificativa final em 3 a 6 linhas:
Condição de invalidação:`;

function parseDecisao(text: string): { decisao: string | null; stake: number | null } {
  const lower = text.toLowerCase();
  const fIdx = lower.lastIndexOf("decisão:");
  const slice = fIdx >= 0 ? text.slice(fIdx) : text;
  const s = slice.toLowerCase();
  let decisao: string | null = null;
  if (/\bconfirma\b/.test(s) && !/\bconfirma com cautela\b/.test(s)) decisao = "CONFIRMA";
  else if (/\bpular|pass|aguardar notícia|aguardar noticia|confirma com cautela\b/.test(s)) decisao = "PULAR";
  const stakeMatch = slice.match(/stake[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);
  const stake = stakeMatch ? Number(stakeMatch[1].replace(",", ".")) : null;
  return { decisao, stake };
}

export const analisarValidacaoOnline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY não configurada.");
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error(
        "Firecrawl não está conectado. Conecte-o em Conectores para usar a pesquisa online.",
      );
    }

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const { firecrawlSearch, firecrawlScrape } = await import("@/lib/firecrawl.server");
    const gateway = createLovableAiGatewayProvider(key);

    const buscasRealizadas: string[] = [];
    const fontesConsultadas: { titulo: string; url: string }[] = [];

    const p = data.prognostico;
    const oddFinal = p.odd_ajustada ?? p.odd_original;
    const edgeFinal = p.edge_ajustado ?? p.edge_original;

    const userPayload = `DADOS DO PROGNÓSTICO:

Data: ${p.data}${p.hora ? ` ${p.hora}` : ""}
Esporte: ${p.esporte}
Liga: ${p.liga}
Jogo: ${p.jogo}
Mercado: ${p.mercado}
Pick: ${p.pick}
Linha: ${p.linha ?? "-"}
Odd original: ${p.odd_original.toFixed(3)}
Odd ajustada: ${p.odd_ajustada != null ? p.odd_ajustada.toFixed(3) : "—"}
Odd em uso: ${oddFinal.toFixed(3)}
Odd de valor (fair): ${p.odd_valor.toFixed(3)}
Probabilidade final: ${p.probabilidade_final.toFixed(2)}%
Edge: ${edgeFinal.toFixed(2)}%
Stake sugerida: ${p.stake_sugerida}u

DADOS TÉCNICOS DO MODELO:
${data.dados_tecnicos?.trim() || "(nenhum)"}

CONTEXTO ADICIONAL INFORMADO:
${data.contexto_adicional?.trim() || "(nenhum)"}

Faça pesquisas online conforme a política descrita e produza o parecer no formato exigido.`;

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: userPayload,
        stopWhen: stepCountIs(50),
        tools: {
          web_search: tool({
            description:
              "Busca páginas relevantes na web. Use recency='day' para lineups/lesões do dia, 'week' para forma recente, 'month' para contexto geral.",
            inputSchema: z.object({
              query: z.string().describe("Consulta de busca (em inglês para esportes US, no idioma local para outros)"),
              recency: z.enum(["day", "week", "month"]).optional(),
            }),
            execute: async ({ query, recency }) => {
              buscasRealizadas.push(query);
              const results = await firecrawlSearch(query, { limit: 5, recency });
              for (const r of results) {
                if (!fontesConsultadas.some((f) => f.url === r.url)) {
                  fontesConsultadas.push({ titulo: r.title || r.url, url: r.url });
                }
              }
              return results.map((r) => ({
                url: r.url,
                title: r.title,
                snippet: r.description?.slice(0, 300) ?? "",
              }));
            },
          }),
          web_scrape: tool({
            description: "Lê o conteúdo completo de uma URL específica em markdown.",
            inputSchema: z.object({
              url: z.string().url(),
            }),
            execute: async ({ url }) => {
              const { markdown, title } = await firecrawlScrape(url);
              if (!fontesConsultadas.some((f) => f.url === url)) {
                fontesConsultadas.push({ titulo: title || url, url });
              }
              return { url, title, markdown };
            },
          }),
        },
      });

      const { decisao, stake } = parseDecisao(text);
      return {
        parecer: text,
        decisao_sugerida: decisao,
        stake_sugerida: stake,
        prompt_versao: PROMPT_VERSAO_ONLINE,
        fontes_consultadas: fontesConsultadas,
        buscas_realizadas: buscasRealizadas,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      if (/402|payment|credits/i.test(msg)) {
        throw new Error("Créditos da IA esgotados. Adicione créditos no workspace para continuar.");
      }
      if (/429|rate/i.test(msg)) {
        throw new Error("Limite de requisições atingido. Tente novamente em instantes.");
      }
      if (/firecrawl/i.test(msg)) {
        throw new Error(`Pesquisa online falhou: ${msg}`);
      }
      throw new Error(`Falha na análise online: ${msg}`);
    }
  });
