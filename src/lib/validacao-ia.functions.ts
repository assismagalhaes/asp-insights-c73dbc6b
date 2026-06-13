import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";

export const PROMPT_VERSAO = "validacao-critica-v1";

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
Você é um analista sênior de apostas esportivas. As entradas já foram previamente filtradas como EV+. Não recalcule EV e não otimize linha com base em percentual. Sua função é validar ou recusar a entrada com base em coerência técnica, contexto informado manualmente e riscos que possam quebrar a tese.

Regras:
- Não reavaliar se é EV+.
- Não buscar dados online.
- Não inventar informações externas.
- Analisar apenas os dados fornecidos.
- Avaliar coerência técnica, matchup, forma, projeções, linha, odd, risco e contexto colado pelo usuário.
- Se houver bom argumento, mas risco estrutural relevante, a decisão padrão deve ser PASS.
- Stake sugerida:
  - 0.5u = baixa confiança, cenário frágil ou dependente de informação ausente.
  - 1.0u = confiança moderada, tese sólida com riscos normais.
  - 1.5u = alta confiança, tese forte, múltiplas confirmações e poucos pontos de falha.

Formato OBRIGATÓRIO da resposta (use exatamente estes cabeçalhos em texto puro, sem markdown):

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

D) Fatores qualitativos
Leitura provável do jogo:
Motivação/contexto competitivo:
Pontos que favorecem a tese:

E) Riscos potenciais
Risco 1:
Risco 2:
Risco 3:
O que faria mudar a decisão:

F) Decisão final
Decisão: CONFIRMA | CONFIRMA COM CAUTELA | PASS | AGUARDAR NOTÍCIA
Stake sugerida: 0.5u | 1.0u | 1.5u
Justificativa final em 3 a 6 linhas:
Condição de invalidação:`;

function parseDecisao(text: string): { decisao: string | null; stake: number | null } {
  const lower = text.toLowerCase();
  const fIdx = lower.lastIndexOf("decisão:");
  const slice = fIdx >= 0 ? text.slice(fIdx) : text;
  const s = slice.toLowerCase();
  let decisao: string | null = null;
  if (/\baguardar notícia|aguardar noticia\b/.test(s)) decisao = "AGUARDAR_NOTICIA";
  else if (/\bconfirma com cautela\b/.test(s)) decisao = "CONFIRMA_CAUTELA";
  else if (/\bpass\b/.test(s)) decisao = "PASS";
  else if (/\bconfirma\b/.test(s)) decisao = "CONFIRMA";
  const stakeMatch = slice.match(/stake[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);
  const stake = stakeMatch ? Number(stakeMatch[1].replace(",", ".")) : null;
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

DADOS TÉCNICOS DO MODELO:
${data.dados_tecnicos?.trim() || "(nenhum dado técnico fornecido — trate como informação ausente)"}

CONTEXTO ADICIONAL INFORMADO PELO USUÁRIO:
${data.contexto_adicional?.trim() || "(nenhum contexto adicional informado — trate como informação ausente)"}
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
