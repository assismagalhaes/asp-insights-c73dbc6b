import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import { generateText } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO = "validacao-critica-v6-grupo-mercado";

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
  contexto_adicional: z.string().nullable().optional(),
  calibracao_interna: z.string().nullable().optional(),
});

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

Regras para grupo de opções do mesmo mercado:
- Quando houver uma lista de opções concorrentes do mesmo jogo e mercado, você está validando o grupo inteiro, não apenas a primeira opção.
- Sua tarefa não é recalcular EV. Sua tarefa é comparar as opções disponíveis e decidir se existe uma opção tecnicamente superior para confirmação.
- Escolha no máximo uma opção do grupo. Nunca confirme mais de uma opção.
- Não escolha automaticamente a maior probabilidade, o maior edge ou a maior odd.
- Compare linha, odd, probabilidade, edge, contexto técnico, risco e coerência do mercado.
- Se nenhuma opção tiver sustentação técnica suficiente, retorne PULAR.
- Se houver risco estrutural relevante, prefira PULAR.

Gates obrigatórios:
- Gate 1 — Coerência técnica: tese precisa estar coerente com mercado, pick, linha, probabilidade, edge ajustado/original, contexto informado, esporte e liga. Conflito técnico relevante = PULAR.
- Gate 2 — Risco estrutural: risco estrutural alto = PULAR. Exemplos: MLB starter incerto/bullpen desgastado/lineup alternativo; NBA/WNBA estrela questionável/rotação incerta/back-to-back forte; NHL goalie não confirmado em pick sensível; NFL QB questionável/clima forte/desfalques OL/defesa; Futebol escalação rodada/mata-mata incerto/desfalques-chave.
- Gate 3 — Informação crítica ausente: se informação crítica necessária não estiver disponível = PULAR; no máximo CONFIRMA 0.5u apenas se a informação ausente não for determinante.
- Gate 4 — Fontes: para IA local, aprove se não depende de fonte online; reprove se a tese exige confirmação externa que não foi fornecida no contexto.
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
    const opcoesMesmoMercadoTexto = opcoesMesmoMercado.length
      ? opcoesMesmoMercado
          .map((c, index) => {
            const odd = c.odd_ajustada ?? c.odd_original;
            const edge = c.edge_ajustado ?? c.edge_original;
            return `${index + 1}. ID: ${c.prognostico_id} | Pick: ${c.pick} | Linha: ${c.linha ?? "-"} | Odd original: ${c.odd_original.toFixed(3)} | Odd usada: ${odd.toFixed(3)} | Odd valor: ${c.odd_valor.toFixed(3)} | Prob: ${c.probabilidade.toFixed(2)}% | Edge: ${edge.toFixed(2)}%`;
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

CONTEXTO DA ANÁLISE:
${data.contexto_adicional?.trim() || data.dados_tecnicos?.trim() || "(nenhum contexto informado — trate como informação ausente)"}

CALIBRAÇÃO INTERNA ASP INSIGHTS:
${data.calibracao_interna?.trim() || "(histórico interno insuficiente ou indisponível)"}

OPÇÕES CONCORRENTES DO MESMO JOGO E MESMO MERCADO:
${opcoesMesmoMercadoTexto}

OUTRAS OPÇÕES PENDENTES DO MESMO JOGO E MESMO MERCADO:
${correlacionadosTexto}

INSTRUÇÃO DE AUDITORIA:
Antes de sugerir CONFIRMA, procure motivos concretos para PULAR. Se a tese contra a entrada for relevante ou houver informação importante ausente, sugira PULAR. Não confirme apenas porque a entrada veio como EV+.
Não use 1.0u como stake padrão. Se houver qualquer dúvida entre 1.0u e 0.5u, use 0.5u. Se houver dúvida entre 0.5u e PULAR, use PULAR.
Se houver opcoes concorrentes listadas acima, compare linhas, odds, probabilidade e edge. A resposta deve indicar a melhor opcao para CONFIRMAR ou recomendar PULAR o grupo inteiro. Nunca confirme mais de uma opcao do mesmo jogo e mercado.
Se sugerir CONFIRMA, devolva obrigatoriamente o campo prognostico_id_escolhido com um ID exato da lista OPÇÕES CONCORRENTES. Se sugerir PULAR, use prognostico_id_escolhido: null.
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
