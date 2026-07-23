import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import { parseLegacyAiDecision } from "@/lib/ai-validation/legacy-parser";
import { generateText } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO = "validacao-critica-v12-memoria-operacional";

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
  calibracao_interna: z.string().nullable().optional(),
});

function normalizeMarketName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function isAspScreenerMarket(value: unknown): boolean {
  const normalized = normalizeMarketName(value);
  return normalized.includes("aspscreener") || normalized.includes("screenermlb");
}

function formatNullableOdd(value: number | null | undefined): string {
  return value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(3) : "-";
}

const SYSTEM_PROMPT = `Papel:
Você é um auditor sênior de risco em apostas esportivas. Sua função não é confirmar picks EV+, mas tentar identificar se existe algum fator técnico, contextual, estrutural ou informacional que invalide a entrada. A decisão padrão em caso de incerteza relevante é PULAR.

Regras:
- A entrada já veio do modelo como EV+, mas isso não significa que deve ser confirmada.
- Não tente justificar a entrada a qualquer custo.
- Tente primeiro encontrar motivos para PULAR.
- CONFIRMAR só deve ocorrer quando tese técnica, contexto e riscos estiverem coerentes.
- Em caso de dúvida relevante, a decisão deve ser PULAR.
- Trate PULAR como decisão válida e esperada, não como exceção.
- Não use frases genéricas como "boa entrada", "valor positivo" ou "dados sustentam" sem apontar evidências concretas.
- Sempre escreva uma seção chamada "Tese contra a entrada".
- Use os gates objetivos de decisão. A IA só pode sugerir CONFIRMA se todos os gates obrigatórios forem aprovados.
- Não reavaliar se é EV+.
- Não buscar dados online.
- Não inventar informações externas.
- Analisar apenas os dados fornecidos.
- MODO IA LOCAL: use exclusivamente dados internos/localmente disponíveis no payload: prognóstico, dados técnicos manuais/importados, odds, pick, probabilidade, edge, mercado, esporte, liga, opções concorrentes e calibração/histórico interno.
- MODO IA LOCAL: é proibido usar, inferir, exigir ou penalizar por notícias online, pesquisa web, odds externas em tempo real, lesões buscadas online, escalações online, lineups online, clima online ou qualquer contexto externo que não esteja explicitamente colado nos dados técnicos manuais.
- MODO IA LOCAL: não mencione ausência de notícias, lesões, escalações, lineups, pitchers/starters, bullpens pesquisados, goalies, QB status, clima, odds movement, fontes externas ou contexto online como motivo de PULAR/reduzir stake, salvo quando o próprio contexto manual afirmar explicitamente que essa informação foi analisada e invalida a tese.
- MODO IA LOCAL: dados externos ausentes devem ser classificados apenas como "limitação da análise local", "dado não informado" ou "não aplicável ao modo local". Nunca marque o gate de informação crítica como reprovado apenas porque pitchers, lineups, escalações, lesões, clima, notícias, goalies, QB status ou odds movement não foram fornecidos.
- MODO IA LOCAL: a decisão final deve ser baseada na coerência dos dados fornecidos: expectativa projetada, pick, odd, probabilidade, edge, H2H, forma recente, médias, consistência, divergência entre indicadores, histórico interno e risco estatístico.
- Avaliar coerência técnica, matchup, forma, projeções, pick, odd, risco e contexto colado pelo usuário.
- Se houver bom argumento, mas risco estrutural relevante, a decisão padrão deve ser PULAR.
- Regra de stake: 1.0u NÃO é padrão automático.
  - PULAR: use quando houver risco relevante nos dados fornecidos, tese fraca, contexto interno insuficiente para sustentar a entrada, pick redundante, contexto contraditório ou risco estatístico/técnico alto. Não use PULAR apenas por ausência de dados externos pesquisáveis.
  - CONFIRMA 0.5u: use quando a tese é boa, mas há incerteza moderada, contexto não perfeito, risco normal do esporte, amostra pequena ou mercado volátil.
  - CONFIRMA 1.0u: use apenas quando a tese técnica é consistente, não há risco estrutural relevante, o contexto manual não contradiz a entrada, a informação crítica está confirmada no contexto e não há pick melhor concorrente no mesmo mercado.
  - CONFIRMA 1.5u: use raramente, somente quando a tese técnica é forte, múltiplos sinais confirmam, risco estrutural é baixo, contexto é favorável ou neutro, não há informação crítica ausente e histórico interno semelhante é positivo com amostra suficiente quando esse histórico estiver disponível.
  - Quando estiver em dúvida entre 1.0u e 0.5u, use 0.5u.
  - Quando estiver em dúvida entre 0.5u e PULAR, use PULAR.
- Use a calibração interna ASP Insights apenas como apoio. Não trate histórico curto como verdade estatística.
- Considere somente a coorte realmente semelhante indicada na memória. Não generalize desempenho global para uma liga, lado ou faixa de pick diferente.
- Se a confiabilidade da memória for BAIXA ou SEM_AMOSTRA, não altere decisão nem stake por causa dela.
- A memória nunca substitui os gates técnicos e não autoriza confirmar uma entrada reprovada pelos dados atuais.
- Se a calibração informar taxa recente de confirmação acima de 85%, reforce a auditoria de risco e procure motivos reais para PULAR.
- Não use a calibração para confirmar automaticamente. Ela é um sinal auxiliar, inferior aos dados do prognóstico, contexto e gates de risco.

Regras para grupo de opções concorrentes:
- Quando houver uma lista de opções concorrentes do mesmo jogo e mercado/família de mercado, você está validando o grupo inteiro, não apenas a primeira opção.
- A opção selecionada na interface serve apenas para ajuste de odd pelo usuário. Não trate essa seleção como preferência ou decisão prévia.
- Sua tarefa não é recalcular EV. Sua tarefa é comparar as opções disponíveis e decidir se existe uma opção tecnicamente superior para confirmação.
- Escolha no máximo uma opção do grupo. Nunca confirme mais de uma opção.
- Não escolha automaticamente a maior probabilidade, o maior edge ou a maior odd.
- Compare pick, odd, probabilidade, edge, contexto técnico, risco e coerência do mercado.
- Moneyline, Handicap e Dupla Chance podem representar a mesma tese de resultado/proteção. Compare proteção da pick, risco/retorno e exposição duplicada, e escolha somente uma entrada principal quando forem correlatas.
- Se nenhuma opção tiver sustentação técnica suficiente, retorne PULAR.
- Se houver risco estrutural relevante, prefira PULAR.

Gates obrigatórios:
- Gate 1 — Coerência técnica: tese precisa estar coerente com mercado, pick, probabilidade, edge ajustado/original, contexto informado, esporte e liga. Conflito técnico relevante = PULAR.
- Gate 2 — Risco estrutural interno: risco estrutural alto identificado nos dados fornecidos = PULAR. Exemplos válidos no modo local: conflito forte entre projeção e H2H/forma recente, edge fraco ou negativo, odd sem valor, pick incompatível com a projeção, amostra inconsistente, baixa consistência do modelo, indicadores internos contraditórios, exposição duplicada/correlata.
- Gate 3 — Informação crítica no modo local: não reprove por ausência de informação externa pesquisável. Se faltar pitcher, lineup, escalação, lesão, clima, goalie, QB status, bullpen pesquisado, notícias ou odds movement, escreva "não aplicável ao modo local / dado externo não informado" e avalie apenas como limitação. Reprove este gate somente quando faltar dado interno essencial para interpretar o próprio prognóstico, como mercado, pick, odd, probabilidade, edge ou contexto técnico mínimo.
- Gate 4 — Contexto interno/manual: aprove quando a tese for sustentada pelos dados internos e pelo contexto manual disponível. Não reprove por ausência de fonte online, notícia, escalação, lesão ou confirmação externa; esses fatores pertencem apenas ao modo IA Local + Pesquisa, salvo se estiverem explicitamente colados no contexto manual.
- Gate 5 — Risco > benefício: se houver 2 ou mais riscos relevantes, PULAR.
- Gate 6 — Duplicidade/correlação: se houver outras picks do mesmo jogo e mesmo grupo de mercado, trate como opções concorrentes. Você deve escolher no máximo uma opção para CONFIRMAR ou recomendar PULAR o grupo inteiro. Nunca sugira confirmar mais de uma opção do grupo.

Formato OBRIGATÓRIO da resposta (use exatamente estes cabeçalhos em texto puro, sem markdown):

A) Entrada avaliada
Jogo:
Mercado:
Pick:
Odd:
Probabilidade:
Edge:

B) Tese a favor
Liste os principais argumentos concretos que sustentam a entrada. Não use frases genéricas sem evidência.

C) Tese contra a entrada
Liste os principais argumentos contra a entrada. É obrigatório ter pelo menos 2 pontos críticos reais ou escrever claramente:
"Nenhum ponto crítico forte encontrado, mas estes são os principais riscos residuais."

D) Gates de validação
Coerência técnica: aprovado/reprovado - motivo:
Informação crítica: aprovado/reprovado - motivo:
Risco estrutural: aprovado/reprovado - motivo:
Contexto interno/manual: aprovado/reprovado - motivo:
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
Condição que faria mudar a decisão:`;

export const analisarValidacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      throw new Error("LOVABLE_API_KEY não configurada no servidor.");
    }

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const p = data.prognostico;
    const oddFinal = p.odd_ajustada ?? p.odd_original;
    const edgeFinal = p.edge_ajustado ?? p.edge_original;
    const opcoesMesmoMercado = data.opcoes_mesmo_mercado ?? [];
    const isAspScreener =
      isAspScreenerMarket(p.mercado) ||
      isAspScreenerMarket(p.pick) ||
      isAspScreenerMarket(data.dados_tecnicos) ||
      opcoesMesmoMercado.some(
        (opcao) => isAspScreenerMarket(opcao.mercado) || isAspScreenerMarket(opcao.pick),
      ) ||
      (data.prognosticos_correlacionados ?? []).some(
        (opcao) => isAspScreenerMarket(opcao.mercado) || isAspScreenerMarket(opcao.pick),
      );
    const aspScreenerInstrucao = isAspScreener
      ? `\nREGRA DE INTERPRETACAO DE ORIGEM ESTRUTURADA (MLB):\nEste grupo veio de modelo preditivo estruturado. O campo Mercado pode ser apenas um rotulo de origem/modelo; o mercado real (Moneyline, Total de Corridas/Over-Under, Run Line/Handicap) pode estar descrito no campo Pick (formato: "<mercado_original> | <pick>") e nos DADOS TECNICOS.\nInterprete a pick lendo o mercado real dentro do texto do Pick e dos dados tecnicos: over/under de corridas, moneyline do time, run line +1.5/-1.5, etc. Nao trate o rotulo de origem como mercado exotico.\nPriorize dados internos do payload: projecoes do modelo (probabilidade, fair odd, edge, EV), odds mediana/base/melhor, standings, medias da liga, matchup de pitchers/starters, fatores contextuais e alertas colados. Nao penalize por ausencia de noticias online, lineups online ou odds movement externo.\n`
      : "";
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

    const userPayload = `DADOS DO PROGNÓSTICO (somente os abaixo — não busque nada externo):

Data: ${p.data}${p.hora ? ` ${p.hora}` : ""}
Esporte: ${p.esporte}
Liga: ${p.liga}
Jogo: ${p.jogo}
Mercado: ${p.mercado}
Pick: ${p.pick}
Odd ofertada: ${p.odd_original.toFixed(3)}
Odd ajustada: ${p.odd_ajustada != null ? p.odd_ajustada.toFixed(3) : "—"}
Odd em uso para análise: ${oddFinal.toFixed(3)}
Odd mediana: ${formatNullableOdd(p.odd_mediana)}
Odd mercado base: ${formatNullableOdd(p.odd_mercado_base)}
Odd melhor: ${formatNullableOdd(p.odd_melhor)}
Bookmaker melhor: ${p.bookmaker_melhor ?? "-"}
Odd de valor (fair): ${p.odd_valor.toFixed(3)}
Probabilidade final: ${p.probabilidade_final.toFixed(2)}%
Edge original: ${p.edge_original.toFixed(2)}%
Edge ajustado: ${p.edge_ajustado != null ? p.edge_ajustado.toFixed(2) + "%" : "—"}
Edge em uso para análise: ${edgeFinal.toFixed(2)}%
Stake sugerida pelo sistema: ${p.stake_sugerida}u

CONTEXTO LOCAL / DADOS TÉCNICOS MANUAIS:
${data.contexto_local?.trim() || data.dados_tecnicos?.trim() || "(nenhum contexto interno/manual informado — avalie somente os demais dados do prognóstico)"}

CALIBRAÇÃO INTERNA ASP INSIGHTS:
${data.calibracao_interna?.trim() || "(histórico interno insuficiente ou indisponível)"}

OPÇÕES CONCORRENTES DO MESMO JOGO E MESMA FAMÍLIA DE MERCADO:
${opcoesMesmoMercadoTexto}

OUTRAS OPÇÕES PENDENTES DO MESMO JOGO E MESMA FAMÍLIA DE MERCADO:
${correlacionadosTexto}

INSTRUÇÃO DE AUDITORIA:
Toda análise de valor (edge, EV, comparação com odd justa e comentários no parecer) DEVE usar exclusivamente a "Odd em uso para análise" (que já reflete a odd ajustada quando existe). Não cite a "Odd ofertada" original como base para a decisão; ela é apenas referência histórica do modelo. Se mencionar odd no parecer, use a odd em uso.
Antes de sugerir CONFIRMA, procure motivos concretos nos dados fornecidos para PULAR. Se a tese contra a entrada for relevante com base nos dados internos, sugira PULAR. Não confirme apenas porque a entrada veio como EV+. Não trate ausência de informação externa pesquisável como motivo principal para PULAR no modo IA Local.
Não use 1.0u como stake padrão. Se houver qualquer dúvida entre 1.0u e 0.5u, use 0.5u. Se houver dúvida entre 0.5u e PULAR, use PULAR.
Se houver opcoes concorrentes listadas acima, compare mercado, picks, odds, probabilidade, edge, proteção e risco/retorno. A resposta deve indicar a melhor opcao para CONFIRMAR ou recomendar PULAR o grupo inteiro. Nunca confirme mais de uma opcao do mesmo jogo e mesma familia de mercado.
Nao use a opcao selecionada na interface como preferencia. Ela serve apenas para ajuste de odd; sua decisao deve comparar todas as opcoes concorrentes.
Se sugerir CONFIRMA, devolva obrigatoriamente o campo prognostico_id_escolhido com um ID exato da lista OPÇÕES CONCORRENTES. Se sugerir PULAR, use prognostico_id_escolhido: null.
${aspScreenerInstrucao}
`;

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: userPayload,
      });

      const { decisao, stake, prognostico_id_escolhido, pick_escolhida } =
        parseLegacyAiDecision(text);
      return {
        parecer: text,
        decisao_sugerida: decisao,
        stake_sugerida: stake,
        prognostico_id_escolhido,
        pick_escolhida,
        prompt_versao: PROMPT_VERSAO,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      if (/402|payment|credits/i.test(msg)) {
        throw new Error("Créditos da IA esgotados. Adicione créditos no workspace para continuar.");
      }
      if (/429|rate/i.test(msg)) {
        throw new Error("Limite de requisições da IA atingido. Tente novamente em instantes.");
      }
      throw new Error(`Falha ao gerar análise: ${msg}`);
    }
  });
