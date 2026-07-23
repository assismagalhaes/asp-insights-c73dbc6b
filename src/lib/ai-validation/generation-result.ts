import { AiOperationalOutputSchema } from "./schema";
import type { AiOperationalOutput } from "./types";

export type AiGenerationParseStatus = "VALID" | "FAILED" | "LEGACY_ROLLBACK";

export type AiGenerationResult = {
  model_output: AiOperationalOutput | null;
  raw_model_text: string;
  parse_status: AiGenerationParseStatus;
  parse_error: string | null;
  error_code: string | null;
  latency_ms: number;
};

function formatSchemaIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
    .join("; ")
    .slice(0, 1_000);
}

export function parseStructuredAiOutput({
  output,
  rawModelText,
  latencyMs,
}: {
  output: unknown;
  rawModelText?: string;
  latencyMs: number;
}): AiGenerationResult {
  const parsed = AiOperationalOutputSchema.safeParse(output);
  if (!parsed.success) {
    return {
      model_output: null,
      raw_model_text: rawModelText?.slice(0, 50_000) ?? "",
      parse_status: "FAILED",
      parse_error: `Resposta incompatível com o contrato 1.1.0: ${formatSchemaIssues(parsed.error)}`,
      error_code: "SCHEMA_INVALID",
      latency_ms: latencyMs,
    };
  }

  if (parsed.data.sources.length || parsed.data.searches.length) {
    return {
      model_output: null,
      raw_model_text: rawModelText?.slice(0, 50_000) ?? "",
      parse_status: "FAILED",
      parse_error:
        "O modo IA Local retornou fontes ou buscas externas, em desacordo com o contrato operacional.",
      error_code: "LOCAL_EXTERNAL_TRACE_FORBIDDEN",
      latency_ms: latencyMs,
    };
  }

  return {
    model_output: parsed.data,
    raw_model_text: rawModelText?.trim() || JSON.stringify(parsed.data),
    parse_status: "VALID",
    parse_error: null,
    error_code: null,
    latency_ms: latencyMs,
  };
}

export function createLegacyRollbackResult({
  output,
  rawModelText,
  latencyMs,
}: {
  output: AiOperationalOutput;
  rawModelText: string;
  latencyMs: number;
}): AiGenerationResult {
  return {
    model_output: output,
    raw_model_text: rawModelText.slice(0, 50_000),
    parse_status: "LEGACY_ROLLBACK",
    parse_error: null,
    error_code: null,
    latency_ms: latencyMs,
  };
}

export function createAiGenerationFailure(error: unknown, latencyMs: number): AiGenerationResult {
  const message = error instanceof Error ? error.message : String(error ?? "");
  let errorCode = "PROVIDER_ERROR";
  let safeMessage =
    "O provider de IA não concluiu a saída estruturada. A recomendação foi convertida para PULAR.";

  if (/GOOGLE_GENERATIVE_AI_API_KEY|api.?key|authentication|unauthorized|401/i.test(message)) {
    errorCode = "PROVIDER_AUTH_ERROR";
    safeMessage =
      "A configuração da API Google está indisponível. A recomendação foi convertida para PULAR.";
  } else if (/429|rate.?limit|quota|resource.?exhausted/i.test(message)) {
    errorCode = "PROVIDER_RATE_LIMIT";
    safeMessage =
      "A cota ou o limite da API Google foi atingido. A recomendação foi convertida para PULAR.";
  } else if (/402|payment|billing|credits/i.test(message)) {
    errorCode = "PROVIDER_BILLING_ERROR";
    safeMessage =
      "A API Google recusou a geração por cobrança ou créditos. A recomendação foi convertida para PULAR.";
  } else if (/timeout|timed.?out|abort/i.test(message)) {
    errorCode = "PROVIDER_TIMEOUT";
    safeMessage = "A geração estruturada excedeu o tempo limite e foi convertida para PULAR.";
  } else if (/NoObjectGenerated|schema|parse|json|validation|structured output/i.test(message)) {
    errorCode = "SCHEMA_GENERATION_FAILED";
    safeMessage =
      "O Gemini não produziu uma resposta compatível com o contrato 1.1.0. A recomendação foi convertida para PULAR.";
  }

  return {
    model_output: null,
    raw_model_text: "",
    parse_status: "FAILED",
    parse_error: safeMessage,
    error_code: errorCode,
    latency_ms: latencyMs,
  };
}
