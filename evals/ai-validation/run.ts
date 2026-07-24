import {
  evaluateAiValidationCases,
  getAiEvaluationReleaseFailures,
} from "../../src/lib/ai-validation/evaluation";
import { AI_VALIDATION_EVALUATION_CASES } from "./fixtures";

const report = evaluateAiValidationCases(AI_VALIDATION_EVALUATION_CASES);
const failures = getAiEvaluationReleaseFailures(report);

console.log(JSON.stringify(report.summary, null, 2));

if (failures.length) {
  console.error("\nGates de release reprovados:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nGates determinísticos da Fase 3 aprovados.");
}
