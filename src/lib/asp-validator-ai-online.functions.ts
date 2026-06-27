import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { AspValidatorAiResult } from "@/lib/asp-validator-ai.functions";

const ValidatorOnlineInputSchema = z.object({
  context: z.record(z.string(), z.unknown()),
});

export type AspValidatorOnlineAiResult = AspValidatorAiResult & {
  online_summary: string;
  online_context_json: {
    status: "completed" | "failed";
    online_summary: string;
    relevant_findings: string[];
    no_relevant_findings: string[];
    contextual_alerts: string[];
    sources: Array<{ title: string; url: string }>;
    searches: string[];
    error?: string;
  };
};

const MAX_SEARCHES = 5;
const MAX_SCRAPES = 3;

const SYSTEM_PROMPT = `
Voce e o ASP Validator com IA + Pesquisa. Sua funcao e validar prognosticos externos/manuais usando dados internos e pesquisa online complementar.

Regras obrigatorias:
- A decisao final deve ser somente CONFIRMAR ou PULAR.
- Probabilidade acima de 55% e EV positivo sao sinais de prioridade, nao regras obrigatorias.
- A previsao externa nao confirma sozinha.
- Em duvida relevante, PULAR.
- Priorize protecao de banca.
- A simulacao vem antes do contexto online e nao decide sozinha.
- A pesquisa online e camada complementar, nao regra obrigatoria.
- Ausencia de informacao online relevante deve gerar: "Verificacao online sem achados relevantes. Nao ha noticia ou contexto externo suficiente para alterar a analise."
- Falta de dados online so pesa contra quando o mercado depende fortemente de escalacoes, desfalques, motivacao, rotacao, jogo sem interesse, treinador novo, calendario apertado ou noticia relevante nao confirmada.
- Priorize campos manuais em caso de conflito com OCR/JSON.
- Diferencie fatos encontrados, informacoes nao encontradas e inferencias.

Busque quando possivel:
classificacao atualizada, momento dos times, necessidade de resultado, risco de rotacao, calendario recente/proximo, desfalques, noticias relevantes, mando, importancia da partida e movimento de odds.

Retorne apenas JSON valido, sem markdown, com estes campos:
{
  "decision": "CONFIRMAR" | "PULAR",
  "confidence": "Baixo" | "Medio" | "Alto",
  "source_probability": number|null,
  "source_fair_odd": number|null,
  "offered_odd": number|null,
  "source_ev": number|null,
  "adjusted_probability": number,
  "adjusted_fair_odd": number,
  "adjusted_ev": number|null,
  "online_summary": string,
  "simulation_summary": string,
  "favorable_blocks": string[],
  "against_blocks": string[],
  "alerts": string[],
  "final_analysis": string,
  "relevant_findings": string[],
  "no_relevant_findings": string[],
  "contextual_alerts": string[]
}
`;

export const validateAspValidatorWithOnlineAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ValidatorOnlineInputSchema.parse(input))
  .handler(async ({ data }): Promise<AspValidatorOnlineAiResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY nao configurada no servidor.");
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error("Firecrawl nao esta conectado. Conecte-o em Conectores para usar IA + Pesquisa.");
    }

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const { firecrawlSearch, firecrawlScrape } = await import("@/lib/firecrawl.server");
    const gateway = createLovableAiGatewayProvider(key);
    const searches: string[] = [];
    const sources: Array<{ title: string; url: string }> = [];
    let scrapeCount = 0;

    const prompt = [
      "Analise o contexto consolidado abaixo.",
      "A ordem de leitura deve ser: campos manuais, JSON estruturado/OCR, simulacao probabilistica, parecer IA anterior e finalmente pesquisa online.",
      "Use as ferramentas online de forma objetiva para procurar somente fatores externos relevantes.",
      "Retorne apenas JSON valido.",
      JSON.stringify(data.context, null, 2),
    ].join("\n\n");

    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system: SYSTEM_PROMPT,
      prompt,
      stopWhen: stepCountIs(35),
      tools: {
        web_search: tool({
          description: "Busca noticias/contextos online relevantes para validar o prognostico.",
          inputSchema: z.object({
            query: z.string(),
            recency: z.enum(["day", "week", "month"]).optional(),
          }),
          execute: async ({ query, recency }) => {
            if (searches.length >= MAX_SEARCHES) {
              return [{ url: "", title: "Limite de buscas atingido", snippet: "Continue com as fontes ja encontradas." }];
            }
            searches.push(query);
            const results = await firecrawlSearch(query, { limit: 5, recency });
            for (const result of results) {
              if (result.url && !sources.some((source) => source.url === result.url)) {
                sources.push({ title: result.title || result.url, url: result.url });
              }
            }
            return results.map((result) => ({
              url: result.url,
              title: result.title,
              snippet: result.description?.slice(0, 300) ?? "",
            }));
          },
        }),
        web_scrape: tool({
          description: "Le o conteudo principal de uma URL especifica.",
          inputSchema: z.object({ url: z.string().url() }),
          execute: async ({ url }) => {
            if (scrapeCount >= MAX_SCRAPES) {
              return { url, title: "Limite de paginas aprofundadas atingido", markdown: "Use as fontes ja consultadas." };
            }
            scrapeCount += 1;
            const scraped = await firecrawlScrape(url);
            if (!sources.some((source) => source.url === url)) {
              sources.push({ title: scraped.title || url, url });
            }
            return { url, title: scraped.title, markdown: scraped.markdown };
          },
        }),
      },
    });

    const parsed = parseJsonObject(text);
    if (!parsed) throw new Error("IA + Pesquisa nao retornou JSON valido.");
    return normalizeOnlineResult(parsed, data.context, sources, searches);
  });

function normalizeOnlineResult(
  value: Record<string, unknown>,
  context: Record<string, unknown>,
  sources: Array<{ title: string; url: string }>,
  searches: string[],
): AspValidatorOnlineAiResult {
  const manual = extractManualPrediction(context);
  const adjustedProbability = clampNumber(readNumber(value.adjusted_probability), 0, 100) ?? manual.source_probability ?? 50;
  const offeredOdd = readNumber(value.offered_odd) ?? manual.offered_odd;
  const adjustedFairOdd = readNumber(value.adjusted_fair_odd) ?? (adjustedProbability > 0 ? round(100 / adjustedProbability) : 2);
  const adjustedEv = readNumber(value.adjusted_ev) ?? (offeredOdd ? round((offeredOdd * (adjustedProbability / 100) - 1) * 100) : null);
  const onlineSummary =
    readString(value.online_summary) ||
    "Verificacao online sem achados relevantes. Nao ha noticia ou contexto externo suficiente para alterar a analise.";
  const relevantFindings = readStringArray(value.relevant_findings);
  const noRelevantFindings = readStringArray(value.no_relevant_findings);
  const contextualAlerts = readStringArray(value.contextual_alerts);
  const alerts = [...readStringArray(value.alerts), ...contextualAlerts];
  return {
    decision: value.decision === "CONFIRMAR" ? "CONFIRMAR" : "PULAR",
    confidence: normalizeConfidence(value.confidence),
    source_probability: readNumber(value.source_probability) ?? manual.source_probability,
    source_fair_odd: readNumber(value.source_fair_odd) ?? manual.source_fair_odd,
    offered_odd: offeredOdd,
    source_ev: readNumber(value.source_ev) ?? manual.source_ev,
    adjusted_probability: round(adjustedProbability),
    adjusted_fair_odd: round(adjustedFairOdd),
    adjusted_ev: adjustedEv,
    online_summary: onlineSummary,
    simulation_summary: readString(value.simulation_summary) || "Simulacao nao disponivel ou nao conclusiva.",
    favorable_blocks: readStringArray(value.favorable_blocks),
    against_blocks: readStringArray(value.against_blocks),
    alerts,
    final_analysis: readString(value.final_analysis) || "IA + Pesquisa nao forneceu parecer detalhado.",
    analysis_context: buildAnalysisContext(context, sources, searches),
    online_context_json: {
      status: "completed",
      online_summary: onlineSummary,
      relevant_findings: relevantFindings,
      no_relevant_findings: noRelevantFindings.length
        ? noRelevantFindings
        : relevantFindings.length
          ? []
          : ["Verificacao online sem achados relevantes. Nao ha noticia ou contexto externo suficiente para alterar a analise."],
      contextual_alerts: contextualAlerts,
      sources,
      searches,
    },
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractManualPrediction(context: Record<string, unknown>) {
  const prediction = context.prediction && typeof context.prediction === "object" ? (context.prediction as Record<string, unknown>) : {};
  return {
    source_probability: readNumber(prediction.source_probability),
    source_fair_odd: readNumber(prediction.source_fair_odd),
    offered_odd: readNumber(prediction.offered_odd),
    source_ev: readNumber(prediction.source_ev),
  };
}

function buildAnalysisContext(context: Record<string, unknown>, sources: Array<{ title: string; url: string }>, searches: string[]): string {
  const usage = context.data_usage && typeof context.data_usage === "object" ? (context.data_usage as Record<string, unknown>) : {};
  return [
    "ASP Validator - IA + Pesquisa",
    `Usou OCR: ${usage.used_ocr ? "sim" : "nao"}`,
    `Usou JSON estruturado: ${usage.used_structured_json ? "sim" : "nao"}`,
    `Usou simulacao: ${usage.used_simulation ? "sim" : "nao"}`,
    `Buscas realizadas: ${searches.length}`,
    `Fontes consultadas: ${sources.length}`,
    "Regras: pesquisa online e complementar; ausencia de achados nao reprova sozinha; em duvida relevante, PULAR.",
  ].join("\n");
}

function normalizeConfidence(value: unknown): "Baixo" | "Medio" | "Alto" {
  const text = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (text.includes("alto")) return "Alto";
  if (text.includes("medio") || text.includes("moderado")) return "Medio";
  return "Baixo";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").replace(",", ".").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function clampNumber(value: number | null, min: number, max: number): number | null {
  return value === null ? null : Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
