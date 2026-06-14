import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO = "validacao-critica-v3-risk-gates";

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
- Stake sugerida:
  - 0.5u = baixa confiança, cenário frágil ou dependente de informação ausente.
  - 1.0u = confiança moderada, tese sólida com riscos normais.
  - 1.5u = use apenas em cenário raro, com tese forte, múltiplas confirmações concretas e poucos pontos de falha.

Gates obrigatórios:
- Gate 1 — Coerência técnica: tese precisa estar coerente com mercado, pick, linha, probabilidade, edge ajustado/original, contexto informado, esporte e liga. Conflito técnico relevante = PULAR.
- Gate 2 — Risco estrutural: risco estrutural alto = PULAR. Exemplos: MLB starter incerto/bullpen desgastado/lineup alternativo; NBA/WNBA estrela questionável/rotação incerta/back-to-back forte; NHL goalie não confirmado em pick sensível; NFL QB questionável/clima forte/desfalques OL/defesa; Futebol escalação rodada/mata-mata incerto/desfalques-chave.
- Gate 3 — Informação crítica ausente: se informação crítica necessária não estiver disponível = PULAR; no máximo CONFIRMA 0.5u apenas se a informação ausente não for determinante.
- Gate 4 — Fontes: para IA local, aprove se não depende de fonte online; reprove se a tese exige confirmação externa que não foi fornecida no contexto.
- Gate 5 — Risco > benefício: se houver 2 ou mais riscos relevantes, PULAR.
- Gate 6 — Duplicidade/correlação: se houver outras picks do mesmo jogo e mesmo grupo de mercado, não confirme todas automaticamente. Compare e escolha a melhor ou recomende PULAR nas redundantes.

Formato OBRIGATÓRIO da resposta (use exatamente estes cabeçalhos em texto puro, sem markdown):

A) Mercado avaliado
Pick:
Linha e odd:
Tese da aposta:

B) Contexto da análise
Matchup e vantagem estrutural:
Tendências consistentes vs ruído:
Aderência ao mercado:
Sinais de alerta estatísticos:

C) Informações manuais consideradas
O que foi considerado:
Informações ausentes ou incertas:
Impacto prático:

D) Fatores qualitativos
Leitura provável do jogo:
Motivação/contexto competitivo:
Pontos que favorecem a tese:

E) Tese contra a entrada
Motivos concretos para PULAR:
Fragilidades técnicas/contextuais:
Informações ausentes que impedem confiança:

F) Riscos potenciais
Risco 1:
Risco 2:
Risco 3:
O que faria mudar a decisão:

G) Gates objetivos
gate_tecnico: aprovado/reprovado - motivo:
gate_risco: aprovado/reprovado - motivo:
gate_info_critica: aprovado/reprovado - motivo:
gate_fontes: aprovado/reprovado - motivo:
gate_duplicidade: aprovado/reprovado - motivo:
gate_risco_beneficio: aprovado/reprovado - motivo:

H) Decisão final
Decisão final: CONFIRMA | PULAR
Stake sugerida: 0.5u | 1.0u | 1.5u
Justificativa final em 3 a 6 linhas:
Condição de invalidação:`;

function parseDecisao(text: string): { decisao: string | null; stake: number | null } {
  const decisionMatch = text.match(/decis[aã]o(?:\s+final)?\s*:\s*(confirma|confirmar|pular|pass|aguardar not[ií]cia|confirma com cautela)/i);
  const slice = decisionMatch?.index != null ? text.slice(decisionMatch.index) : text;
  const decisionText = decisionMatch?.[1]?.toLowerCase() ?? "pular";
  const decisao: string | null = /\bconfirma|confirmar\b/.test(decisionText) ? "CONFIRMA" : "PULAR";
  const stakeMatch = slice.match(/stake[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);
  const stake = stakeMatch ? Number(stakeMatch[1].replace(",", ".")) : decisao === "PULAR" ? 0.5 : null;
  return { decisao, stake };
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

OUTRAS PICKS PENDENTES DO MESMO JOGO PARA GATE DE DUPLICIDADE/CORRELAÇÃO:
${correlacionadosTexto}

INSTRUÇÃO DE AUDITORIA:
Antes de sugerir CONFIRMA, procure motivos concretos para PULAR. Se a tese contra a entrada for relevante ou houver informação importante ausente, sugira PULAR. Não confirme apenas porque a entrada veio como EV+.
`;

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
        throw new Error("Créditos da IA esgotados. Adicione créditos no workspace para continuar.");
      }
      if (/429|rate/i.test(msg)) {
        throw new Error("Limite de requisições da IA atingido. Tente novamente em instantes.");
      }
      throw new Error(`Falha ao gerar análise: ${msg}`);
    }
  });
