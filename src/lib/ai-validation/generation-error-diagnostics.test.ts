import { describe, expect, it } from "vitest";
import { createAiGenerationFailure } from "./generation-result";

describe("diagnóstico de falhas do provider", () => {
  it("extrai status de uma causa aninhada sem expor detalhes do provider", () => {
    const error = Object.assign(new Error("Failed after 3 attempts"), {
      cause: {
        statusCode: 402,
        responseBody: "insufficient credits secret-account-detail",
      },
    });
    const result = createAiGenerationFailure(error, 90, {
      phase: "INITIAL_GENERATION",
      promptCharacters: 12_345,
    });

    expect(result.error_code).toBe("PROVIDER_BILLING_ERROR");
    expect(result.parse_error).toContain("HTTP 402");
    expect(result.parse_error).toContain("prompt ~12345 caracteres");
    expect(result.parse_error).not.toContain("secret-account-detail");
  });

  it("distingue payload excessivo e indisponibilidade do gateway", () => {
    const payloadFailure = createAiGenerationFailure(
      { status: 413, message: "request too large private-payload-detail" },
      30,
    );
    const serverFailure = createAiGenerationFailure(
      { cause: { statusCode: 503, body: "upstream private-detail" } },
      30,
    );

    expect(payloadFailure.error_code).toBe("PROVIDER_PAYLOAD_TOO_LARGE");
    expect(payloadFailure.parse_error).toContain("HTTP 413");
    expect(payloadFailure.parse_error).not.toContain("private-payload-detail");
    expect(serverFailure.error_code).toBe("PROVIDER_SERVER_ERROR");
    expect(serverFailure.parse_error).toContain("HTTP 503");
    expect(serverFailure.parse_error).not.toContain("private-detail");
  });
});
