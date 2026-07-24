export type AiValidationMode = "local" | "online";
export type AiValidationRolloutStage = "legacy" | "canary" | "full";
export type AiValidationRolloutVariant = "legacy" | "structured";
export type AiValidationRolloutReason =
  "explicit_rollback" | "stage_legacy" | "canary_allowlist" | "canary_holdback" | "stage_full";

export type AiValidationRolloutDecision = {
  stage: AiValidationRolloutStage;
  variant: AiValidationRolloutVariant;
  reason: AiValidationRolloutReason;
};

type RolloutEnvironment = Record<string, string | undefined>;

const ROLLBACK_FLAG: Record<AiValidationMode, string> = {
  local: "AI_VALIDATION_LOCAL_LEGACY_ROLLBACK",
  online: "AI_VALIDATION_ONLINE_LEGACY_ROLLBACK",
};

const STAGE_FLAG: Record<AiValidationMode, string> = {
  local: "AI_VALIDATION_LOCAL_ROLLOUT_STAGE",
  online: "AI_VALIDATION_ONLINE_ROLLOUT_STAGE",
};

function isTrue(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function parseStage(value: string | undefined): AiValidationRolloutStage {
  const normalized = value?.trim().toLowerCase();
  return normalized === "legacy" || normalized === "canary" || normalized === "full"
    ? normalized
    : "full";
}

function parseCanaryUsers(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
}

export function resolveAiValidationRollout({
  mode,
  userId,
  env = process.env,
}: {
  mode: AiValidationMode;
  userId: string;
  env?: RolloutEnvironment;
}): AiValidationRolloutDecision {
  const stage = parseStage(env[STAGE_FLAG[mode]]);

  if (isTrue(env[ROLLBACK_FLAG[mode]])) {
    return { stage, variant: "legacy", reason: "explicit_rollback" };
  }

  if (stage === "legacy") {
    return { stage, variant: "legacy", reason: "stage_legacy" };
  }

  if (stage === "full") {
    return { stage, variant: "structured", reason: "stage_full" };
  }

  const canaryUsers = parseCanaryUsers(env.AI_VALIDATION_STRUCTURED_CANARY_USER_IDS);
  return canaryUsers.has(userId)
    ? { stage, variant: "structured", reason: "canary_allowlist" }
    : { stage, variant: "legacy", reason: "canary_holdback" };
}

export function rolloutTelemetry(decision: AiValidationRolloutDecision) {
  return {
    rollout_stage: decision.stage,
    rollout_variant: decision.variant,
    rollout_reason: decision.reason,
  };
}
