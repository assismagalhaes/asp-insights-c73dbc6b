import { describe, expect, it } from "vitest";
import { AI_VALIDATION_EVALUATION_CASES } from "../../../evals/ai-validation/fixtures";
import {
  compareAiModelSnapshots,
  evaluateAiValidationCases,
  getAiEvaluationReleaseFailures,
  type AiModelEvaluationSnapshot,
} from "./evaluation";

describe("Fase 3 — avaliações contínuas", () => {
  it("mantém pelo menos 80 casos versionados e todos os domínios críticos", () => {
    expect(AI_VALIDATION_EVALUATION_CASES).toHaveLength(80);
    const ids = AI_VALIDATION_EVALUATION_CASES.map((item) => item.id);

    expect(ids.some((id) => id.startsWith("mlb-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("wnba-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("goalmatrix-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("cornermatrix-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("backmatrix-"))).toBe(true);
    expect(AI_VALIDATION_EVALUATION_CASES.some((item) => item.mode === "local")).toBe(true);
    expect(AI_VALIDATION_EVALUATION_CASES.some((item) => item.mode === "online")).toBe(true);
  });

  it("aprova os gates de release sem tolerar violações operacionais", () => {
    const report = evaluateAiValidationCases(AI_VALIDATION_EVALUATION_CASES);

    expect(getAiEvaluationReleaseFailures(report)).toEqual([]);
    expect(report.summary).toMatchObject({
      total: 80,
      expectation_pass_rate: 1,
      expected_valid_rate: 1,
      fail_safe_rate: 1,
      invariant_violations: 0,
      local_trace_violations: 0,
      online_research_violations: 0,
    });
  });

  it("bloqueia dataset incompleto ou regressão estrutural", () => {
    const report = evaluateAiValidationCases(AI_VALIDATION_EVALUATION_CASES.slice(0, 1));
    const failures = getAiEvaluationReleaseFailures(report);

    expect(failures).toEqual(expect.arrayContaining([expect.stringContaining("mínimo: 80")]));
  });

  it("compara custo, latência e concordância sem transformar qualidade em hard gate", () => {
    const gates = {
      technical_consistency: "APPROVED",
      critical_information: "APPROVED",
      structural_risk: "APPROVED",
      context: "APPROVED",
      correlation: "APPROVED",
    } as const;
    const baseline: AiModelEvaluationSnapshot[] = [
      {
        case_id: "case-1",
        model: "google/gemini-2.5-pro",
        generation_valid: true,
        repaired: false,
        final_decision: "CONFIRMA",
        gates,
        latency_ms: 12_000,
        input_tokens: 1_000,
        output_tokens: 500,
        estimated_cost_usd: 0.1,
      },
    ];
    const candidate: AiModelEvaluationSnapshot[] = [
      {
        case_id: "case-1",
        model: "google/gemini-3.6-flash",
        generation_valid: true,
        repaired: false,
        final_decision: "PULAR",
        gates: { ...gates, structural_risk: "UNKNOWN" },
        latency_ms: 3_000,
        input_tokens: 1_000,
        output_tokens: 400,
        estimated_cost_usd: 0.01,
      },
    ];

    expect(compareAiModelSnapshots(baseline, candidate)).toMatchObject({
      matched_cases: 1,
      decision_agreement_rate: 0,
      gate_agreement_rate: 0.8,
      baseline_schema_valid_rate: 1,
      candidate_schema_valid_rate: 1,
      baseline_average_latency_ms: 12_000,
      candidate_average_latency_ms: 3_000,
      baseline_total_cost_usd: 0.1,
      candidate_total_cost_usd: 0.01,
    });
  });
});
