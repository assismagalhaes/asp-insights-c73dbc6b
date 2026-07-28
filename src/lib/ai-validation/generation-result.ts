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

export type AiGenerationFailureContext = {
  phase?:
    | "CONFIGURATION"
    | "INITIAL_GENERATION"
    | "PRELIMINARY_SYNTHESIS"
    | "ONLINE_RESEARCH"
    | "FINAL_SYNTHESIS"
    | "REPAIR_GENERATION";
  promptCharacters?: number;
};

export type AiRepairFailureStage = "REQUEST" | "PARSE";

export function buildStructuredRepairPrompt({
  operationalContext,
  previousOutput,
  researchContext,
}: {
  operationalContext: string;
  previousOutput: string;
  researchContext?: string;
}): string {
  const sanitizedPreviousOutput = previousOutput.trim() || "(EMPTY_INITIAL_OUTPUT)";
  const researchSection = researchContext?.trim()
    ? `\n\nPESQUISAS E FONTES JÁ COLETADAS:\n${researchContext.trim().slice(0, 4_000)}`
    : "";

  return `REPARO CONTROLADO ÚNICO:
Converta a saída anterior para o contrato JSON do system prompt. Corrija apenas
estrutura, tipos e enums; preserve a análise e os dados operacionais. Retorne
somente JSON, sem markdown ou comentários. Não refaça pesquisas.
Normalize decision estritamente assim: CONFIRMAR, CONFIRMA VALIDADO ou
CONFIRMAR VALIDADO -> CONFIRMA; PULAR VALIDADO -> PULAR. Não crie outro enum.

CONTEXTO OPERACIONAL MÍNIMO:
${operationalContext.trim().slice(0, 6_000)}${researchSection}

SAÍDA ANTERIOR A CORRIGIR:
${sanitizedPreviousOutput.slice(0, 16_000)}`;
}

function structuralFailureCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/EMPTY_INITIAL_OUTPUT/i.test(message)) return "EMPTY_INITIAL_OUTPUT";
  if (/JSON object/i.test(message)) return "JSON_OBJECT_MISSING";
  if (name === "SyntaxError" || /JSON/i.test(message)) return "JSON_PARSE_FAILED";
  if (name === "ZodError" || /schema|validation|contract|contrato/i.test(message)) {
    return "SCHEMA_INVALID";
  }
  return "STRUCTURED_OUTPUT_INVALID";
}

function structuralFailureDetails(error: unknown): string {
  if (!error || typeof error !== "object") return structuralFailureCode(error);
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return structuralFailureCode(error);

  const details = issues
    .slice(0, 3)
    .map((issue) => {
      if (!issue || typeof issue !== "object") return null;
      const record = issue as { path?: unknown; message?: unknown };
      const path = Array.isArray(record.path)
        ? record.path.map(String).join(".") || "root"
        : "root";
      const message =
        typeof record.message === "string"
          ? record.message.replace(/\s+/g, " ").slice(0, 300)
          : "valor incompatível";
      return `${path}: ${message}`;
    })
    .filter((value): value is string => Boolean(value));

  return details.length ? details.join("; ").slice(0, 1_000) : structuralFailureCode(error);
}

export class AiStructuredRepairFailure extends Error {
  readonly code = "REPAIR_GENERATION_FAILED";
  readonly repairStage: AiRepairFailureStage;
  readonly initialFailureCode: string;
  readonly initialFailureDetails: string;
  readonly repairFailureDetails: string;
  readonly repairError: unknown;

  constructor({
    stage,
    initialError,
    repairError,
  }: {
    stage: AiRepairFailureStage;
    initialError: unknown;
    repairError: unknown;
  }) {
    super(`Structured output repair failed at ${stage}`);
    this.name = "AiStructuredRepairFailure";
    this.repairStage = stage;
    this.initialFailureCode = structuralFailureCode(initialError);
    this.initialFailureDetails = structuralFailureDetails(initialError);
    this.repairFailureDetails = structuralFailureDetails(repairError);
    this.repairError = repairError;
    this.cause = repairError;
  }
}

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
  mode = "local",
}: {
  output: unknown;
  rawModelText?: string;
  latencyMs: number;
  mode?: "local" | "online";
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

  if (mode === "local" && (parsed.data.sources.length || parsed.data.searches.length)) {
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

function extractErrorFacts(error: unknown): { diagnosticText: string; httpStatus: number | null } {
  const fragments: string[] = [];
  let httpStatus: number | null = null;
  const visited = new Set<unknown>();

  const visit = (value: unknown, depth: number) => {
    if (value == null || depth > 5 || visited.has(value)) return;
    if (typeof value === "string" || typeof value === "number") {
      fragments.push(String(value));
      return;
    }
    if (typeof value !== "object") return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 10)) visit(item, depth + 1);
      return;
    }

    const record = value as Record<string, unknown>;
    for (const key of ["statusCode", "status", "httpStatus", "http_status"]) {
      const candidate = Number(record[key]);
      if (
        httpStatus == null &&
        Number.isInteger(candidate) &&
        candidate >= 100 &&
        candidate <= 599
      ) {
        httpStatus = candidate;
      }
    }
    for (const key of [
      "name",
      "message",
      "code",
      "responseBody",
      "body",
      "cause",
      "repairError",
      "lastError",
      "errors",
    ]) {
      visit(record[key], depth + 1);
    }
  };

  visit(error, 0);
  return {
    diagnosticText: fragments.join(" ").slice(0, 20_000),
    httpStatus,
  };
}

function failureContextSuffix(
  context: AiGenerationFailureContext,
  httpStatus: number | null,
): string {
  const details: string[] = [];
  if (context.phase) details.push(`fase ${context.phase}`);
  if (httpStatus != null) details.push(`HTTP ${httpStatus}`);
  if (
    context.promptCharacters != null &&
    Number.isFinite(context.promptCharacters) &&
    context.promptCharacters >= 0
  ) {
    details.push(`prompt ~${Math.round(context.promptCharacters)} caracteres`);
  }
  return details.length ? ` Diagnóstico: ${details.join("; ")}.` : "";
}

export function createAiGenerationFailure(
  error: unknown,
  latencyMs: number,
  context: AiGenerationFailureContext = {},
): AiGenerationResult {
  const { diagnosticText, httpStatus } = extractErrorFacts(error);
  let errorCode = "PROVIDER_ERROR";
  let safeMessage =
    "O provider de IA não concluiu a saída estruturada. A recomendação foi convertida para PULAR.";

  if (error instanceof AiStructuredRepairFailure) {
    errorCode = "REPAIR_GENERATION_FAILED";
    safeMessage =
      error.repairStage === "REQUEST"
        ? `A resposta inicial falhou em ${error.initialFailureCode} e o provider não concluiu a chamada de reparo. A recomendação foi convertida para PULAR.`
        : `A resposta inicial falhou em ${error.initialFailureCode} e a saída reparada continuou incompatível com o contrato. Violações iniciais: ${error.initialFailureDetails}. Violações após reparo: ${error.repairFailureDetails}. A recomendação foi convertida para PULAR.`;
  } else if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    /GOOGLE_AI_API_KEY|api.?key|authentication|unauthorized|forbidden/i.test(diagnosticText)
  ) {
    errorCode = "PROVIDER_AUTH_ERROR";
    safeMessage =
      "A autenticação do Google AI Studio está indisponível. A recomendação foi convertida para PULAR.";
  } else if (
    httpStatus === 404 ||
    /not found|model.*(not found|unsupported)|endpoint.*not found/i.test(diagnosticText)
  ) {
    errorCode = "PROVIDER_NOT_FOUND";
    safeMessage =
      "O endpoint ou modelo configurado no Google AI Studio não foi encontrado. A recomendação foi convertida para PULAR.";
  } else if (
    httpStatus === 429 ||
    /rate.?limit|quota|resource.?exhausted|too many requests/i.test(diagnosticText)
  ) {
    errorCode = "PROVIDER_RATE_LIMIT";
    safeMessage =
      "A cota ou o limite do Google AI Studio foi atingido. A recomendação foi convertida para PULAR.";
  } else if (
    httpStatus === 402 ||
    /payment|billing|insufficient.?credits|credit balance/i.test(diagnosticText)
  ) {
    errorCode = "PROVIDER_BILLING_ERROR";
    safeMessage =
      "O Google AI Studio recusou a geração por cobrança ou créditos. A recomendação foi convertida para PULAR.";
  } else if (
    httpStatus === 413 ||
    /payload too large|request too large|context length|context window|maximum context|max.?tokens|too many tokens/i.test(
      diagnosticText,
    )
  ) {
    errorCode = "PROVIDER_PAYLOAD_TOO_LARGE";
    safeMessage =
      "O Google AI Studio recusou a geração pelo tamanho do payload ou limite de contexto. A recomendação foi convertida para PULAR.";
  } else if (/timeout|timed.?out|abort|ETIMEDOUT/i.test(diagnosticText)) {
    errorCode = "PROVIDER_TIMEOUT";
    safeMessage = "A geração estruturada excedeu o tempo limite e foi convertida para PULAR.";
  } else if (
    (httpStatus != null && httpStatus >= 500) ||
    /bad gateway|service unavailable|gateway timeout|internal server error/i.test(diagnosticText)
  ) {
    errorCode = "PROVIDER_SERVER_ERROR";
    safeMessage =
      "O Google AI Studio ficou temporariamente indisponível. A recomendação foi convertida para PULAR.";
  } else if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|network|fetch failed/i.test(diagnosticText)) {
    errorCode = "PROVIDER_NETWORK_ERROR";
    safeMessage =
      "A conexão com o Google AI Studio falhou. A recomendação foi convertida para PULAR.";
  } else if (
    /NoObjectGenerated|schema|parse|json|validation|structured output/i.test(diagnosticText)
  ) {
    errorCode = "SCHEMA_GENERATION_FAILED";
    safeMessage =
      "O Gemini não produziu uma resposta compatível com o contrato 1.1.0. A recomendação foi convertida para PULAR.";
  }

  return {
    model_output: null,
    raw_model_text: "",
    parse_status: "FAILED",
    parse_error: `${safeMessage}${failureContextSuffix(context, httpStatus)}`,
    error_code: errorCode,
    latency_ms: latencyMs,
  };
}
