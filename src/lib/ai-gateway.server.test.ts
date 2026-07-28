import { describe, expect, it } from "vitest";
import { isGoogleAiModelNotFoundError } from "./ai-gateway.server";

describe("Google AI Studio provider", () => {
  it("reconhece HTTP 404 aninhado para ativar o fallback de modelo", () => {
    expect(
      isGoogleAiModelNotFoundError(
        Object.assign(new Error("Failed after retries"), {
          cause: { statusCode: 404, responseBody: '{"error":{"status":"NOT_FOUND"}}' },
        }),
      ),
    ).toBe(true);
  });

  it("não ativa fallback para autenticação ou limite de cota", () => {
    expect(isGoogleAiModelNotFoundError({ statusCode: 403 })).toBe(false);
    expect(isGoogleAiModelNotFoundError({ statusCode: 429 })).toBe(false);
  });
});
