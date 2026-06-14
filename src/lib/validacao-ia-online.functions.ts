import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO_ONLINE = "validacao-critica-online-v6-pro-contra";

const CorrelatedPickSchema = z.object({
  mercado: z.string(),
  pick: z.string(),
  linha: z.string().nullable().optional(),
  odd_original: z.number(),
  odd_ajustada: z.number().nullable().optional(),
  probabilidade_final: z.number(),
  edge_original: z.number(),
  edge_ajustado: z.number().nullable().optional(),
});

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
  prognosticos_correlacionados: z.array(CorrelatedPickSchema).optional(),
  dados_tecnicos: z.string().nullable().optional(),
  contexto_adicional: z.string().nullable().optional(),
  calibracao_interna: z.string().nullable().optional(),
});

const MAX_BUSCAS_ONLINE = 5;
const MAX_SCRAPES_ONLINE = 3;

function getSportChecklist(esporte: string): string {
  const normalized = esporte.toLowerCase();
  if (/baseball|mlb/.test(normalized)) {
    return `Baseball / MLB:
- Arremessador: starter confirmado, handedness, splits por mão, pitch mix vs lineup, limite de arremessos, opener ou bullpen game.
- Bullpen: uso nos últimos dias, closers indisponíveis, leverage arms cansados, sequência de jogos.
- Lineup: lineup confirmado ou provável, descanso de titulares, DH, matchups L/R, lesões relevantes.
- Condições: vento, temperatura, park factor, estádio favorável a HR, umpire quando houver fonte confiável.
- Riscos: bullpen game, opener, pitch count limitado, defesa/erros, lineup B, bullpen cansado, vento forte alterando total.
- Buscas sugeridas: probable pitchers, confirmed starter, starting lineup, MLB lineups, bullpen usage, injury report, weather, park factor, umpire, game preview.`;
  }
  if (/basket|nba|wnba|fiba/.test(normalized)) {
    return `Basketball / NBA / WNBA / FIBA:
- Eficiência: ORtg, DRtg, eFG%, TOV%, rebotes ofensivos/defensivos, FTr.
- Ritmo: pace, perfil de arremesso, 3PTA rate, dependência de estrelas.
- Calendário: back-to-back, 3 jogos em 4 noites, 4 jogos em 6 noites, viagem, altitude, minutos recentes dos principais jogadores.
- Riscos: foul trouble, blowout/garbage time, rotação anunciada, estrela questionável, descanso de titular, matchup defensivo desfavorável.
- Buscas sugeridas: injury report, probable starters, starting lineup, minutes restriction, rest, back to back, questionable, out, game preview.`;
  }
  if (/american football|football|nfl|ncaa/.test(normalized)) {
    return `American Football / NFL / NCAA:
- Trenches: pass rush vs offensive line, proteção do QB, pressão permitida, sacks, lesões na OL/DL.
- Eficiência: EPA/play ou proxies, third down, red zone, explosive plays, turnovers.
- Saúde: status do QB, offensive line, defensive backs, skill players limitados.
- Clima: vento, chuva, frio, condições que afetem passe/kicking.
- Riscos: turnovers de alta variância, special teams, game script invertido, QB limitado, clima extremo.
- Buscas sugeridas: injury report, quarterback status, offensive line injuries, weather, game preview, depth chart, inactive list.`;
  }
  if (/hockey|nhl/.test(normalized)) {
    return `Hockey / NHL:
- Qualidade: xG share, chances perigosas, shot share, PDO, variância recente.
- Goleiro: starter confirmado, forma recente, descanso do goalie, back-to-back de goleiro.
- Situação: travel, back-to-back, home stand, matchup de linhas, power play / penalty kill.
- Riscos: alta variância, empty net, power play swing, goalie não confirmado, rotação de linhas.
- Buscas sugeridas: starting goalie, confirmed goalie, projected lineup, injury report, game preview, line combinations, back to back.`;
  }
  return `Futebol / Soccer:
- Produção e concessão: xG/xGA se disponível, finalizações, grandes chances, eficiência ofensiva/defensiva, tendência recente.
- Estilo de jogo: bloco alto/baixo, transições, bolas paradas, vulnerabilidade a contra-ataques, postura casa/fora.
- Situação do jogo: mando, gramado, viagem, necessidade de resultado, mata-mata, ida/volta, rotação por calendário.
- Riscos: gol cedo, cartão vermelho, rotação, postura após sair na frente, desfalques relevantes, escalação alternativa.
- Buscas sugeridas: provável escalação, desfalques, lesionados, suspensão, preview, team news, predicted lineup, injury news.`;
}

const SYSTEM_PROMPT = `Papel:
Você é um auditor sênior de risco em apostas esportivas com acesso a duas ferramentas de pesquisa online. Sua função não é confirmar picks EV+, mas tentar identificar se existe algum fator técnico, contextual, estrutural ou informacional que invalide a entrada. A decisão padrão em caso de incerteza relevante é PULAR.
- web_search(query, recency): busca notícias e páginas relevantes na web.
- web_scrape(url): lê o conteúdo completo de uma página específica em markdown.

Política de pesquisa (use as ferramentas de forma proativa, mas eficiente):
1. Você deve usar o checklist específico do esporte informado no payload. Não faça apenas busca genérica por notícias.
2. Busque fatores que podem confirmar ou invalidar a tese conforme esporte, liga, mercado, pick e linha.
3. Faça no máximo 5 buscas e no máximo 3 scrapes. Evite scrape se o resultado de busca já trouxer informação suficiente.
4. Priorize fontes confiáveis: sites oficiais de ligas/times, injury reports oficiais, páginas reconhecidas de lineups, previews de veículos esportivos confiáveis e clima de fonte meteorológica confiável.
5. Evite usar como fonte principal: fórum aleatório, postagem sem contexto, site de baixa qualidade, conteúdo sem data, notícia antiga sem relação com o jogo.
6. Janelas de recência:
   - Notícias: últimas 24 a 72 horas.
   - Lineups/starters/goalies: priorizar o dia do jogo.
   - Clima: priorizar o dia do jogo.
   - Forma recente: últimos 5 a 10 jogos quando disponível.
   - Dados estruturais, como park factor ou estilo de time: podem usar janela maior, mas informe que são estruturais.
7. NÃO invente informações: quando não encontrar uma informação crítica, diga claramente "não encontrado" ou "incerto".

Regras analíticas:
- A entrada já veio do modelo como EV+, mas isso não significa que deve ser confirmada.
- Não tente justificar a entrada a qualquer custo.
- Tente primeiro encontrar motivos para PULAR.
- CONFIRMAR só deve ocorrer quando tese técnica, contexto online/manual e riscos estiverem coerentes.
- Em caso de dúvida relevante, a decisão deve ser PULAR.
- Trate PULAR como decisão válida e esperada, não como exceção.
- Não use frases genéricas como "boa entrada", "valor positivo" ou "dados sustentam" sem apontar evidências concretas.
- Sempre escreva uma seção chamada "Tese contra a entrada".
- Use os gates objetivos de decisão. A IA só pode sugerir CONFIRMA se todos os gates obrigatórios forem aprovados.
- Não reavaliar se a entrada é EV+ (já foi filtrada).
- Não recalcular EV, não otimizar linha e não substituir os dados do modelo Python/contexto manual.
- A IA apenas sugere decisão. A decisão final continua humana.
- Avaliar coerência técnica, matchup, forma, projeções, linha, odd, risco e notícias encontradas.
- Se informação crítica estiver ausente/incerta, sinalize claramente.
- Se a informação crítica for muito determinante para a aposta, sugira PULAR.
- Se a informação crítica exigir confirmação mas não invalidar totalmente a tese, destaque de forma visível: "AGUARDAR CONFIRMAÇÃO: ..." e use no máximo 0.5u.
- Se houver boa tese técnica, mas risco estrutural relevante, a decisão sugerida deve ser conservadora: PULAR ou máximo 0.5u.
- Regra de stake: 1.0u NÃO é padrão automático.
  - PULAR: use quando houver risco relevante, informação crítica ausente, tese fraca, fonte online insuficiente, pick redundante, contexto contraditório ou risco estrutural alto.
  - CONFIRMA 0.5u: use quando a tese é boa, mas há incerteza moderada, contexto online não é perfeito, há risco normal do esporte, amostra pequena ou mercado volátil.
  - CONFIRMA 1.0u: use apenas quando a tese técnica é consistente, não há risco estrutural relevante, contexto online/manual não contradiz a entrada, a fonte crítica está confirmada e não há pick melhor concorrente no mesmo mercado.
  - CONFIRMA 1.5u: use raramente, somente quando a tese técnica é forte, múltiplos sinais confirmam, risco estrutural é baixo, contexto online é favorável ou neutro, não há informação crítica ausente e histórico interno semelhante é positivo com amostra suficiente quando esse histórico estiver disponível.
  - Quando estiver em dúvida entre 1.0u e 0.5u, use 0.5u.
  - Quando estiver em dúvida entre 0.5u e PULAR, use PULAR.
- Use a calibração interna ASP Insights apenas como apoio. Não trate histórico curto como verdade estatística.
- Se a calibração informar taxa recente de confirmação acima de 85%, reforce a auditoria de risco e procure motivos reais para PULAR.
- Não use a calibração para confirmar automaticamente. Ela é um sinal auxiliar, inferior aos dados do prognóstico, contexto, pesquisa online e gates de risco.

Gates obrigatórios:
- Gate 1 — Coerência técnica: tese precisa estar coerente com mercado, pick, linha, probabilidade, edge ajustado/original, contexto informado, esporte e liga. Conflito técnico relevante = PULAR.
- Gate 2 — Risco estrutural: risco estrutural alto = PULAR. Exemplos: MLB starter incerto/bullpen desgastado/lineup alternativo; NBA/WNBA estrela questionável/rotação incerta/back-to-back forte; NHL goalie não confirmado em pick sensível; NFL QB questionável/clima forte/desfalques OL/defesa; Futebol escalação rodada/mata-mata incerto/desfalques-chave.
- Gate 3 — Informação crítica ausente: se informação crítica necessária não estiver disponível = PULAR; no máximo CONFIRMA 0.5u apenas se a informação ausente não for determinante.
- Gate 4 — Fonte online fraca: se fontes forem antigas, genéricas ou não confirmarem o ponto crítico, sinalize e tenda para PULAR.
- Gate 5 — Risco > benefício: se houver 2 ou mais riscos relevantes, PULAR.
- Gate 6 — Duplicidade/correlação: se houver outras picks do mesmo jogo e mesmo grupo de mercado, não confirme todas automaticamente. Compare e escolha a melhor ou recomende PULAR nas redundantes.

Regras por informação crítica:
- MLB: starter não confirmado → se muito crítico, PULAR; se não, destacar AGUARDAR CONFIRMAÇÃO. Bullpen muito usado e pick depende de under → risco alto.
- NBA/WNBA: estrela questionável em spread/total → se muito crítico, PULAR; se não, destacar AGUARDAR CONFIRMAÇÃO.
- NHL: goalie não confirmado → se muito crítico, PULAR; se não, destacar AGUARDAR CONFIRMAÇÃO.
- NFL/NCAA: QB questionável ou clima extremo → se muito crítico, PULAR; se não, destacar AGUARDAR CONFIRMAÇÃO.
- Futebol: escalação muito rodada ou mata-mata com postura incerta → reduzir stake para 0.5u ou sugerir PULAR.

Separe sempre:
- Fatos encontrados: informações confirmadas com fonte.
- Informações não encontradas: o que foi buscado mas não localizado em fonte confiável.
- Inferências da IA: conclusões a partir dos dados. Nunca apresente inferência como notícia confirmada.

Formato OBRIGATÓRIO da resposta final (texto puro, sem markdown):

A) Entrada avaliada
Jogo:
Mercado:
Pick:
Linha:
Odd:
Probabilidade:
Edge:

B) Tese a favor
Liste os principais argumentos concretos que sustentam a entrada. Inclua fatos online com fonte quando existirem. Não use frases genéricas sem evidência.

C) Tese contra a entrada
Liste os principais argumentos contra a entrada. É obrigatório ter pelo menos 2 pontos críticos reais ou escrever claramente:
"Nenhum ponto crítico forte encontrado, mas estes são os principais riscos residuais."
Inclua informações críticas não encontradas, fontes fracas, dado desatualizado ou inferências frágeis quando existirem.

D) Gates de validação
Coerência técnica: aprovado/reprovado - motivo:
Informação crítica: aprovado/reprovado - motivo:
Risco estrutural: aprovado/reprovado - motivo:
Contexto online/manual: aprovado/reprovado - motivo:
Duplicidade/correlação: aprovado/reprovado - motivo:

E) Riscos principais
Liste de 3 a 5 riscos objetivos.

F) Histórico interno semelhante
Amostra:
Greens/Reds:
ROI/Yield:
Conclusão:
Se houver menos de 10 casos semelhantes, escreva exatamente:
"Histórico interno insuficiente para conclusão estatística."

G) Decisão final
Decisão: CONFIRMAR | PULAR
Stake sugerida: 0.5u | 1.0u | 1.5u, apenas se CONFIRMAR
Justificativa final objetiva:
Condição que faria mudar a decisão:

Checklist online por esporte:
Ao longo das seções B, C, D e E, inclua resumidamente os itens do checklist online mais relevantes, com informação encontrada, fonte, impacto e status. Não omita informações críticas não encontradas.`;

function parseDecisao(text: string): { decisao: string | null; stake: number | null } {
  const decisionMatch = text.match(/decis[aã]o(?:\s+final)?\s*:\s*(confirma|confirmar|pular|pass|aguardar not[ií]cia|confirma com cautela)/i);
  const slice = decisionMatch?.index != null ? text.slice(decisionMatch.index) : text;
  const decisionText = decisionMatch?.[1]?.toLowerCase() ?? "pular";
  const decisao: string | null = /\bconfirma|confirmar\b/.test(decisionText) ? "CONFIRMA" : "PULAR";
  const stakeMatch = slice.match(/stake[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);
  const stake = decisao === "CONFIRMA" && stakeMatch ? Number(stakeMatch[1].replace(",", ".")) : null;
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
    let scrapeCount = 0;

    const p = data.prognostico;
    const oddFinal = p.odd_ajustada ?? p.odd_original;
    const edgeFinal = p.edge_ajustado ?? p.edge_original;
    const checklistEsporte = getSportChecklist(p.esporte);
    const correlacionados = data.prognosticos_correlacionados ?? [];
    const correlacionadosTexto = correlacionados.length
      ? correlacionados
          .map((c, index) => {
            const odd = c.odd_ajustada ?? c.odd_original;
            const edge = c.edge_ajustado ?? c.edge_original;
            return `${index + 1}. Mercado: ${c.mercado} | Pick: ${c.pick} | Linha: ${c.linha ?? "-"} | Odd usada: ${odd.toFixed(3)} | Prob: ${c.probabilidade_final.toFixed(2)}% | Edge: ${edge.toFixed(2)}%`;
          })
          .join("\n")
      : "(nenhuma outra pick pendente do mesmo jogo informada)";

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

CONTEXTO DA ANÁLISE:
${data.contexto_adicional?.trim() || data.dados_tecnicos?.trim() || "(nenhum)"}

CALIBRAÇÃO INTERNA ASP INSIGHTS:
${data.calibracao_interna?.trim() || "(histórico interno insuficiente ou indisponível)"}

OUTRAS PICKS PENDENTES DO MESMO JOGO PARA GATE DE DUPLICIDADE/CORRELAÇÃO:
${correlacionadosTexto}

CHECKLIST ESPECÍFICO DO ESPORTE:
${checklistEsporte}

Instrução reforçada:
Você deve usar o checklist específico do esporte. Não faça apenas busca genérica por notícias. Busque os fatores que realmente podem confirmar ou invalidar a tese da aposta conforme esporte, liga, mercado, pick e linha. Quando não encontrar uma informação crítica, diga claramente que ela não foi encontrada. Não invente dados. Diferencie fatos confirmados, informações ausentes e inferências.
Antes de sugerir CONFIRMA, procure motivos concretos para PULAR. Se a tese contra a entrada for relevante ou houver informação crítica ausente/incerta, sugira PULAR. Não confirme apenas porque a entrada veio como EV+.
Não use 1.0u como stake padrão. Se houver qualquer dúvida entre 1.0u e 0.5u, use 0.5u. Se houver dúvida entre 0.5u e PULAR, use PULAR.

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
              if (buscasRealizadas.length >= MAX_BUSCAS_ONLINE) {
                return [
                  {
                    url: "",
                    title: "Limite de buscas atingido",
                    snippet: `Limite de ${MAX_BUSCAS_ONLINE} buscas online por análise atingido. Continue com as fontes já coletadas e sinalize informações ausentes.`,
                  },
                ];
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
              if (scrapeCount >= MAX_SCRAPES_ONLINE) {
                return {
                  url,
                  title: "Limite de páginas aprofundadas atingido",
                  markdown: `Limite de ${MAX_SCRAPES_ONLINE} páginas aprofundadas por análise atingido. Use os snippets e fontes já coletados; sinalize se faltar informação crítica.`,
                };
              }
              scrapeCount += 1;
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
