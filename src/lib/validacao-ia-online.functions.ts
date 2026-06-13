import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO_ONLINE = "validacao-critica-online-v2";

const MAX_BUSCAS = 5;
const MAX_SCRAPES = 3;

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

const SPORT_CHECKLISTS: Record<string, { label: string; items: string[]; searchTerms: string[] }> = {
  soccer: {
    label: "Futebol / Soccer",
    items: [
      "Producao e concessao: xG/xGA quando disponivel, finalizacoes, grandes chances, eficiencia ofensiva/defensiva e tendencia recente.",
      "Estilo de jogo: bloco alto/baixo, transicoes, bolas paradas, vulnerabilidade a contra-ataques e postura casa/fora.",
      "Situacao do jogo: mando, gramado, viagem, necessidade de resultado, mata-mata, ida/volta e rotacao por calendario.",
      "Riscos principais: gol cedo, cartao vermelho, rotacao, postura apos sair na frente, desfalques e escalacao alternativa.",
    ],
    searchTerms: [
      "provavel escalacao",
      "desfalques",
      "lesionados",
      "suspensao",
      "preview",
      "team news",
      "predicted lineup",
      "injury news",
    ],
  },
  basketball: {
    label: "Basketball / NBA / WNBA / FIBA",
    items: [
      "Eficiencia: ORtg, DRtg, eFG%, TOV%, rebotes ofensivos/defensivos e FTr.",
      "Ritmo: pace, perfil de arremesso, 3PTA rate e dependencia de estrelas.",
      "Calendario: back-to-back, 3 jogos em 4 noites, 4 jogos em 6 noites, viagem, altitude e minutos recentes dos principais jogadores.",
      "Riscos: foul trouble, blowout/garbage time, rotacao anunciada, estrela questionavel, descanso de titular e matchup defensivo desfavoravel.",
    ],
    searchTerms: [
      "injury report",
      "probable starters",
      "starting lineup",
      "minutes restriction",
      "rest",
      "back to back",
      "questionable",
      "out",
      "game preview",
    ],
  },
  americanFootball: {
    label: "American Football / NFL / NCAA",
    items: [
      "Trenches: pass rush vs offensive line, protecao do QB, pressao permitida, sacks e lesoes na OL/DL.",
      "Eficiencia: EPA/play ou proxies, third down, red zone, explosive plays e turnovers.",
      "Saude: status do QB, offensive line, defensive backs e skill players limitados.",
      "Clima: vento, chuva, frio e condicoes que afetem passe ou kicking.",
      "Riscos: turnovers de alta variancia, special teams, game script invertido, QB limitado e clima extremo.",
    ],
    searchTerms: [
      "injury report",
      "quarterback status",
      "offensive line injuries",
      "weather",
      "game preview",
      "depth chart",
      "inactive list",
    ],
  },
  hockey: {
    label: "Hockey / NHL",
    items: [
      "Qualidade: xG share, chances perigosas, shot share, PDO e variancia recente.",
      "Goleiro: starter confirmado, forma recente, descanso do goalie e back-to-back de goleiro.",
      "Situacao: travel, back-to-back, home stand, matchup de linhas, power play e penalty kill.",
      "Riscos: alta variancia, empty net, power play swing, goalie nao confirmado e rotacao de linhas.",
    ],
    searchTerms: [
      "starting goalie",
      "confirmed goalie",
      "projected lineup",
      "injury report",
      "game preview",
      "line combinations",
      "back to back",
    ],
  },
  baseball: {
    label: "Baseball / MLB",
    items: [
      "Arremessador: starter confirmado, handedness, splits por mao, pitch mix vs lineup, limite de arremessos, opener ou bullpen game.",
      "Bullpen: uso nos ultimos dias, closers indisponiveis, leverage arms cansados e sequencia de jogos.",
      "Lineup: lineup confirmado/provavel, descanso de titulares, DH, matchups L/R e lesoes relevantes.",
      "Condicoes: vento, temperatura, park factor, estadio favoravel a HR e umpire quando houver informacao confiavel.",
      "Riscos: bullpen game, opener, starter com pitch count limitado, defesa/erros, lineup B, bullpen cansado e vento forte alterando total.",
    ],
    searchTerms: [
      "probable pitchers",
      "confirmed starter",
      "starting lineup",
      "MLB lineups",
      "bullpen usage",
      "injury report",
      "weather",
      "park factor",
      "umpire",
      "game preview",
    ],
  },
};

const GENERAL_CHECKLIST = {
  label: "Checklist geral por mercado",
  items: [
    "Noticias recentes, disponibilidade de jogadores, lineup/escala provavel, calendario, motivacao e contexto competitivo.",
    "Fatores externos que podem quebrar a tese conforme mercado, pick e linha.",
  ],
  searchTerms: ["injury report", "game preview", "lineup", "team news", "weather"],
};

function getSportChecklist(esporte: string, liga: string) {
  const text = `${esporte} ${liga}`.toLowerCase();
  if (/soccer|futebol|premier|laliga|serie a|brasileir|libertadores|champions/.test(text)) return SPORT_CHECKLISTS.soccer;
  if (/basket|nba|wnba|fiba|ncaa basketball|ncaab|euroleague/.test(text)) return SPORT_CHECKLISTS.basketball;
  if (/football|nfl|ncaa football|ncaaf|americano/.test(text)) return SPORT_CHECKLISTS.americanFootball;
  if (/hockey|nhl/.test(text)) return SPORT_CHECKLISTS.hockey;
  if (/baseball|mlb/.test(text)) return SPORT_CHECKLISTS.baseball;
  return GENERAL_CHECKLIST;
}

const SYSTEM_PROMPT = `Papel:
Voce e um analista senior de apostas esportivas com acesso a duas ferramentas de pesquisa online:
- web_search(query, recency): busca noticias e paginas relevantes na web.
- web_scrape(url): le o conteudo completo de uma pagina especifica em markdown.

Objetivo:
Validar criticamente o prognostico com contexto real. A pesquisa online deve buscar fatores que confirmem ou quebrem a tese da aposta conforme esporte, liga, mercado, pick e linha. Nao faca apenas busca generica por noticias.

Limites absolutos:
- Nao recalcular EV.
- Nao otimizar linha.
- Nao substituir os dados do modelo Python.
- Nao publicar, confirmar ou aprovar automaticamente.
- A IA apenas sugere decisao; a decisao final continua humana.
- A decisao sugerida so pode ser CONFIRMA ou PULAR. Se a situacao pedir "aguardar noticia", "pass", reduzir muito ou cautela, traduza para PULAR e explique o motivo.
- Voce tem acesso a um resumo historico interno da ASP Insights, com analises anteriores e resultados GREEN/RED. Use esse historico apenas como apoio.
- Nao trate historico curto como verdade estatistica. Se houver menos de 10 amostras semelhantes, diga que o historico interno e insuficiente.
- Separe claramente dados do modelo, contexto online/manual, historico interno e inferencia.

Politica de pesquisa:
1. Use o checklist especifico do esporte informado pelo usuario.
2. Faca buscas direcionadas a fatores criticos do esporte/mercado/pick/linha, nao apenas ao confronto.
3. Limite operacional: no maximo 5 buscas e 3 paginas aprofundadas por scrape.
4. Evite scrape se o resultado da busca ja trouxer informacao suficiente.
5. Recencia padrao:
   - Noticias recentes: ultimas 24 a 72 horas.
   - Lineups/starters/goalies/inactives: priorizar o dia do jogo.
   - Clima: priorizar o dia do jogo.
   - Forma recente: ultimos 5 a 10 jogos quando disponivel.
   - Informacao estrutural, como park factor ou estilo, pode ter janela maior, mas sinalize que e estrutural.
6. Priorize fontes confiaveis: sites oficiais de ligas/times, injury reports oficiais, paginas reconhecidas de lineups, previews de veiculos esportivos confiaveis e meteorologia confiavel.
7. Evite fonte principal sem data, forum aleatorio, postagem sem contexto, site de baixa qualidade ou noticia antiga sem relacao com o jogo.
8. Se a fonte nao tiver data recente, sinalize possivel dado desatualizado.
9. Nao invente dados. Quando nao encontrar informacao critica, diga claramente "nao encontrado".

Regras de decisao conservadora:
- Se informacao critica estiver ausente ou incerta, sinalize claramente.
- MLB: starter nao confirmado, bullpen muito usado em pick dependente de under, opener/bullpen game ou lineup B relevante => PULAR.
- NBA/WNBA/FIBA: estrela questionavel, descanso de titular, restricao de minutos ou risco de blowout em mercado sensivel => PULAR.
- NHL: goalie nao confirmado ou matchup de goalie incerto => PULAR.
- NFL/NCAA: QB questionavel, lesoes relevantes de OL/DL/DB ou clima extremo => PULAR.
- Futebol: escalacao muito rodada, mata-mata com postura incerta, desfalques-chave ou necessidade de resultado que muda o plano de jogo => PULAR.
- Se houver boa tese tecnica, mas risco estrutural relevante, a decisao sugerida deve ser PULAR.

Separe fato, fonte e inferencia:
- Fatos encontrados: apenas informacoes confirmadas por fonte.
- Informacoes nao encontradas: o que foi buscado e nao localizado em fonte confiavel.
- Inferencias da IA: conclusoes suas a partir dos dados. Nunca apresente inferencia como noticia confirmada.

Formato OBRIGATORIO da resposta final (texto puro, sem markdown):

IA Online

A) Mercado avaliado
Pick:
Linha e odd:
Tese da aposta:

B) Checklist online
Esporte/checklist usado:
Item 1:
Informacao encontrada:
Fonte:
Impacto na aposta: Baixo | Medio | Alto
Status: Confirmado | Nao encontrado | Incerto
Item 2:
Informacao encontrada:
Fonte:
Impacto na aposta: Baixo | Medio | Alto
Status: Confirmado | Nao encontrado | Incerto
Item 3:
Informacao encontrada:
Fonte:
Impacto na aposta: Baixo | Medio | Alto
Status: Confirmado | Nao encontrado | Incerto

C) Fatos encontrados
Fato 1:
Fonte:
Fato 2:
Fonte:

D) Informacoes criticas nao encontradas
Nao encontrado 1:
Busca realizada:
Impacto:

E) Inferencias da IA
Inferencia 1:
Base usada:
Grau de confianca:

F) Historico interno semelhante
Amostra:
GREEN/RED:
ROI/Yield:
Padroes observados:
Limitacao estatistica:

G) Riscos principais
Risco 1:
Impacto:
Risco 2:
Impacto:
Possivel dado desatualizado ou fonte insuficiente:

H) Decisao final
Decisao: CONFIRMA | PULAR
Stake sugerida: 0.5u | 1.0u | 1.5u
Justificativa final em 3 a 6 linhas:
Condicao de invalidacao:`;

function parseDecisao(text: string): { decisao: string | null; stake: number | null } {
  const lower = text.toLowerCase();
  const fIdx = Math.max(lower.lastIndexOf("decisao:"), lower.lastIndexOf("decisão:"), lower.lastIndexOf("sugestao:"), lower.lastIndexOf("sugestão:"));
  const slice = fIdx >= 0 ? text.slice(fIdx) : text;
  const s = slice.toLowerCase();
  const decisionMatch = slice.match(/decisao:\s*(confirma|pular|pass|aguardar noticia|cautela)/i);
  let decisao: string | null = null;
  if (decisionMatch?.[1]?.toLowerCase() === "confirma") decisao = "CONFIRMA";
  else if (decisionMatch) decisao = "PULAR";
  else if (/\bpular|pass|aguardar noticia|cautela\b/.test(s)) decisao = "PULAR";
  else if (/\bconfirma\b/.test(s)) decisao = "CONFIRMA";
  const stakeMatch = slice.match(/stake[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);
  const stake = stakeMatch ? Number(stakeMatch[1].replace(",", ".")) : null;
  return { decisao, stake };
}

function extrairAlertasOnline(text: string): string[] {
  const alertas = new Set<string>();
  if (/nao encontrado|não encontrado/i.test(text)) alertas.add("Informacao critica nao confirmada");
  if (/incerto|incerta|questionavel|questionável/i.test(text)) alertas.add("Informacao critica incerta");
  if (/risco[^.\n]*(alto|relevante|estrutural)|impacto:\s*alto/i.test(text)) alertas.add("Risco alto ou estrutural");
  if (/desatualizad|sem data|fonte insuficiente/i.test(text)) alertas.add("Fonte insuficiente ou possivelmente desatualizada");
  return Array.from(alertas);
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

  const rows = (similar.data ?? []).filter((r) => r.liga === p.liga || r.mercado === p.mercado);
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

export const analisarValidacaoOnline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY nao configurada.");
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error(
        "Firecrawl nao esta conectado. Conecte-o em Conectores para usar a pesquisa online.",
      );
    }

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const { firecrawlScrape, firecrawlSearch } = await import("@/lib/firecrawl.server");
    const gateway = createLovableAiGatewayProvider(key);

    const buscasRealizadas: string[] = [];
    const fontesConsultadas: { titulo: string; url: string }[] = [];
    let scrapeCount = 0;

    const p = data.prognostico;
    const oddFinal = p.odd_ajustada ?? p.odd_original;
    const edgeFinal = p.edge_ajustado ?? p.edge_original;
    const checklist = getSportChecklist(p.esporte, p.liga);
    const aprendizado = await buildLearningContext(context.supabase, p);

    const userPayload = `DADOS DO PROGNOSTICO:

Data: ${p.data}${p.hora ? ` ${p.hora}` : ""}
Esporte: ${p.esporte}
Liga: ${p.liga}
Jogo: ${p.jogo}
Mercado: ${p.mercado}
Pick: ${p.pick}
Linha: ${p.linha ?? "-"}
Odd original: ${p.odd_original.toFixed(3)}
Odd ajustada: ${p.odd_ajustada != null ? p.odd_ajustada.toFixed(3) : "-"}
Odd em uso: ${oddFinal.toFixed(3)}
Odd de valor (fair): ${p.odd_valor.toFixed(3)}
Probabilidade final: ${p.probabilidade_final.toFixed(2)}%
Edge: ${edgeFinal.toFixed(2)}%
Stake sugerida pelo sistema: ${p.stake_sugerida}u

DADOS TECNICOS DO MODELO PYTHON:
${data.dados_tecnicos?.trim() || "(nenhum)"}

CONTEXTO ADICIONAL INFORMADO:
${data.contexto_adicional?.trim() || "(nenhum)"}

${aprendizado}

CHECKLIST ONLINE OBRIGATORIO PARA ESTE PROGNOSTICO:
Esporte/checklist: ${checklist.label}
Itens a verificar:
${checklist.items.map((item, idx) => `${idx + 1}. ${item}`).join("\n")}
Termos de busca sugeridos, adapte ao jogo/pick/linha:
${checklist.searchTerms.join(", ")}

Instrucao final:
Voce deve usar o checklist especifico do esporte. Nao faca apenas busca generica por noticias. Busque os fatores que realmente podem confirmar ou invalidar a tese da aposta conforme o esporte, mercado, pick e linha. Quando nao encontrar uma informacao critica, diga claramente que ela nao foi encontrada. Nao invente dados. Diferencie fatos confirmados, informacoes ausentes e inferencias.`;

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: userPayload,
        stopWhen: stepCountIs(35),
        tools: {
          web_search: tool({
            description:
              "Busca paginas relevantes na web. Use consultas especificas para o esporte, jogo, mercado, pick e linha. Use recency='day' para lineups/lesoes/starters/goalies/inactives/clima do dia e 'week' para forma recente.",
            inputSchema: z.object({
              query: z.string().describe("Consulta de busca especifica e acionavel"),
              recency: z.enum(["day", "week", "month"]).optional(),
            }),
            execute: async ({ query, recency }) => {
              if (buscasRealizadas.length >= MAX_BUSCAS) {
                return [{ title: "Limite de buscas atingido", url: "", snippet: "Use as buscas ja realizadas." }];
              }

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
                snippet: r.description?.slice(0, 500) ?? "",
              }));
            },
          }),
          web_scrape: tool({
            description:
              "Le o conteudo completo de uma URL especifica em markdown. Use apenas para fonte promissora e quando o snippet nao for suficiente.",
            inputSchema: z.object({
              url: z.string().url(),
            }),
            execute: async ({ url }) => {
              if (scrapeCount >= MAX_SCRAPES) {
                return { url, title: "Limite de scrapes atingido", markdown: "Use as fontes ja consultadas." };
              }

              scrapeCount += 1;
              const { markdown, title } = await firecrawlScrape(url);
              if (!fontesConsultadas.some((f) => f.url === url)) {
                fontesConsultadas.push({ titulo: title || url, url });
              }
              return { url, title, markdown: markdown.slice(0, 12000) };
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
        alertas_online: extrairAlertasOnline(text),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      if (/402|payment|credits/i.test(msg)) {
        throw new Error("Creditos da IA esgotados. Adicione creditos no workspace para continuar.");
      }
      if (/429|rate/i.test(msg)) {
        throw new Error("Limite de requisicoes atingido. Tente novamente em instantes.");
      }
      if (/firecrawl/i.test(msg)) {
        throw new Error(`Pesquisa online falhou: ${msg}`);
      }
      throw new Error(`Falha na analise online: ${msg}`);
    }
  });
