import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAdmin } from "@/lib/auth-middleware-public";
import {
  AiStructuredRepairFailure,
  buildStructuredRepairPrompt,
  createAiGenerationFailure,
  createLegacyRollbackResult,
  parseStructuredAiOutput,
} from "@/lib/ai-validation/generation-result";
import { adaptLegacyAiResponse } from "@/lib/ai-validation/legacy-adapter";
import { sumAiTokenUsage } from "@/lib/ai-validation/observability";
import { resolveAiValidationRollout, rolloutTelemetry } from "@/lib/ai-validation/rollout";
import { AiLocalGenerationOutputSchema } from "@/lib/ai-validation/schema";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO_ONLINE = "validacao-critica-online-v10-structured-output";
export const ONLINE_GATEWAY_MODEL_ID = "google/gemini-3.6-flash";

export const ONLINE_GATEWAY_JSON_TEMPLATE = `{
  "schema_version": "1.1.0",
  "decision": "PULAR",
  "stake": 0,
  "selected_prediction_id": null,
  "selected_pick": null,
  "gates": {
    "technical_consistency": { "status": "APPROVED", "reason": "motivo concreto" },
    "critical_information": { "status": "APPROVED", "reason": "motivo concreto" },
    "structural_risk": { "status": "APPROVED", "reason": "motivo concreto" },
    "context": { "status": "APPROVED", "reason": "motivo concreto" },
    "correlation": { "status": "APPROVED", "reason": "motivo concreto" }
  },
  "narrative": {
    "evaluated_entry": "jogo, mercado, pick, odd, probabilidade e edge",
    "thesis_for": "argumentos concretos favoráveis, separando fatos e inferências",
    "thesis_against": "argumentos concretos contrários e informações não encontradas",
    "internal_history": "amostra, greens/reds, ROI/Yield e conclusão",
    "final_justification": "justificativa objetiva",
    "decision_change_condition": null
  },
  "rationale": "síntese auditável",
  "risks": ["risco objetivo"],
  "invalidation_condition": "condição operacional de invalidação",
  "limitations": ["limitação real da pesquisa online"],
  "sources": [],
  "searches": []
}`;

export type OnlineSourceTrace = {
  titulo: string;
  url: string;
  consultada_em: string;
  tipo: "SEARCH_RESULT" | "SCRAPED";
  consultada: boolean;
};

export function normalizeOnlineHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function recordOnlineSource(
  traces: OnlineSourceTrace[],
  {
    titulo,
    url,
    tipo,
    consultadaEm = new Date().toISOString(),
  }: {
    titulo?: string | null;
    url: string;
    tipo: OnlineSourceTrace["tipo"];
    consultadaEm?: string;
  },
): string | null {
  const normalizedUrl = normalizeOnlineHttpUrl(url);
  if (!normalizedUrl) return null;

  const existing = traces.find((source) => source.url === normalizedUrl);
  const consulted = tipo === "SCRAPED";
  if (existing) {
    if (consulted) {
      existing.tipo = "SCRAPED";
      existing.consultada = true;
      existing.consultada_em = consultadaEm;
    }
    if (titulo?.trim()) existing.titulo = titulo.trim().slice(0, 500);
    return normalizedUrl;
  }

  traces.push({
    titulo: titulo?.trim().slice(0, 500) || normalizedUrl,
    url: normalizedUrl,
    consultada_em: consultadaEm,
    tipo,
    consultada: consulted,
  });
  return normalizedUrl;
}

function extractGatewayJson(text: string): unknown {
  if (!text.trim()) throw new Error("EMPTY_INITIAL_OUTPUT");
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("JSON object não encontrado na resposta do Lovable AI Gateway.");
  }
  return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as unknown;
}

export function parseOnlineGatewayJson(
  text: string,
  {
    sourceTraces,
    searches,
  }: {
    sourceTraces: OnlineSourceTrace[];
    searches: string[];
  },
) {
  const raw = extractGatewayJson(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Objeto JSON online inválido.");
  }

  const canonicalSearches = Array.from(
    new Set(searches.map((query) => query.trim().slice(0, 1_000)).filter(Boolean)),
  ).slice(0, 50);
  const canonicalSources = sourceTraces
    .filter((source) => source.consultada)
    .slice(0, 50)
    .map((source) => ({ title: source.titulo, url: source.url }));

  return AiLocalGenerationOutputSchema.parse({
    ...(raw as Record<string, unknown>),
    sources: canonicalSources,
    searches: canonicalSearches,
  });
}

const CorrelatedPickSchema = z.object({
  mercado: z.string(),
  pick: z.string(),
  odd_original: z.number(),
  odd_ajustada: z.number().nullable().optional(),
  odd_mediana: z.number().nullable().optional(),
  odd_mercado_base: z.number().nullable().optional(),
  odd_melhor: z.number().nullable().optional(),
  bookmaker_melhor: z.string().nullable().optional(),
  probabilidade_final: z.number(),
  edge_original: z.number(),
  edge_ajustado: z.number().nullable().optional(),
});

const GroupOptionSchema = z.object({
  prognostico_id: z.string(),
  mercado: z.string().optional(),
  pick: z.string(),
  odd_original: z.number(),
  odd_ajustada: z.number().nullable().optional(),
  odd_mediana: z.number().nullable().optional(),
  odd_mercado_base: z.number().nullable().optional(),
  odd_melhor: z.number().nullable().optional(),
  bookmaker_melhor: z.string().nullable().optional(),
  odd_valor: z.number(),
  probabilidade: z.number(),
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
    odd_original: z.number(),
    odd_ajustada: z.number().nullable().optional(),
    odd_mediana: z.number().nullable().optional(),
    odd_mercado_base: z.number().nullable().optional(),
    odd_melhor: z.number().nullable().optional(),
    bookmaker_melhor: z.string().nullable().optional(),
    odd_valor: z.number(),
    probabilidade_final: z.number(),
    edge_original: z.number(),
    edge_ajustado: z.number().nullable().optional(),
    stake_sugerida: z.number(),
  }),
  opcoes_mesmo_mercado: z.array(GroupOptionSchema).optional(),
  prognosticos_correlacionados: z.array(CorrelatedPickSchema).optional(),
  dados_tecnicos: z.string().nullable().optional(),
  contexto_local: z.string().nullable().optional(),
  contexto_online: z.string().nullable().optional(),
  contexto_adicional: z.string().nullable().optional(),
  calibracao_interna: z.string().nullable().optional(),
});

const MAX_BUSCAS_ONLINE = 5;
const MAX_SCRAPES_ONLINE = 3;

export function getSportChecklist(esporte: string): string {
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

function formatNullableOdd(value: number | null | undefined): string {
  return value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(3) : "-";
}

const SYSTEM_PROMPT = `Papel:
Você é um auditor sênior de risco em apostas esportivas com acesso a duas ferramentas de pesquisa online. Sua função não é confirmar picks EV+, mas tentar identificar se existe algum fator técnico, contextual, estrutural ou informacional que invalide a entrada. A decisão padrão em caso de incerteza relevante é PULAR.
- web_search(query, recency): busca notícias e páginas relevantes na web.
- web_scrape(url): lê o conteúdo completo de uma página específica em markdown.

Política de pesquisa (use as ferramentas de forma proativa, mas eficiente):
1. Você deve usar o checklist específico do esporte informado no payload. Não faça apenas busca genérica por notícias.
2. Busque fatores que podem confirmar ou invalidar a tese conforme esporte, liga, mercado e pick.
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
- Não recalcular EV, não substituir a pick e não substituir os dados do modelo Python/contexto manual.
- A IA apenas sugere decisão. A decisão final continua humana.
- Avaliar coerência técnica, matchup, forma, projeções, pick, odd, risco e notícias encontradas.
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
- Considere somente a coorte realmente semelhante indicada na memória. Não generalize desempenho global para uma liga, lado ou faixa de pick diferente.
- Se a confiabilidade da memória for BAIXA ou SEM_AMOSTRA, não altere decisão nem stake por causa dela.
- A memória nunca substitui os gates técnicos, as fontes atuais e não autoriza confirmar uma entrada reprovada pelos dados atuais.
- Se a calibração informar taxa recente de confirmação acima de 85%, reforce a auditoria de risco e procure motivos reais para PULAR.
- Não use a calibração para confirmar automaticamente. Ela é um sinal auxiliar, inferior aos dados do prognóstico, contexto, pesquisa online e gates de risco.

Regras para grupo de opções concorrentes:
- Quando houver uma lista de opções concorrentes do mesmo jogo e mercado/família de mercado, você está validando o grupo inteiro, não apenas a primeira opção.
- A opção selecionada na interface serve apenas para ajuste de odd pelo usuário. Não trate essa seleção como preferência ou decisão prévia.
- Sua tarefa não é recalcular EV. Sua tarefa é comparar as opções disponíveis e decidir se existe uma opção tecnicamente superior para confirmação.
- Escolha no máximo uma opção do grupo. Nunca confirme mais de uma opção.
- Não escolha automaticamente a maior probabilidade, o maior edge ou a maior odd.
- Compare pick, odd, probabilidade, edge, contexto técnico, pesquisa online, risco e coerência do mercado.
- Moneyline, Handicap e Dupla Chance podem representar a mesma tese de resultado/proteção. Compare proteção da pick, risco/retorno e exposição duplicada, e escolha somente uma entrada principal quando forem correlatas.
- Se nenhuma opção tiver sustentação técnica suficiente, retorne PULAR.
- Se houver risco estrutural relevante, prefira PULAR.

Gates obrigatórios:
- Gate 1 — Coerência técnica: tese precisa estar coerente com mercado, pick, probabilidade, edge ajustado/original, contexto informado, esporte e liga. Conflito técnico relevante = PULAR.
- Gate 2 — Risco estrutural: risco estrutural alto = PULAR. Exemplos: MLB starter incerto/bullpen desgastado/lineup alternativo; NBA/WNBA estrela questionável/rotação incerta/back-to-back forte; NHL goalie não confirmado em pick sensível; NFL QB questionável/clima forte/desfalques OL/defesa; Futebol escalação rodada/mata-mata incerto/desfalques-chave.
- Gate 3 — Informação crítica ausente: se informação crítica necessária não estiver disponível = PULAR; no máximo CONFIRMA 0.5u apenas se a informação ausente não for determinante.
- Gate 4 — Fonte online fraca: se fontes forem antigas, genéricas ou não confirmarem o ponto crítico, sinalize e tenda para PULAR.
- Gate 5 — Risco > benefício: se houver 2 ou mais riscos relevantes, PULAR.
- Gate 6 — Duplicidade/correlação: se houver outras picks do mesmo jogo e mesmo grupo de mercado, trate como opções concorrentes. Você deve escolher no máximo uma opção para CONFIRMAR ou recomendar PULAR o grupo inteiro. Nunca sugira confirmar mais de uma opção do grupo.

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
decisao_grupo: CONFIRMA | PULAR
prognostico_id_escolhido: id exato da opção escolhida ou null
pick_escolhida: pick da opção escolhida ou null
stake_confirmada: 0.5 | 1.0 | 1.5 | 0
Stake sugerida: 0.5u | 1.0u | 1.5u, apenas se CONFIRMAR
justificativa_pick:
riscos:
condicao_invalidacao:
Justificativa final objetiva:
Condição que faria mudar a decisão:

Checklist online por esporte:
Ao longo das seções B, C, D e E, inclua resumidamente os itens do checklist online mais relevantes, com informação encontrada, fonte, impacto e status. Não omita informações críticas não encontradas.`;

export const analisarValidacaoOnline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAdmin])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const runId = crypto.randomUUID();
    const buscasRealizadas: string[] = [];
    const fontesRastreaveis: OnlineSourceTrace[] = [];
    let repairAttempted = false;
    let promptCharacters = 0;

    if (!process.env.FIRECRAWL_API_KEY) {
      return {
        ...createAiGenerationFailure(
          new Error(
            "Firecrawl não está conectado. Conecte-o em Conectores para usar a pesquisa online.",
          ),
          Date.now() - startedAt,
        ),
        run_id: runId,
        prompt_versao: PROMPT_VERSAO_ONLINE,
        provider: "lovable-ai-gateway",
        model: ONLINE_GATEWAY_MODEL_ID,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        repair_attempted: false,
        fontes_consultadas: fontesRastreaveis,
        buscas_realizadas: buscasRealizadas,
      };
    }

    const lovableApiKey = process.env.LOVABLE_API_KEY;
    if (!lovableApiKey) {
      return {
        ...createAiGenerationFailure(
          new Error("LOVABLE_API_KEY não configurada."),
          Date.now() - startedAt,
        ),
        run_id: runId,
        prompt_versao: PROMPT_VERSAO_ONLINE,
        provider: "lovable-ai-gateway",
        model: ONLINE_GATEWAY_MODEL_ID,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        repair_attempted: false,
        fontes_consultadas: fontesRastreaveis,
        buscas_realizadas: buscasRealizadas,
      };
    }

    try {
      const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
      const { firecrawlSearch, firecrawlScrape } = await import("@/lib/firecrawl.server");
      const gateway = createLovableAiGatewayProvider(lovableApiKey);
      const model = gateway(ONLINE_GATEWAY_MODEL_ID);

      let scrapeCount = 0;

      const p = data.prognostico;
      const oddFinal = p.odd_ajustada ?? p.odd_original;
      const edgeFinal = p.edge_ajustado ?? p.edge_original;
      const checklistEsporte = getSportChecklist(p.esporte);
      const opcoesMesmoMercado = data.opcoes_mesmo_mercado ?? [];
      const opcoesMesmoMercadoTexto = opcoesMesmoMercado.length
        ? opcoesMesmoMercado
            .map((c, index) => {
              const odd = c.odd_ajustada ?? c.odd_original;
              const edge = c.edge_ajustado ?? c.edge_original;
              return `${index + 1}. ID: ${c.prognostico_id} | Mercado: ${c.mercado ?? p.mercado} | Pick: ${c.pick} | Odd ofertada: ${c.odd_original.toFixed(3)} | Odd usada: ${odd.toFixed(3)} | Odd mediana: ${formatNullableOdd(c.odd_mediana)} | Odd mercado base: ${formatNullableOdd(c.odd_mercado_base)} | Odd melhor: ${formatNullableOdd(c.odd_melhor)} | Bookmaker melhor: ${c.bookmaker_melhor ?? "-"} | Odd valor: ${c.odd_valor.toFixed(3)} | Prob: ${c.probabilidade.toFixed(2)}% | Edge: ${edge.toFixed(2)}%`;
            })
            .join("\n")
        : "(nenhuma lista explicita de opcoes do grupo foi informada)";
      const correlacionados = data.prognosticos_correlacionados ?? [];
      const correlacionadosTexto = correlacionados.length
        ? correlacionados
            .map((c, index) => {
              const odd = c.odd_ajustada ?? c.odd_original;
              const edge = c.edge_ajustado ?? c.edge_original;
              return `${index + 1}. Mercado: ${c.mercado} | Pick: ${c.pick} | Odd ofertada: ${c.odd_original.toFixed(3)} | Odd usada: ${odd.toFixed(3)} | Odd mediana: ${formatNullableOdd(c.odd_mediana)} | Odd mercado base: ${formatNullableOdd(c.odd_mercado_base)} | Odd melhor: ${formatNullableOdd(c.odd_melhor)} | Bookmaker melhor: ${c.bookmaker_melhor ?? "-"} | Prob: ${c.probabilidade_final.toFixed(2)}% | Edge: ${edge.toFixed(2)}%`;
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
Odd ofertada: ${p.odd_original.toFixed(3)}
Odd ajustada: ${p.odd_ajustada != null ? p.odd_ajustada.toFixed(3) : "—"}
Odd em uso: ${oddFinal.toFixed(3)}
Odd mediana: ${formatNullableOdd(p.odd_mediana)}
Odd mercado base: ${formatNullableOdd(p.odd_mercado_base)}
Odd melhor: ${formatNullableOdd(p.odd_melhor)}
Bookmaker melhor: ${p.bookmaker_melhor ?? "-"}
Odd de valor (fair): ${p.odd_valor.toFixed(3)}
Probabilidade final: ${p.probabilidade_final.toFixed(2)}%
Edge: ${edgeFinal.toFixed(2)}%
Stake sugerida: ${p.stake_sugerida}u

CONTEXTO LOCAL / DADOS TÉCNICOS MANUAIS:
${data.contexto_local?.trim() || data.dados_tecnicos?.trim() || "(nenhum)"}

CONTEXTO ONLINE PRÉ-CARREGADO, SE HOUVER:
${data.contexto_online?.trim() || data.contexto_adicional?.trim() || "(nenhum contexto online pré-carregado; use as ferramentas de pesquisa quando necessário)"}

CALIBRAÇÃO INTERNA ASP INSIGHTS:
${data.calibracao_interna?.trim() || "(histórico interno insuficiente ou indisponível)"}

OPÇÕES CONCORRENTES DO MESMO JOGO E MESMA FAMÍLIA DE MERCADO:
${opcoesMesmoMercadoTexto}

OUTRAS OPÇÕES PENDENTES DO MESMO JOGO E MESMA FAMÍLIA DE MERCADO:
${correlacionadosTexto}

CHECKLIST ESPECÍFICO DO ESPORTE:
${checklistEsporte}

Instrução reforçada:
Toda análise de valor (edge, EV, comparação com odd justa e comentários no parecer) DEVE usar exclusivamente a "Odd em uso" (que já reflete a odd ajustada quando existe). Não cite a "Odd ofertada" original como base para a decisão; ela é apenas referência histórica do modelo. Se mencionar odd no parecer, use a odd em uso.
Você deve usar o checklist específico do esporte. Não faça apenas busca genérica por notícias. Busque os fatores que realmente podem confirmar ou invalidar a tese da aposta conforme esporte, liga, mercado e pick. Quando não encontrar uma informação crítica, diga claramente que ela não foi encontrada. Não invente dados. Diferencie fatos confirmados, informações ausentes e inferências.
Antes de sugerir CONFIRMA, procure motivos concretos para PULAR. Se a tese contra a entrada for relevante ou houver informação crítica ausente/incerta, sugira PULAR. Não confirme apenas porque a entrada veio como EV+.
Não use 1.0u como stake padrão. Se houver qualquer dúvida entre 1.0u e 0.5u, use 0.5u. Se houver dúvida entre 0.5u e PULAR, use PULAR.
Se houver outras opções listadas acima, compare mercado, picks, odds, probabilidade, edge, proteção e risco/retorno. A resposta deve indicar a melhor opção para CONFIRMAR ou recomendar PULAR o grupo inteiro. Nunca confirme mais de uma opção do mesmo jogo e mesma família de mercado.
Não use a opção selecionada na interface como preferência. Ela serve apenas para ajuste de odd; sua decisão deve comparar todas as opções concorrentes.
Se sugerir CONFIRMA, devolva obrigatoriamente o campo prognostico_id_escolhido com um ID exato da lista OPÇÕES CONCORRENTES. Se sugerir PULAR, use prognostico_id_escolhido: null.

Faça pesquisas online conforme a política descrita e produza o parecer no formato exigido.`;

      const structuredSystemPrompt = `${SYSTEM_PROMPT}

FORMATO PARA O LOVABLE AI GATEWAY:
As instruções JSON abaixo substituem qualquer formato textual legado descrito anteriormente.
Depois de concluir as pesquisas, retorne somente um objeto JSON válido, sem markdown,
comentários ou texto antes/depois. Use exatamente os nomes de campos, enums e tipos
do template. Para CONFIRMA, use um ID/pick exatos do payload e stake 0.5, 1 ou 1.5.
Para PULAR, use ID/pick null e stake 0. Os campos sources e searches devem ser arrays
vazios: o servidor os preencherá exclusivamente com a telemetria real das ferramentas.

${ONLINE_GATEWAY_JSON_TEMPLATE}`;
      const rollout = resolveAiValidationRollout({
        mode: "online",
        userId: context.userId,
      });
      const rolloutSnapshot = rolloutTelemetry(rollout);
      const legacyRollbackEnabled = rollout.variant === "legacy";

      const researchTools = {
        web_search: tool({
          description:
            "Busca páginas relevantes na web. Use recency='day' para lineups/lesões do dia, 'week' para forma recente, 'month' para contexto geral.",
          inputSchema: z.object({
            query: z
              .string()
              .describe(
                "Consulta de busca (em inglês para esportes US, no idioma local para outros)",
              ),
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
            return results.flatMap((result) => {
              const url = recordOnlineSource(fontesRastreaveis, {
                titulo: result.title,
                url: result.url,
                tipo: "SEARCH_RESULT",
              });
              return url
                ? [
                    {
                      url,
                      title: result.title,
                      snippet: result.description?.slice(0, 300) ?? "",
                    },
                  ]
                : [];
            });
          },
        }),
        web_scrape: tool({
          description: "Lê o conteúdo completo de uma URL HTTP(S) específica em markdown.",
          inputSchema: z.object({
            url: z
              .string()
              .url()
              .refine((value) => normalizeOnlineHttpUrl(value) !== null, "URL HTTP(S) inválida"),
          }),
          execute: async ({ url }) => {
            const normalizedUrl = normalizeOnlineHttpUrl(url);
            if (!normalizedUrl) {
              return {
                url: "",
                title: "URL inválida bloqueada",
                markdown: "A URL solicitada não usa HTTP(S) e não foi consultada.",
              };
            }
            if (scrapeCount >= MAX_SCRAPES_ONLINE) {
              return {
                url: normalizedUrl,
                title: "Limite de páginas aprofundadas atingido",
                markdown: `Limite de ${MAX_SCRAPES_ONLINE} páginas aprofundadas por análise atingido. Use os snippets e fontes já coletados; sinalize se faltar informação crítica.`,
              };
            }
            scrapeCount += 1;
            const { markdown, title } = await firecrawlScrape(normalizedUrl);
            recordOnlineSource(fontesRastreaveis, {
              titulo: title,
              url: normalizedUrl,
              tipo: "SCRAPED",
            });
            return { url: normalizedUrl, title, markdown };
          },
        }),
      };

      promptCharacters = userPayload.length;
      const firstResult = await generateText({
        model,
        system: legacyRollbackEnabled ? SYSTEM_PROMPT : structuredSystemPrompt,
        prompt: userPayload,
        stopWhen: stepCountIs(50),
        tools: researchTools,
      });

      if (legacyRollbackEnabled) {
        const generation = createLegacyRollbackResult({
          output: adaptLegacyAiResponse({
            text: firstResult.text,
            sources: fontesRastreaveis
              .filter((source) => source.consultada)
              .map((source) => ({ titulo: source.titulo, url: source.url })),
            searches: buscasRealizadas,
          }),
          rawModelText: firstResult.text,
          latencyMs: Date.now() - startedAt,
        });
        return {
          ...generation,
          run_id: runId,
          prompt_versao: PROMPT_VERSAO_ONLINE,
          provider: "lovable-ai-gateway",
          model: ONLINE_GATEWAY_MODEL_ID,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          finish_reason: firstResult.finishReason,
          usage: sumAiTokenUsage(firstResult.usage),
          fontes_consultadas: fontesRastreaveis,
          buscas_realizadas: buscasRealizadas,
          repair_attempted: false,
          ...rolloutSnapshot,
        };
      }

      let finalResult = firstResult;
      let parsedOutput;
      try {
        parsedOutput = parseOnlineGatewayJson(firstResult.text, {
          sourceTraces: fontesRastreaveis,
          searches: buscasRealizadas,
        });
      } catch (initialError: unknown) {
        repairAttempted = true;
        try {
          finalResult = await generateText({
            model,
            system: structuredSystemPrompt,
            prompt: buildStructuredRepairPrompt({
              operationalContext: userPayload,
              previousOutput: firstResult.text,
              researchContext: [
                `Buscas: ${buscasRealizadas.join(" | ") || "(nenhuma)"}`,
                `Fontes: ${
                  fontesRastreaveis
                    .filter((source) => source.consultada)
                    .map((source) => `${source.titulo} — ${source.url}`)
                    .join(" | ") || "(nenhuma)"
                }`,
              ].join("\n"),
            }),
          });
        } catch (repairError: unknown) {
          throw new AiStructuredRepairFailure({
            stage: "REQUEST",
            initialError,
            repairError,
          });
        }
        try {
          parsedOutput = parseOnlineGatewayJson(finalResult.text, {
            sourceTraces: fontesRastreaveis,
            searches: buscasRealizadas,
          });
        } catch (repairError: unknown) {
          throw new AiStructuredRepairFailure({
            stage: "PARSE",
            initialError,
            repairError,
          });
        }
      }

      const generation = parseStructuredAiOutput({
        output: parsedOutput,
        rawModelText: finalResult.text,
        latencyMs: Date.now() - startedAt,
        mode: "online",
      });
      return {
        ...generation,
        run_id: runId,
        prompt_versao: PROMPT_VERSAO_ONLINE,
        provider: "lovable-ai-gateway",
        model: ONLINE_GATEWAY_MODEL_ID,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        finish_reason: finalResult.finishReason,
        usage: sumAiTokenUsage(firstResult.usage, repairAttempted ? finalResult.usage : undefined),
        repair_attempted: repairAttempted,
        fontes_consultadas: fontesRastreaveis,
        buscas_realizadas: buscasRealizadas,
        ...rolloutSnapshot,
      };
    } catch (err: unknown) {
      const rollout = resolveAiValidationRollout({
        mode: "online",
        userId: context.userId,
      });
      return {
        ...createAiGenerationFailure(err, Date.now() - startedAt, {
          phase: repairAttempted ? "REPAIR_GENERATION" : "INITIAL_GENERATION",
          promptCharacters,
        }),
        run_id: runId,
        prompt_versao: PROMPT_VERSAO_ONLINE,
        provider: "lovable-ai-gateway",
        model: ONLINE_GATEWAY_MODEL_ID,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        repair_attempted: repairAttempted,
        fontes_consultadas: fontesRastreaveis,
        buscas_realizadas: buscasRealizadas,
        ...rolloutTelemetry(rollout),
      };
    }
  });
