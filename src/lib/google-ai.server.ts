import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Provider do Google AI Studio (chave própria do usuário).
 * Usa GOOGLE_GENERATIVE_AI_API_KEY definida como secret server-side.
 */
export function createGoogleProvider() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY não configurada. Adicione sua chave do Google AI Studio.",
    );
  }
  return createGoogleGenerativeAI({ apiKey });
}

export const GOOGLE_MODEL_ID = "gemini-2.5-pro";
