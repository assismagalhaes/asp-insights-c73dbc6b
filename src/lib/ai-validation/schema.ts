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

const AiGenerationGateResultSchema = z.object({
  status: z.string(),
  reason: z.string(),
});

/**
 * Provider-facing parsing schema. It tolerates only harmless omissions that
 * can be normalized locally; the complete operational contract below remains
 * authoritative and is always revalidated before arbitration.
 */
export const AiLocalGenerationOutputSchema = z.object({
  schema_version: z.string().default(AI_VALIDATION_SCHEMA_VERSION),
  decision: z.string(),
  stake: z.number(),
  selected_prediction_id: z.string().nullable().default(null),
  selected_pick: z.string().nullable().default(null),
  gates: z.object({
    technical_consistency: AiGenerationGateResultSchema,
    critical_information: AiGenerationGateResultSchema,
    structural_risk: AiGenerationGateResultSchema,
    context: AiGenerationGateResultSchema,
    correlation: AiGenerationGateResultSchema,
  }),
  narrative: z.object({
    evaluated_entry: z.string(),
    thesis_for: z.string(),
    thesis_against: z.string(),
    internal_history: z.string(),
    final_justification: z.string(),
    decision_change_condition: z.string().nullable().default(null),
  }),
  rationale: z.string(),
  risks: z.array(z.string()).default([]),
  invalidation_condition: z.string(),
  limitations: z.array(z.string()).default([]),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
      }),
    )
    .default([]),
  searches: z.array(z.string()).default([]),
});

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
