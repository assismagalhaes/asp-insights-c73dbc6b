import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import { generateText } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO = "validacao-critica-v9-local-interno";

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

const GroupOptionSchema = z.object({
  prognostico_id: z.string(),
  mercado: z.string().optional(),
  pick: z.string(),
  linha: z.string().nullable().optional(),
  odd_original: z.number(),
  odd_ajustada: z.number().nullable().optional(),
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
    linha: z.string().nullable().optional(),
    odd_original: z.number(),
    odd_ajustada: z.number().nullable().optional(),
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

function isAspMatrixMarket(value: unknown): boolean {
  const normalized = normalizeMarketName(value);
  return (
    normalized.includes("cornermatrix") ||
    normalized.includes("cornersmatrix") ||
    normalized.includes("goalmatrix") ||
    normalized.includes("goalsmatrix")
  );
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
- MODO IA LOCAL: use exclusivamente dados internos/localmente disponíveis no payload: prognóstico, dados técnicos manuais/importados, odds, linha, probabilidade, edge, mercado, esporte, liga, opções concorrentes e calibração/histórico interno.
- MODO IA LOCAL: é proibido usar, inferir, exigir ou penalizar por notícias online, pesquisa web, odds externas em tempo real, lesões buscadas online, escalações online, lineups online, clima online ou qualquer contexto externo que não esteja explicitamente colado nos dados técnicos manuais.
- MODO IA LOCAL: não mencione ausência de notícias, lesões, escalações, lineups, fontes externas ou contexto online como motivo de PULAR/reduzir stake, salvo quando o próprio contexto manual afirmar que essa informação interna é desconhecida e determinante.
- Avaliar coerência técnica, matchup, forma, projeções, linha, odd, risco e contexto colado pelo usuário.
- Se houver bom argumento, mas risco estrutural relevante, a decisão padrão deve ser PULAR.
- Regra de stake: 1.0u NÃO é padrão automático.
  - PULAR: use quando houver risco relevante, informação crítica ausente, tese fraca, fonte/contexto insuficiente, pick redundante, contexto contraditório ou risco estrutural alto.
  - CONFIRMA 0.5u: use quando a tese é boa, mas há incerteza moderada, contexto não perfeito, risco normal do esporte, amostra pequena ou mercado volátil.
  - CONFIRMA 1.0u: use apenas quando a tese técnica é consistente, não há risco estrutural relevante, o contexto manual não contradiz a entrada, a informação crítica está confirmada no contexto e não há pick melhor concorrente no mesmo mercado.
  - CONFIRMA 1.5u: use raramente, somente quando a tese técnica é forte, múltiplos sinais confirmam, risco estrutural é baixo, contexto é favorável ou neutro, não há informação crítica ausente e histórico interno semelhante é positivo com amostra suficiente quando esse histórico estiver disponível.
  - Quando estiver em dúvida entre 1.0u e 0.5u, use 0.5u.
  - Quando estiver em dúvida entre 0.5u e PULAR, use PULAR.
- Use a calibração interna ASP Insights apenas como apoio. Não trate histórico curto como verdade estatística.
- Se a calibração informar taxa recente de confirmação acima de 85%, reforce a auditoria de risco e procure motivos reais para PULAR.
- Não use a calibração para confirmar automaticamente. Ela é um sinal auxiliar, inferior aos dados do prognóstico, contexto e gates de risco.

Regras para grupo de opções concorrentes:
- Quando houver uma lista de opções concorrentes do mesmo jogo e mercado/família de mercado, você está validando o grupo inteiro, não apenas a primeira opção.
- A opção selecionada na interface serve apenas para ajuste de odd pelo usuário. Não trate essa seleção como preferência ou decisão prévia.
- Sua tarefa não é recalcular EV. Sua tarefa é comparar as opções disponíveis e decidir se existe uma opção tecnicamente superior para confirmação.
- Escolha no máximo uma opção do grupo. Nunca confirme mais de uma opção.
- Não escolha automaticamente a maior probabilidade, o maior edge ou a maior odd.
- Compare linha, odd, probabilidade, edge, contexto técnico, risco e coerência do mercado.
- Moneyline/1X2, Handicap e Dupla Chance podem representar a mesma tese de resultado/proteção. Compare proteção da linha, risco/retorno e exposição duplicada, e escolha somente uma entrada principal quando forem correlatas.
- Se nenhuma opção tiver sustentação técnica suficiente, retorne PULAR.
- Se houver risco estrutural relevante, prefira PULAR.

Regra específica para IA Local em ASP CornerMatrix e ASP GoalMatrix/ASP GoalsMatrix:
- Aplique esta regra apenas quando o mercado/modelo contiver ASP CornerMatrix, CornerMatrix, ASP CornersMatrix, ASP GoalMatrix, ASP GoalsMatrix, GoalMatrix ou GoalsMatrix.
- Nesses modelos, o campo CV/Coeficiente de Variação é uma métrica própria de consistência do modelo, não o CV estatístico tradicional.
- Não interprete CV alto como dispersão, oscilação, variabilidade alta ou baixa confiabilidade.
- Interpretação correta do CV nesses modelos: quanto mais próximo de 100, maior a consistência; quanto mais baixo, menor a consistência.
- CV de 60% indica consistência moderada/boa dentro da métrica do modelo. Não classifique como alta inconsistência.
- CV acima de 70% indica boa consistência.
- CV acima de 80% indica consistência forte.
- CV abaixo de 50% pede atenção/cautela.
- CV abaixo de 40% indica baixa consistência.
- Frases proibidas para esses modelos: "CV de 60% indica alta inconsistência", "CV elevado indica oscilação", "CV próximo de 100 indica maior variabilidade", "CV alto reduz confiabilidade".
- A ausência de notícias online, contexto externo, escalações prováveis, desfalques, informações recentes de imprensa, movimentação de mercado ou confirmação de titulares NÃO deve ser usada como motivo principal para PULAR ou reduzir confiança nesses modelos.
- Para esses modelos, priorize dados técnicos do próprio modelo, médias, linhas analisadas, probabilidade, odd de valor, edge, consistência da amostra, CV como consistência, coerência entre tendência histórica/simulação/linha ofertada e qualidade da oportunidade.
- Só sugira PULAR nesses modelos quando houver fragilidade nos dados internos do modelo: edge fraco, odd sem valor, linha incompatível com projeção, baixa consistência, conflito forte entre indicadores internos ou dados técnicos insuficientes.
- Essa exceção não vale para Moneyline, Over/Under comum, Handicap comum, Dupla Chance, Basketball, Baseball, Hockey, American Football ou demais mercados.

Gates obrigatórios:
- Gate 1 — Coerência técnica: tese precisa estar coerente com mercado, pick, linha, probabilidade, edge ajustado/original, contexto informado, esporte e liga. Conflito técnico relevante = PULAR.
- Gate 2 — Risco estrutural: risco estrutural alto = PULAR. Exemplos: MLB starter incerto/bullpen desgastado/lineup alternativo; NBA/WNBA estrela questionável/rotação incerta/back-to-back forte; NHL goalie não confirmado em pick sensível; NFL QB questionável/clima forte/desfalques OL/defesa; Futebol escalação rodada/mata-mata incerto/desfalques-chave.
- Gate 3 — Informação crítica ausente: se informação crítica necessária não estiver disponível = PULAR; no máximo CONFIRMA 0.5u apenas se a informação ausente não for determinante.
- Gate 4 — Contexto interno/manual: aprove quando a tese for sustentada pelos dados internos e pelo contexto manual disponível. Não reprove por ausência de fonte online, notícia, escalação, lesão ou confirmação externa; esses fatores pertencem apenas ao modo IA Local + Pesquisa, salvo se estiverem explicitamente colados no contexto manual.
- Gate 5 — Risco > benefício: se houver 2 ou mais riscos relevantes, PULAR.
- Gate 6 — Duplicidade/correlação: se houver outras picks do mesmo jogo e mesmo grupo de mercado, trate como opções concorrentes. Você deve escolher no máximo uma opção para CONFIRMAR ou recomendar PULAR o grupo inteiro. Nunca sugira confirmar mais de uma opção do grupo.

Formato OBRIGATÓRIO da resposta (use exatamente estes cabeçalhos em texto puro, sem markdown):

A) Entrada avaliada
Jogo:
Mercado:
Pick:
Linha:
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
pick_escolhida: pick e linha da opção escolhida ou null
stake_confirmada: 0.5 | 1.0 | 1.5 | 0
Stake sugerida: 0.5u | 1.0u | 1.5u, apenas se CONFIRMAR
justificativa_linha:
riscos:
condicao_invalidacao:
Justificativa final objetiva:
Condição que faria mudar a decisão:`;

function parseDecisao(text: string): {
  decisao: string | null;
  stake: number | null;
  prognostico_id_escolhido: string | null;
  pick_escolhida: string | null;
} {
  const groupDecisionMatch = text.match(/decis[aã]o_grupo\s*:\s*"?\s*(confirma|confirmar|pular|pass)/i);
  const decisionMatch = groupDecisionMatch ?? text.match(/decis[aã]o(?:\s+final)?\s*:\s*(confirma|confirmar|pular|pass|aguardar not[ií]cia|confirma com cautela)/i);
  const slice = decisionMatch?.index != null ? text.slice(decisionMatch.index) : text;
  const decisionText = decisionMatch?.[1]?.toLowerCase() ?? "pular";
  const decisao: string | null = /\bconfirma|confirmar\b/.test(decisionText) ? "CONFIRMA" : "PULAR";
  const stakeMatch = slice.match(/stake_confirmada\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i) ?? slice.match(/stake[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);
  const stake = decisao === "CONFIRMA" && stakeMatch ? Number(stakeMatch[1].replace(",", ".")) : null;
  const idMatch = text.match(/prognostico_id_escolhido\s*:\s*"?\s*([0-9a-f-]{8,}|null)/i);
  const pickMatch = text.match(/pick_escolhida\s*:\s*"?\s*([^"\n\r]+)/i);
  const prognostico_id_escolhido = idMatch?.[1] && idMatch[1].toLowerCase() !== "null" ? idMatch[1].trim() : null;
  const pick_escolhida = pickMatch?.[1] && pickMatch[1].trim().toLowerCase() !== "null" ? pickMatch[1].trim() : null;
  return { decisao, stake, prognostico_id_escolhido, pick_escolhida };
}

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
    const isAspMatrix =
      isAspMatrixMarket(p.mercado) ||
      isAspMatrixMarket(p.pick) ||
      isAspMatrixMarket(data.dados_tecnicos) ||
      opcoesMesmoMercado.some((opcao) => isAspMatrixMarket(opcao.mercado) || isAspMatrixMarket(opcao.pick)) ||
      (data.prognosticos_correlacionados ?? []).some(
        (opcao) => isAspMatrixMarket(opcao.mercado) || isAspMatrixMarket(opcao.pick),
      );
    const aspMatrixInstrucao = isAspMatrix
      ? `\nREGRA ESPECIFICA ATIVA - ASP GOAL/CORNER MATRIX:\nEste grupo foi identificado como ASP CornerMatrix, CornerMatrix, ASP CornersMatrix, ASP GoalMatrix, ASP GoalsMatrix, GoalMatrix ou GoalsMatrix.\nInterprete CV/Coeficiente de Variacao como metrica propria de consistencia do modelo: mais perto de 100 = maior consistencia; 60% = consistencia moderada/boa; acima de 70% = boa; acima de 80% = forte; abaixo de 50% = cautela; abaixo de 40% = baixa consistencia.\nNao use a ausencia de noticias online, escalacoes, desfalques, fontes externas ou confirmacao de titulares como motivo principal para PULAR ou reduzir confianca. Julgue principalmente os dados internos do modelo, probabilidade, odd de valor, edge, linha, medias, tendencia historica, simulacao e consistencia da amostra.\nSe mencionar CV, use linguagem de consistencia do modelo e nunca linguagem de dispersao estatistica tradicional.\n`
      : "";
    const opcoesMesmoMercadoTexto = opcoesMesmoMercado.length
      ? opcoesMesmoMercado
          .map((c, index) => {
            const odd = c.odd_ajustada ?? c.odd_original;
            const edge = c.edge_ajustado ?? c.edge_original;
            return `${index + 1}. ID: ${c.prognostico_id} | Mercado: ${c.mercado ?? p.mercado} | Pick: ${c.pick} | Linha: ${c.linha ?? "-"} | Odd original: ${c.odd_original.toFixed(3)} | Odd usada: ${odd.toFixed(3)} | Odd valor: ${c.odd_valor.toFixed(3)} | Prob: ${c.probabilidade.toFixed(2)}% | Edge: ${edge.toFixed(2)}%`;
          })
          .join("\n")
      : "(nenhuma lista explicita de opcoes do grupo foi informada)";
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

    const userPayload = `DADOS DO PROGNÓSTICO (somente os abaixo — não busque nada externo):

Data: ${p.data}${p.hora ? ` ${p.hora}` : ""}
Esporte: ${p.esporte}
Liga: ${p.liga}
Jogo: ${p.jogo}
Mercado: ${p.mercado}
Pick: ${p.pick}
Linha: ${p.linha ?? "-"}
Odd original: ${p.odd_original.toFixed(3)}
Odd ajustada: ${p.odd_ajustada != null ? p.odd_ajustada.toFixed(3) : "—"}
Odd em uso para análise: ${oddFinal.toFixed(3)}
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
Antes de sugerir CONFIRMA, procure motivos concretos para PULAR. Se a tese contra a entrada for relevante ou houver informação importante ausente, sugira PULAR. Não confirme apenas porque a entrada veio como EV+.
Não use 1.0u como stake padrão. Se houver qualquer dúvida entre 1.0u e 0.5u, use 0.5u. Se houver dúvida entre 0.5u e PULAR, use PULAR.
Se houver opcoes concorrentes listadas acima, compare mercado, linhas, odds, probabilidade, edge, protecao da linha e risco/retorno. A resposta deve indicar a melhor opcao para CONFIRMAR ou recomendar PULAR o grupo inteiro. Nunca confirme mais de uma opcao do mesmo jogo e mesma familia de mercado.
Nao use a opcao selecionada na interface como preferencia. Ela serve apenas para ajuste de odd; sua decisao deve comparar todas as opcoes concorrentes.
Se sugerir CONFIRMA, devolva obrigatoriamente o campo prognostico_id_escolhido com um ID exato da lista OPÇÕES CONCORRENTES. Se sugerir PULAR, use prognostico_id_escolhido: null.
${aspMatrixInstrucao}
`;

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: userPayload,
      });

      const { decisao, stake, prognostico_id_escolhido, pick_escolhida } = parseDecisao(text);
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
