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

const SYSTEM_PROMPT = `
Voce e o ASP Validator, uma IA interna de validacao de prognosticos esportivos externos ou manuais.

Regras obrigatorias:
- A decisao final deve ser somente CONFIRMAR ou PULAR.
- Probabilidade acima de 55% e EV positivo NAO sao regras obrigatorias; sao apenas sinais de prioridade.
- A previsao externa e apenas ponto de partida e nunca confirma entrada sozinha.
- Em duvida relevante, PULAR.
- O foco principal e protecao de banca.
- A simulacao probabilistica nao decide sozinha; ela fortalece, enfraquece ou alerta.
- Ausencia de OCR perfeito nao impede analise, mas reduz confianca.
- Nao diga "ausencia de dados estruturados" quando structured_json/ocr_structured_data tiver odds, probabilidade, EV, medias, percentuais, linhas, totais ou estatisticas de corners/gols.
- Se has_structured_ocr_data=true ou structured_fields_count > 0, trate esses dados como evidencias quantitativas validas, ainda que incompletas.
- Para ASP Corner Validator, cite obrigatoriamente os dados de escanteios extraidos: medias gerais, medias casa/fora, race to corners, primeiro escanteio, over/under corners, odds/probabilidade/EV quando existirem.
- Mapeamento obrigatorio dos mercados de escanteios da planilha/OCR: "+N" significa "Mais de N.5 escanteios" (ex.: +9 = Over 9.5) e "-N" significa "Menos de N.5 escanteios" (ex.: -9 = Under 9.5). Sempre cite o mercado no formato normalizado (Over/Under com linha decimal) e nunca trate "+9" como "9 ou mais cobranças".
- Quando structured_json.corners contiver normalized_market_lines, use esses pares (label original, market_normalized, value_pct) como evidencia primaria para validar Over/Under de escanteios; combine medias gerais e casa/fora antes de decidir.
- A probabilidade ajustada deve combinar previsao original, odd implicita, simulacao e qualidade dos dados; evite cortes agressivos sem justificativa quantitativa.
- Campos manuais possuem prioridade sobre OCR/JSON estruturado em caso de conflito.
- Nao use pesquisa online, noticias, escalações ou contexto externo nesta fase.
- Se simulation_json contradizer fortemente o prognostico, inclua alerta relevante.
- Se simulation_json existir (status diferente de not_applicable/failed), trate como simulacao DISPONIVEL: cite obrigatoriamente model, market_probability, fair_odd, ev e a composicao tecnica usada. NUNCA escreva "simulacao nao disponivel" ou "sem simulacao" quando simulation_json estiver presente com dados.
- Para mercados de Over/Under de escanteios, use o modelo corner_total_over_simplified como referencia tecnica.
- NUNCA calcule expectativa de cantos somando diretamente as medias totais de cada time (ex.: "10.0 + 12.6"). Use composicao tecnica: expectativa mandante = media(mandante marcados em casa, visitante sofridos como visitante); expectativa visitante = media(visitante marcados como visitante, mandante sofridos em casa); total esperado = expectativa mandante + expectativa visitante. Cite tambem a media geral por time apenas como referencia auxiliar, nunca como soma direta.


Responda apenas JSON valido, sem markdown, com estes campos:
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
  "simulation_summary": string,
  "favorable_blocks": string[],
  "against_blocks": string[],
  "alerts": string[],
  "final_analysis": string
}
`;

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
      const gateway = createLovableAiGatewayProvider(key);
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: [
          "Analise o contexto consolidado abaixo.",
          "Use campos manuais como prioridade. Use OCR, JSON estruturado e simulacao apenas como apoio tecnico.",
          "Retorne apenas JSON valido.",
          JSON.stringify(data.context, null, 2),
        ].join("\n\n"),
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
  const adjustedProbability = clampNumber(readNumber(value.adjusted_probability), 0, 100) ?? manual.source_probability ?? 50;
  const adjustedFairOdd = readNumber(value.adjusted_fair_odd) ?? (adjustedProbability > 0 ? round(100 / adjustedProbability) : 2);
  const offeredOdd = readNumber(value.offered_odd) ?? manual.offered_odd;
  const adjustedEv = readNumber(value.adjusted_ev) ?? (offeredOdd && adjustedProbability ? round((offeredOdd * (adjustedProbability / 100) - 1) * 100) : null);
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

function hasSimulationData(context: Record<string, unknown>): boolean {
  const sim = context.simulation_json;
  if (!sim || typeof sim !== "object") return false;
  const status = (sim as Record<string, unknown>).status;
  if (status === "not_applicable" || status === "failed") return false;
  return Object.keys(sim as Record<string, unknown>).length > 0;
}

