import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";
import { generateText } from "ai";
import { z } from "zod";

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

const SYSTEM_PROMPT = `Voce e o ASP Validator (validacao IA offline de prognosticos esportivos). Responda apenas JSON valido, sem markdown.

Regras (todas obrigatorias):
1. Decisao: somente CONFIRMAR ou PULAR. Em duvida relevante, PULAR. Foco em protecao de banca.
2. Previsao externa nao confirma sozinha; campos manuais > structured_json > simulacao.
3. Guardrail: CONFIRMAR somente se adjusted_ev >= 3 (em percentual; 3 = 3%, nunca 0.03) e adjusted_fair_odd < offered_odd. Caso contrario PULAR. adjusted_ev e source_ev SEMPRE em percentual (ex.: 5 = 5%, -2 = -2%). NUNCA enviar fracao decimal (0.05).
4. Mercado no-vig e ANCORA prudencial, NAO veto automatico. Se probabilidade ASP divergir muito do no-vig (>=8 p.p.), registre risk_flag "market_divergence" nos alerts. Nao forcar PULAR apenas por divergencia. PULAR automatico somente se (a) adjusted_ev < 3% E (b) houver conflito contextual relevante OU critical_flags fortes OU ausencia de suporte tecnico suficiente.
5. Redacao de EV negativo: NUNCA escrever "odd ofertada ACIMA da odd justa". Correto: "A probabilidade ajustada de X% implica odd justa Y. Como a odd ofertada e Z, ela esta ABAIXO da odd justa, resultando em EV ajustado negativo."
6. favorable_blocks e against_blocks devem usar frases humanas curtas. PROIBIDO usar tokens/campos brutos como source_ev, adjusted_ev, market_no_vig_probability, source_probability, online_results. Ex.: "EV original positivo no Screener", "Probabilidade ASP acima da linha de mercado", "Mercado no-vig contradiz a projecao", "EV ajustado negativo".
7. Se simulation_json existir (status != not_applicable/failed), cite obrigatoriamente model, market_probability, fair_odd, ev e expected_total. Proibido escrever "simulacao nao disponivel".
8. Se structured_json tiver qualquer bloco populado, proibido dizer "ausencia de dados estruturados".
9. Multi-mercado: respeite structured_json.market_type. NUNCA aplique analise de escanteios fora de market_type=corners.
10. Mercados de escanteios: "+N"=Over N.5, "-N"=Under N.5. Use normalized_market_lines como evidencia primaria.
11. PROIBIDO somar medias totais brutas dos times. Use composicao tecnica: expected_home = media(mandante marcados em casa, visitante sofridos fora); expected_away = media(visitante marcados fora, mandante sofridos em casa); expected_total = expected_home + expected_away.
12. Over/Under (baseball/futebol totals): NAO usar "time selecionado" nem "recorde do time selecionado". Usar "tese do Over/Under", "perfil de runs", "starters favorecem Over/Under", "ataques favorecem Over/Under", "bullpen/parque/clima favorecem Over/Under".
13. Sem pesquisa online nesta fase.

Formato de resposta JSON:
{"decision":"CONFIRMAR|PULAR","confidence":"Baixo|Medio|Alto","source_probability":number|null,"source_fair_odd":number|null,"offered_odd":number|null,"source_ev":number|null,"adjusted_probability":number,"adjusted_fair_odd":number,"adjusted_ev":number|null,"simulation_summary":string,"favorable_blocks":string[],"against_blocks":string[],"alerts":string[],"final_analysis":string}`;

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
      const { text } = await generateText({
        model: gateway("google/gemini-3.1-flash-lite"),
        system: SYSTEM_PROMPT,
        prompt: `Contexto consolidado (priorize manual > structured_json > simulation_json). Retorne JSON valido.\n\n${JSON.stringify(slim)}`,
      });
      const parsed = parseJsonObject(text);
      if (!parsed) return fallback;
      return normalizeAiResult(parsed, data.context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida ao chamar IA.";
      return buildFallbackResult(data.context, message);
    }
  });

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

function normalizeAiResult(value: Record<string, unknown>, context: Record<string, unknown>): AspValidatorAiResult {
  const manual = extractManualPrediction(context);
  const adjustedProbability = clampNumber(normalizeProbabilityPercent(readNumber(value.adjusted_probability)), 0, 100) ?? manual.source_probability ?? 50;
  const adjustedFairOdd = readNumber(value.adjusted_fair_odd) ?? (adjustedProbability > 0 ? round(100 / adjustedProbability) : 2);
  const offeredOdd = readNumber(value.offered_odd) ?? manual.offered_odd;
  const adjustedEv = normalizeEvPercent(readNumber(value.adjusted_ev)) ?? (offeredOdd && adjustedProbability ? round((offeredOdd * (adjustedProbability / 100) - 1) * 100) : null);
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
    simulation_summary: readString(value.simulation_summary) || (hasSimulationData(context) ? "Simulacao disponivel mas nao resumida pela IA." : "Simulacao nao disponivel ou nao conclusiva."),
    favorable_blocks: readStringArray(value.favorable_blocks),
    against_blocks: readStringArray(value.against_blocks),
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

function extractManualPrediction(context: Record<string, unknown>) {
  const prediction = context.prediction && typeof context.prediction === "object" ? (context.prediction as Record<string, unknown>) : {};
  return {
    source_probability: readNumber(prediction.source_probability),
    source_fair_odd: readNumber(prediction.source_fair_odd),
    offered_odd: readNumber(prediction.offered_odd),
    source_ev: readNumber(prediction.source_ev),
  };
}

function buildAnalysisContext(context: Record<string, unknown>, aiParsed: boolean): string {
  const usage = context.data_usage && typeof context.data_usage === "object" ? (context.data_usage as Record<string, unknown>) : {};
  return [
    "ASP Validator - Validacao IA consolidada",
    `Resposta IA interpretada: ${aiParsed ? "sim" : "nao"}`,
    `Usou OCR: ${usage.used_ocr ? "sim" : "nao"}`,
    `Usou JSON estruturado: ${usage.used_structured_json ? "sim" : "nao"}`,
    `Usou simulacao: ${usage.used_simulation ? "sim" : "nao"}`,
    "Regras: previsao externa e apenas ponto de partida; EV+/55% nao sao gatilhos obrigatorios; em duvida relevante, PULAR; foco em protecao de banca.",
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

// Normaliza probabilidade para percentual (0-100). Se a IA enviar fracao
// decimal (0 < x <= 1), converte multiplicando por 100. Caso contrario mantem.
function normalizeProbabilityPercent(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value > 0 && value <= 1) return round(value * 100);
  return round(value);
}

function hasSimulationData(context: Record<string, unknown>): boolean {
  const sim = context.simulation_json;
  if (!sim || typeof sim !== "object") return false;
  const status = (sim as Record<string, unknown>).status;
  if (status === "not_applicable" || status === "failed") return false;
  return Object.keys(sim as Record<string, unknown>).length > 0;
}

