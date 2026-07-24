import { describe, expect, it } from "vitest";
import { LOCAL_STRUCTURED_OUTPUT_PROVIDER_OPTIONS } from "./validacao-ia.functions";

describe("configuração do Structured Output local", () => {
  it("mantém desativado apenas o responseSchema incompatível do Gemini", () => {
    expect(LOCAL_STRUCTURED_OUTPUT_PROVIDER_OPTIONS).toEqual({
      google: {
        structuredOutputs: false,
      },
    });
  });
});
