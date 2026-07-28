import { createGoogleGenerativeAI } from "@ai-sdk/google";

// Google AI Studio (Gemini) pelo provider nativo do AI SDK. Evita depender
// da camada OpenAI-compatible e mantém function calling e Structured Output
// no protocolo oficial do Gemini.
export function createGoogleAiStudioProvider(apiKey: string) {
  return createGoogleGenerativeAI({
    apiKey,
  });
}

export function isGoogleAiModelNotFoundError(error: unknown): boolean {
  const visited = new Set<unknown>();

  const visit = (value: unknown, depth: number): boolean => {
    if (value == null || depth > 5 || visited.has(value)) return false;
    if (typeof value === "string") return /model.*not found|not found.*model/i.test(value);
    if (typeof value !== "object") return false;
    visited.add(value);

    const record = value as Record<string, unknown>;
    if (Number(record.statusCode ?? record.status) === 404) return true;
    return ["message", "responseBody", "body", "cause", "lastError", "errors"].some((key) =>
      visit(record[key], depth + 1),
    );
  };

  return visit(error, 0);
}
