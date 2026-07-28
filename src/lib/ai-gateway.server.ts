import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Google AI Studio (Gemini) via endpoint OpenAI-compatível.
// Mantemos o nome do helper para minimizar mudanças nos chamadores.
// A chave esperada é GOOGLE_AI_API_KEY (mesma usada anteriormente no Google Studio).
export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "google-ai-studio",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}
