import { describe, expect, it } from "vitest";
import {
  AiStructuredRepairFailure,
  buildStructuredRepairPrompt,
  createAiGenerationFailure,
} from "./generation-result";

describe("diagnóstico de falhas do provider", () => {
  it("mantém o contexto operacional quando a saída inicial está vazia", () => {
    const prompt = buildStructuredRepairPrompt({
      operationalContext: "Jogo: Portland Timbers vs Real Salt Lake\nOdd: 1.48\nEdge: 6.59%",
      previousOutput: "   ",
      researchContext: "Buscas: injury report\nFontes: MLS — https://example.com/mls",
    });

    expect(prompt).toContain("Portland Timbers vs Real Salt Lake");
    expect(prompt).toContain("Odd: 1.48");
    expect(prompt).toContain("injury report");
    expect(prompt).toContain("EMPTY_INITIAL_OUTPUT");
  });

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

  it("preserva a falha inicial e distingue erro na chamada de reparo", () => {
    const repairFailure = new AiStructuredRepairFailure({
      stage: "REQUEST",
      initialError: new SyntaxError("Unexpected token in JSON"),
      repairError: { statusCode: 429, body: "private-rate-limit-detail" },
    });
    const result = createAiGenerationFailure(repairFailure, 140, {
      phase: "REPAIR_GENERATION",
      promptCharacters: 7_761,
    });

    expect(result.error_code).toBe("REPAIR_GENERATION_FAILED");
    expect(result.parse_error).toContain("JSON_PARSE_FAILED");
    expect(result.parse_error).toContain("provider não concluiu a chamada de reparo");
    expect(result.parse_error).toContain("HTTP 429");
    expect(result.parse_error).not.toContain("private-rate-limit-detail");
  });

  it("distingue reparo concluído com segundo parse inválido", () => {
    const repairFailure = new AiStructuredRepairFailure({
      stage: "PARSE",
      initialError: new Error("JSON object não encontrado"),
      repairError: new Error("schema validation failed private-schema-detail"),
    });
    const result = createAiGenerationFailure(repairFailure, 80, {
      phase: "REPAIR_GENERATION",
    });

    expect(result.error_code).toBe("REPAIR_GENERATION_FAILED");
    expect(result.parse_error).toContain("JSON_OBJECT_MISSING");
    expect(result.parse_error).toContain("saída reparada continuou incompatível");
    expect(result.parse_error).not.toContain("private-schema-detail");
  });
});
