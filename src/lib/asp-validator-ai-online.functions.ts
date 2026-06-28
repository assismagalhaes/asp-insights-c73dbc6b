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

const SYSTEM_PROMPT = `Voce e o ASP Validator com IA + Pesquisa. Valida prognosticos usando dados internos + pesquisa online complementar. Responda apenas JSON valido, sem markdown.

Regras (obrigatorias):
1. Decisao: somente CONFIRMAR ou PULAR. Em duvida relevante, PULAR. Proteja a banca.
2. Previsao externa nao confirma sozinha; manual > structured_json > simulacao > online.
3. Guardrail: CONFIRMAR somente se adjusted_ev >= 3 (em percentual; 3 representa 3%, nunca 0.03) e adjusted_fair_odd < offered_odd. Caso contrario PULAR. IMPORTANTE: adjusted_ev e source_ev SEMPRE em percentual (ex.: 5 = 5%, -2 = -2%). NUNCA enviar fracao decimal (0.05).
4. Pesquisa online e complementar; ausencia de achados nao reprova sozinha. Use online_summary="Verificacao online sem achados relevantes..." quando nao houver fatos uteis. Falta de online so pesa contra quando mercado depende fortemente de escalacao/desfalque/motivacao/rotacao/calendario.
5. Se simulation_json existir (status != not_applicable/failed), cite model, market_probability, fair_odd, ev e expected_total. Proibido "simulacao nao disponivel".
6. Se structured_json tiver blocos populados, proibido "ausencia de dados estruturados".
7. Multi-mercado: respeite structured_json.market_type. Nao aplique analise de escanteios fora de market_type=corners.
8. Mercados de escanteios: "+N"=Over N.5, "-N"=Under N.5. Use normalized_market_lines como evidencia primaria.
9. PROIBIDO somar medias totais brutas (ex.: "11.8+12.6=24.4"). Use a composicao tecnica da simulacao: expected_home = media(mandante marcados casa, visitante sofridos fora); expected_away = media(visitante marcados fora, mandante sofridos casa); expected_total = soma. Cite a frequencia Over X.5 quando existir.
10. Diferencie fatos encontrados, nao-encontrados e inferencias.

Use as ferramentas web_search/web_scrape para procurar: classificacao, momento, necessidade de resultado, rotacao, calendario, desfalques, importancia, mando, movimento de odds.

Formato de resposta JSON:
{"decision":"CONFIRMAR|PULAR","confidence":"Baixo|Medio|Alto","source_probability":number|null,"source_fair_odd":number|null,"offered_odd":number|null,"source_ev":number|null,"adjusted_probability":number,"adjusted_fair_odd":number,"adjusted_ev":number|null,"online_summary":string,"simulation_summary":string,"favorable_blocks":string[],"against_blocks":string[],"alerts":string[],"final_analysis":string,"relevant_findings":string[],"no_relevant_findings":string[],"contextual_alerts":string[]}`;

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
    const prompt = `Contexto consolidado (ordem: manual > structured_json > simulation_json > parecer IA anterior > pesquisa online). Use web_search/web_scrape de forma objetiva. Retorne JSON valido.\n\n${JSON.stringify(slim)}`;

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
  const adjustedProbability = clampNumber(normalizeProbabilityPercent(readNumber(value.adjusted_probability)), 0, 100) ?? manual.source_probability ?? 50;
  const offeredOdd = readNumber(value.offered_odd) ?? manual.offered_odd;
  const adjustedFairOdd = readNumber(value.adjusted_fair_odd) ?? (adjustedProbability > 0 ? round(100 / adjustedProbability) : 2);
  const adjustedEv = normalizeEvPercent(readNumber(value.adjusted_ev)) ?? (offeredOdd ? round((offeredOdd * (adjustedProbability / 100) - 1) * 100) : null);
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
    `Usou OCR real: ${usage.used_ocr ? "sim" : "nao"}`,
    `Usou texto colado: ${usage.used_pasted_text ? "sim" : "nao"}`,
    `Usou JSON estruturado: ${usage.used_structured_json ? "sim" : "nao"}`,
    `Usou simulacao: ${usage.used_simulation ? "sim" : "nao"}`,
    `Buscas realizadas: ${searches.length}`,
    `Fontes consultadas: ${sources.length}`,
    "Regras: pesquisa online e complementar; ausencia de achados nao reprova sozinha; em duvida relevante, PULAR; proibido somar medias brutas (ex.: 11.8 + 12.6).",
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

// Normaliza EV para percentual. Se a IA enviar fracao decimal (|x| < 1 e != 0),
// converte para percentual multiplicando por 100. Caso ja venha em percentual, mantem.
function normalizeEvPercent(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value !== 0 && Math.abs(value) < 1) return round(value * 100);
  return round(value);
}
