import { createGoogleGenerativeAI } from "@ai-sdk/google";

// Google AI Studio (Gemini) pelo provider nativo do AI SDK. Evita depender
// da camada OpenAI-compatible e mantém function calling e Structured Output
// no protocolo oficial do Gemini.
export function createGoogleAiStudioProvider(apiKey: string) {
  return createGoogleGenerativeAI({
    apiKey,
  });
}
