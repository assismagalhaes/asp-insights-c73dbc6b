import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { AspValidatorAiResult } from "@/lib/asp-validator-ai.functions";
import {
  clampNumber,
  extractManualPrediction,
  normalizeConfidence,
  normalizeEvPercent,
  normalizeProbabilityPercent,
  parseJsonObject,
  readNumber,
  readString,
  readStringArray,
  round,
  sanitizeBlocks,
} from "@/lib/validator/core";
import { assertEvConsistency, calculateEvPercent } from "@/lib/validator/ev-math";
import { buildSystemPrompt } from "@/lib/validator/prompts";
import { routeValidator } from "@/lib/validator/sport-router";

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
    const { slimAspValidatorContext } = await import("@/lib/asp-validator-ai-slim");
    const gateway = createLovableAiGatewayProvider(key);
    const searches: string[] = [];
    const sources: Array<{ title: string; url: string }> = [];
    let scrapeCount = 0;

    const slim = slimAspValidatorContext(data.context);
    const route = routeValidator(data.context);
    const systemPrompt = buildSystemPrompt("online", route);
    const queryHint = buildResearchQueryHint(data.context);
    const prompt = `Contexto consolidado (esporte=${route.sport}, mercado=${route.marketDetected}; ordem: manual > structured_json > simulation_json > parecer IA anterior > pesquisa online). Use web_search/web_scrape de forma objetiva. Priorize fontes oficiais (MLB, ESPN, Baseball Savant, Baseball-Reference) e evite fontes sociais (Reddit, X, Instagram) como achado principal. Query sugerida: "${queryHint}". Retorne JSON valido.\n\n${JSON.stringify(slim)}`;


    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system: systemPrompt,
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
  const adjustedProbability =
    clampNumber(normalizeProbabilityPercent(readNumber(value.adjusted_probability)), 0, 100) ??
    manual.source_probability ??
    50;
  const offeredOdd = readNumber(value.offered_odd) ?? manual.offered_odd;
  const adjustedFairOdd = readNumber(value.adjusted_fair_odd) ?? (adjustedProbability > 0 ? round(100 / adjustedProbability) : 2);
  const adjustedEv =
    normalizeEvPercent(readNumber(value.adjusted_ev)) ??
    (offeredOdd ? round((offeredOdd * (adjustedProbability / 100) - 1) * 100) : null);
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
    source_probability: normalizeProbabilityPercent(readNumber(value.source_probability)) ?? manual.source_probability,
    source_fair_odd: readNumber(value.source_fair_odd) ?? manual.source_fair_odd,
    offered_odd: offeredOdd,
    source_ev: normalizeEvPercent(readNumber(value.source_ev)) ?? manual.source_ev,
    adjusted_probability: round(adjustedProbability),
    adjusted_fair_odd: round(adjustedFairOdd),
    adjusted_ev: adjustedEv,
    online_summary: onlineSummary,
    simulation_summary: readString(value.simulation_summary) || "Simulacao nao disponivel ou nao conclusiva.",
    favorable_blocks: sanitizeBlocks(readStringArray(value.favorable_blocks)),
    against_blocks: sanitizeBlocks(readStringArray(value.against_blocks)),
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

function buildAnalysisContext(context: Record<string, unknown>, sources: Array<{ title: string; url: string }>, searches: string[]): string {
  const usage = context.data_usage && typeof context.data_usage === "object" ? (context.data_usage as Record<string, unknown>) : {};
  const route = routeValidator(context);
  return [
    "ASP Validator - IA + Pesquisa",
    `Esporte detectado: ${route.sport} | Mercado detectado: ${route.market}`,
    `Usou OCR real: ${usage.used_ocr ? "sim" : "nao"}`,
    `Usou texto colado: ${usage.used_pasted_text ? "sim" : "nao"}`,
    `Usou JSON estruturado: ${usage.used_structured_json ? "sim" : "nao"}`,
    `Usou simulacao: ${usage.used_simulation ? "sim" : "nao"}`,
    `Buscas realizadas: ${searches.length}`,
    `Fontes consultadas: ${sources.length}`,
    "Regras: pesquisa online e complementar; ausencia de achados nao reprova sozinha; em duvida relevante, PULAR; proibido somar medias brutas (ex.: 11.8 + 12.6).",
  ].join("\n");
}
