import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import { generateText } from "ai";
import { z } from "zod";
import {
  clampNumber,
  extractManualPrediction,
  hasSimulationData,
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
import { buildSystemPrompt } from "@/lib/validator/prompts";
import { routeValidator } from "@/lib/validator/sport-router";

const ValidatorAiInputSchema = z.object({
  context: z.record(z.string(), z.unknown()),
});

export type AspValidatorAiResult = {
  decision: "CONFIRMAR" | "PULAR";
  confidence: "Baixo" | "Medio" | "Alto";
  source_probability: number | null;
  source_fair_odd: number | null;
  offered_odd: number | null;
  source_ev: number | null;
  adjusted_probability: number;
  adjusted_fair_odd: number;
  adjusted_ev: number | null;
  simulation_summary: string;
  favorable_blocks: string[];
  against_blocks: string[];
  alerts: string[];
  final_analysis: string;
  analysis_context: string;
};

export const validateAspValidatorWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ValidatorAiInputSchema.parse(input))
  .handler(async ({ data }): Promise<AspValidatorAiResult> => {
    const fallback = buildFallbackResult(data.context, "Falha ao interpretar resposta da IA.");
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      return buildFallbackResult(data.context, "LOVABLE_API_KEY nao configurada no servidor.");
    }

    try {
      const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
      const { slimAspValidatorContext } = await import("@/lib/asp-validator-ai-slim");
      const gateway = createLovableAiGatewayProvider(key);
      const slim = slimAspValidatorContext(data.context);
      const route = routeValidator(data.context);
      const systemPrompt = buildSystemPrompt("offline", route);
      const { text } = await generateText({
        model: gateway("google/gemini-3.1-flash-lite"),
        system: systemPrompt,
        prompt: `Contexto consolidado (esporte=${route.sport}, mercado=${route.market}; priorize manual > structured_json > simulation_json). Retorne JSON valido.\n\n${JSON.stringify(slim)}`,
      });
      const parsed = parseJsonObject(text);
      if (!parsed) return fallback;
      return normalizeAiResult(parsed, data.context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida ao chamar IA.";
      return buildFallbackResult(data.context, message);
    }
  });

function normalizeAiResult(value: Record<string, unknown>, context: Record<string, unknown>): AspValidatorAiResult {
  const manual = extractManualPrediction(context);
  const adjustedProbability =
    clampNumber(normalizeProbabilityPercent(readNumber(value.adjusted_probability)), 0, 100) ??
    manual.source_probability ??
    50;
  const adjustedFairOdd = readNumber(value.adjusted_fair_odd) ?? (adjustedProbability > 0 ? round(100 / adjustedProbability) : 2);
  const offeredOdd = readNumber(value.offered_odd) ?? manual.offered_odd;
  const adjustedEv =
    normalizeEvPercent(readNumber(value.adjusted_ev)) ??
    (offeredOdd && adjustedProbability ? round((offeredOdd * (adjustedProbability / 100) - 1) * 100) : null);
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
    simulation_summary:
      readString(value.simulation_summary) ||
      (hasSimulationData(context)
        ? "Simulacao disponivel mas nao resumida pela IA."
        : "Simulacao nao disponivel ou nao conclusiva."),
    favorable_blocks: sanitizeBlocks(readStringArray(value.favorable_blocks)),
    against_blocks: sanitizeBlocks(readStringArray(value.against_blocks)),
    alerts: readStringArray(value.alerts),
    final_analysis: readString(value.final_analysis) || "A IA nao forneceu parecer detalhado. Por seguranca, revisar manualmente.",
    analysis_context: buildAnalysisContext(context, true),
  };
}

function buildFallbackResult(context: Record<string, unknown>, alert: string): AspValidatorAiResult {
  const manual = extractManualPrediction(context);
  const probability = manual.source_probability ?? 50;
  return {
    decision: "PULAR",
    confidence: "Baixo",
    source_probability: manual.source_probability,
    source_fair_odd: manual.source_fair_odd,
    offered_odd: manual.offered_odd,
    source_ev: manual.source_ev,
    adjusted_probability: probability,
    adjusted_fair_odd: probability > 0 ? round(100 / probability) : 2,
    adjusted_ev: manual.offered_odd ? round((manual.offered_odd * (probability / 100) - 1) * 100) : null,
    simulation_summary: "Fallback seguro aplicado; simulacao nao foi suficiente para decisao automatica.",
    favorable_blocks: [],
    against_blocks: ["Validacao automatica inconclusiva."],
    alerts: [alert, "Falha ao interpretar resposta da IA"],
    final_analysis: "Por protecao de banca, a validacao foi marcada como PULAR ate nova analise manual.",
    analysis_context: buildAnalysisContext(context, false),
  };
}

function buildAnalysisContext(context: Record<string, unknown>, aiParsed: boolean): string {
  const usage = context.data_usage && typeof context.data_usage === "object" ? (context.data_usage as Record<string, unknown>) : {};
  const route = routeValidator(context);
  return [
    "ASP Validator - Validacao IA consolidada",
    `Esporte detectado: ${route.sport} | Mercado detectado: ${route.market}`,
    `Resposta IA interpretada: ${aiParsed ? "sim" : "nao"}`,
    `Usou OCR: ${usage.used_ocr ? "sim" : "nao"}`,
    `Usou JSON estruturado: ${usage.used_structured_json ? "sim" : "nao"}`,
    `Usou simulacao: ${usage.used_simulation ? "sim" : "nao"}`,
    "Regras: previsao externa e apenas ponto de partida; EV+/55% nao sao gatilhos obrigatorios; em duvida relevante, PULAR; foco em protecao de banca.",
  ].join("\n");
}
