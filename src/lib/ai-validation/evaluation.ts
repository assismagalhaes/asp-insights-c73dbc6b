import {
  arbitrateAiGenerationFailure,
  arbitrateAiOutput,
  arbitrateAiSchemaFailure,
  type AiArbiterContext,
} from "./arbiter";
import {
  createAiGenerationFailure,
  parseStructuredAiOutput,
  type AiGenerationResult,
} from "./generation-result";
import { AI_GATE_NAMES, type AiValidationBlockingCode, type AiValidationMode } from "./types";

export type AiEvaluationExpectation = {
  generation_valid: boolean;
  final_decision: "CONFIRMA" | "PULAR";
  arbiter_status: "APPROVED" | "BLOCKED";
  required_blocks?: AiValidationBlockingCode[];
  online_research_required?: boolean;
};

export type AiEvaluationCase = {
  id: string;
  category: string;
  mode: AiValidationMode;
  context: AiArbiterContext;
  candidate_output?: unknown;
  provider_error?: string;
  repair_attempted?: boolean;
  expectation: AiEvaluationExpectation;
};

export type AiEvaluationCaseResult = {
  id: string;
  category: string;
  generation: AiGenerationResult;
  final_decision: "CONFIRMA" | "PULAR";
  arbiter_status: "APPROVED" | "BLOCKED";
  block_codes: AiValidationBlockingCode[];
  expectation_passed: boolean;
  invariant_violations: string[];
  local_trace_violation: boolean;
  online_research_violation: boolean;
};

export type AiEvaluationSummary = {
  total: number;
  expectation_passed: number;
  expectation_pass_rate: number;
  expected_valid_cases: number;
  unexpected_generation_failures: number;
  expected_valid_rate: number;
  fail_safe_cases: number;
  fail_safe_passed: number;
  fail_safe_rate: number;
  invariant_violations: number;
  local_trace_violations: number;
  online_research_violations: number;
  repair_attempts: number;
  repair_rate: number;
};

export type AiEvaluationReport = {
  cases: AiEvaluationCaseResult[];
  summary: AiEvaluationSummary;
};

export const AI_EVALUATION_RELEASE_THRESHOLDS = {
  min_cases: 80,
  min_expectation_pass_rate: 1,
  min_expected_valid_rate: 0.99,
  min_fail_safe_rate: 1,
  max_invariant_violations: 0,
  max_local_trace_violations: 0,
  max_online_research_violations: 0,
} as const;

function generationFor(testCase: AiEvaluationCase): AiGenerationResult {
  if (testCase.provider_error) {
    return createAiGenerationFailure(new Error(testCase.provider_error), 0);
  }
  return parseStructuredAiOutput({
    output: testCase.candidate_output,
    latencyMs: 0,
    mode: testCase.mode,
  });
}

function invariantViolations(
  generation: AiGenerationResult,
  final: ReturnType<typeof arbitrateAiOutput>,
): string[] {
  const violations: string[] = [];
  const output = final.output;

  if (
    output.decision === "PULAR" &&
    (output.stake !== 0 || output.selected_prediction_id || output.selected_pick)
  ) {
    violations.push("PULAR_WITH_OPERATIONAL_SELECTION");
  }
  if (
    output.decision === "CONFIRMA" &&
    (output.stake === 0 || !output.selected_prediction_id || !output.selected_pick)
  ) {
    violations.push("CONFIRMA_WITHOUT_COMPLETE_SELECTION");
  }
  if (
    generation.parse_status === "FAILED" &&
    (output.decision !== "PULAR" ||
      output.stake !== 0 ||
      output.selected_prediction_id ||
      output.selected_pick)
  ) {
    violations.push("GENERATION_FAILURE_NOT_FAIL_SAFE");
  }

  return violations;
}

function requiredBlocksPresent(
  required: AiValidationBlockingCode[] | undefined,
  actual: AiValidationBlockingCode[],
): boolean {
  return (required ?? []).every((code) => actual.includes(code));
}

export function evaluateAiValidationCases(cases: AiEvaluationCase[]): AiEvaluationReport {
  const results = cases.map((testCase): AiEvaluationCaseResult => {
    const generation = generationFor(testCase);
    const final =
      generation.parse_status === "FAILED" && generation.model_output == null
        ? generation.error_code === "SCHEMA_INVALID"
          ? arbitrateAiSchemaFailure(generation.parse_error)
          : arbitrateAiGenerationFailure({
              errorCode: generation.error_code,
              reason: generation.parse_error,
            })
        : arbitrateAiOutput(generation.model_output, testCase.context);
    const blockCodes = final.blocks.map((block) => block.code);
    const invariant_violations = invariantViolations(generation, final);
    const local_trace_violation =
      testCase.mode === "local" &&
      final.output.decision === "CONFIRMA" &&
      (final.output.sources.length > 0 || final.output.searches.length > 0);
    const online_research_violation = Boolean(
      testCase.expectation.online_research_required &&
      final.output.decision === "CONFIRMA" &&
      (final.output.sources.length === 0 || final.output.searches.length === 0),
    );
    const generationValid = generation.parse_status !== "FAILED";
    const expectation_passed =
      generationValid === testCase.expectation.generation_valid &&
      final.output.decision === testCase.expectation.final_decision &&
      final.status === testCase.expectation.arbiter_status &&
      requiredBlocksPresent(testCase.expectation.required_blocks, blockCodes) &&
      invariant_violations.length === 0 &&
      !local_trace_violation &&
      !online_research_violation;

    return {
      id: testCase.id,
      category: testCase.category,
      generation,
      final_decision: final.output.decision,
      arbiter_status: final.status,
      block_codes: blockCodes,
      expectation_passed,
      invariant_violations,
      local_trace_violation,
      online_research_violation,
    };
  });

  const expectedValid = cases.filter((item) => item.expectation.generation_valid);
  const unexpectedGenerationFailures = results.filter((result, index) => {
    return cases[index].expectation.generation_valid && result.generation.parse_status === "FAILED";
  }).length;
  const failSafeIndexes = cases
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.expectation.generation_valid || item.provider_error);
  const failSafePassed = failSafeIndexes.filter(({ index }) => {
    const result = results[index];
    return (
      result.final_decision === "PULAR" &&
      result.invariant_violations.length === 0 &&
      result.generation.parse_status === "FAILED"
    );
  }).length;
  const repairAttempts = cases.filter((item) => item.repair_attempted).length;

  return {
    cases: results,
    summary: {
      total: cases.length,
      expectation_passed: results.filter((result) => result.expectation_passed).length,
      expectation_pass_rate:
        cases.length === 0
          ? 0
          : results.filter((result) => result.expectation_passed).length / cases.length,
      expected_valid_cases: expectedValid.length,
      unexpected_generation_failures: unexpectedGenerationFailures,
      expected_valid_rate:
        expectedValid.length === 0
          ? 0
          : (expectedValid.length - unexpectedGenerationFailures) / expectedValid.length,
      fail_safe_cases: failSafeIndexes.length,
      fail_safe_passed: failSafePassed,
      fail_safe_rate: failSafeIndexes.length === 0 ? 1 : failSafePassed / failSafeIndexes.length,
      invariant_violations: results.reduce(
        (total, result) => total + result.invariant_violations.length,
        0,
      ),
      local_trace_violations: results.filter((result) => result.local_trace_violation).length,
      online_research_violations: results.filter((result) => result.online_research_violation)
        .length,
      repair_attempts: repairAttempts,
      repair_rate: cases.length === 0 ? 0 : repairAttempts / cases.length,
    },
  };
}

export function getAiEvaluationReleaseFailures(report: AiEvaluationReport): string[] {
  const { summary } = report;
  const thresholds = AI_EVALUATION_RELEASE_THRESHOLDS;
  const failures: string[] = [];

  if (summary.total < thresholds.min_cases) {
    failures.push(`Dataset possui ${summary.total} casos; mínimo: ${thresholds.min_cases}.`);
  }
  if (summary.expectation_pass_rate < thresholds.min_expectation_pass_rate) {
    failures.push(
      `Expectativas aprovadas: ${(summary.expectation_pass_rate * 100).toFixed(2)}%; mínimo: ${(thresholds.min_expectation_pass_rate * 100).toFixed(2)}%.`,
    );
  }
  if (summary.expected_valid_rate < thresholds.min_expected_valid_rate) {
    failures.push(
      `Validade estrutural inesperada: ${(summary.expected_valid_rate * 100).toFixed(2)}%; mínimo: ${(thresholds.min_expected_valid_rate * 100).toFixed(2)}%.`,
    );
  }
  if (summary.fail_safe_rate < thresholds.min_fail_safe_rate) {
    failures.push(
      `Fail-safe: ${(summary.fail_safe_rate * 100).toFixed(2)}%; mínimo: ${(thresholds.min_fail_safe_rate * 100).toFixed(2)}%.`,
    );
  }
  if (summary.invariant_violations > thresholds.max_invariant_violations) {
    failures.push(`Violações operacionais: ${summary.invariant_violations}.`);
  }
  if (summary.local_trace_violations > thresholds.max_local_trace_violations) {
    failures.push(`Traços externos indevidos no modo Local: ${summary.local_trace_violations}.`);
  }
  if (summary.online_research_violations > thresholds.max_online_research_violations) {
    failures.push(
      `Confirmações Online sem pesquisa exigida: ${summary.online_research_violations}.`,
    );
  }

  return failures;
}

export type AiModelEvaluationSnapshot = {
  case_id: string;
  model: string;
  generation_valid: boolean;
  repaired: boolean;
  final_decision: "CONFIRMA" | "PULAR";
  gates: Record<(typeof AI_GATE_NAMES)[number], "APPROVED" | "REJECTED" | "UNKNOWN">;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
};

export type AiModelComparison = {
  matched_cases: number;
  decision_agreement_rate: number | null;
  gate_agreement_rate: number | null;
  baseline_schema_valid_rate: number | null;
  candidate_schema_valid_rate: number | null;
  baseline_repair_rate: number | null;
  candidate_repair_rate: number | null;
  baseline_average_latency_ms: number | null;
  candidate_average_latency_ms: number | null;
  baseline_total_cost_usd: number;
  candidate_total_cost_usd: number;
};

function rate(values: boolean[]): number | null {
  return values.length ? values.filter(Boolean).length / values.length : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function compareAiModelSnapshots(
  baseline: AiModelEvaluationSnapshot[],
  candidate: AiModelEvaluationSnapshot[],
): AiModelComparison {
  const candidateByCase = new Map(candidate.map((item) => [item.case_id, item]));
  const pairs = baseline.flatMap((base) => {
    const next = candidateByCase.get(base.case_id);
    return next ? [{ base, next }] : [];
  });
  const gateMatches = pairs.flatMap(({ base, next }) =>
    AI_GATE_NAMES.map((gate) => base.gates[gate] === next.gates[gate]),
  );

  return {
    matched_cases: pairs.length,
    decision_agreement_rate: rate(
      pairs.map(({ base, next }) => base.final_decision === next.final_decision),
    ),
    gate_agreement_rate: rate(gateMatches),
    baseline_schema_valid_rate: rate(pairs.map(({ base }) => base.generation_valid)),
    candidate_schema_valid_rate: rate(pairs.map(({ next }) => next.generation_valid)),
    baseline_repair_rate: rate(pairs.map(({ base }) => base.repaired)),
    candidate_repair_rate: rate(pairs.map(({ next }) => next.repaired)),
    baseline_average_latency_ms: average(pairs.map(({ base }) => base.latency_ms)),
    candidate_average_latency_ms: average(pairs.map(({ next }) => next.latency_ms)),
    baseline_total_cost_usd: pairs.reduce((total, { base }) => total + base.estimated_cost_usd, 0),
    candidate_total_cost_usd: pairs.reduce((total, { next }) => total + next.estimated_cost_usd, 0),
  };
}
