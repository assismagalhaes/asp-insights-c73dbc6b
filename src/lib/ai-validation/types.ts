import type { z } from "zod";
import type { AiOperationalOutputSchema } from "./schema";

export const AI_VALIDATION_SCHEMA_VERSION = "1.1.0" as const;

export const AI_GATE_NAMES = [
  "technical_consistency",
  "critical_information",
  "structural_risk",
  "context",
  "correlation",
] as const;

export type AiGateName = (typeof AI_GATE_NAMES)[number];
export type AiOperationalOutput = z.infer<typeof AiOperationalOutputSchema>;

export type AiValidationMode = "local" | "online";

export type AiValidationBlockingCode =
  | "SCHEMA_INVALID"
  | "MODEL_GATE_REJECTED"
  | "PULAR_STAKE_NON_ZERO"
  | "PULAR_SELECTION_PRESENT"
  | "CONFIRMA_STAKE_ZERO"
  | "SELECTION_ID_REQUIRED"
  | "SELECTION_ID_NOT_IN_GROUP"
  | "SELECTED_PICK_REQUIRED"
  | "SELECTED_PICK_MISMATCH"
  | "CORRELATED_SELECTION_CONFLICT"
  | "EFFECTIVE_EDGE_INVALID"
  | "ODD_BELOW_FAIR_VALUE"
  | "MLB_GATE_BLOCKED"
  | "MLB_STARTERS_MISSING"
  | "MLB_PREVIEW_MISSING"
  | "MATCHMATRIX_GATE_BLOCKED"
  | "PACKBALL_EXECUTABLE_ODD_MISSING"
  | "PACKBALL_SEM_PRECO"
  | "PACKBALL_EDGE_BELOW_MIN"
  | "PACKBALL_STAKE_CAP_EXCEEDED";

export type AiValidationBlock = {
  code: AiValidationBlockingCode;
  reason: string;
};

export type ArbitratedAiValidation = {
  status: "APPROVED" | "BLOCKED";
  output: AiOperationalOutput;
  model_output: AiOperationalOutput | null;
  blocks: AiValidationBlock[];
};
