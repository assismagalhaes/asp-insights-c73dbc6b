import { z } from "zod";
import { AI_VALIDATION_SCHEMA_VERSION } from "./types";

export const AiDecisionSchema = z.enum(["CONFIRMA", "PULAR"]);
export const AiStakeSchema = z.union([z.literal(0), z.literal(0.5), z.literal(1), z.literal(1.5)]);

export const AiGateResultSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED", "UNKNOWN"]),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const AiSourceSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    url: z.string().url().max(2_000),
  })
  .strict();

export const AiNarrativeSectionsSchema = z
  .object({
    evaluated_entry: z.string().trim().min(1).max(5_000),
    thesis_for: z.string().trim().min(1).max(10_000),
    thesis_against: z.string().trim().min(1).max(10_000),
    internal_history: z.string().trim().min(1).max(5_000),
    final_justification: z.string().trim().min(1).max(5_000),
    decision_change_condition: z.string().trim().min(1).max(5_000).nullable(),
  })
  .strict();

export const AiOperationalOutputSchema = z
  .object({
    schema_version: z.literal(AI_VALIDATION_SCHEMA_VERSION),
    decision: AiDecisionSchema,
    stake: AiStakeSchema,
    selected_prediction_id: z.string().trim().min(1).max(200).nullable(),
    selected_pick: z.string().trim().min(1).max(1_000).nullable(),
    gates: z
      .object({
        technical_consistency: AiGateResultSchema,
        critical_information: AiGateResultSchema,
        structural_risk: AiGateResultSchema,
        context: AiGateResultSchema,
        correlation: AiGateResultSchema,
      })
      .strict(),
    narrative: AiNarrativeSectionsSchema,
    rationale: z.string().trim().min(1).max(10_000),
    risks: z.array(z.string().trim().min(1).max(2_000)).max(10),
    invalidation_condition: z.string().trim().min(1).max(5_000),
    limitations: z.array(z.string().trim().min(1).max(2_000)).max(10),
    sources: z.array(AiSourceSchema).max(50),
    searches: z.array(z.string().trim().min(1).max(1_000)).max(50),
  })
  .strict();

export function parseAiOperationalOutput(input: unknown) {
  return AiOperationalOutputSchema.safeParse(input);
}
