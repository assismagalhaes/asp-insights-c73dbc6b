import { describe, expect, it } from "vitest";
import { resolveAiValidationRollout, rolloutTelemetry } from "./rollout";

describe("resolveAiValidationRollout", () => {
  it("preserves structured output as the default full rollout", () => {
    expect(resolveAiValidationRollout({ mode: "local", userId: "admin-1", env: {} })).toEqual({
      stage: "full",
      variant: "structured",
      reason: "stage_full",
    });
  });

  it("gives the explicit emergency rollback flag highest precedence", () => {
    expect(
      resolveAiValidationRollout({
        mode: "online",
        userId: "admin-1",
        env: {
          AI_VALIDATION_ONLINE_ROLLOUT_STAGE: "full",
          AI_VALIDATION_ONLINE_LEGACY_ROLLBACK: "TRUE",
        },
      }),
    ).toEqual({
      stage: "full",
      variant: "legacy",
      reason: "explicit_rollback",
    });
  });

  it("holds non-allowlisted administrators in legacy during canary", () => {
    expect(
      resolveAiValidationRollout({
        mode: "local",
        userId: "admin-2",
        env: {
          AI_VALIDATION_LOCAL_ROLLOUT_STAGE: "canary",
          AI_VALIDATION_STRUCTURED_CANARY_USER_IDS: "admin-1, admin-3",
        },
      }),
    ).toEqual({
      stage: "canary",
      variant: "legacy",
      reason: "canary_holdback",
    });
  });

  it("enables structured output only for an allowlisted canary administrator", () => {
    const decision = resolveAiValidationRollout({
      mode: "online",
      userId: "admin-1",
      env: {
        AI_VALIDATION_ONLINE_ROLLOUT_STAGE: "canary",
        AI_VALIDATION_STRUCTURED_CANARY_USER_IDS: "admin-1, admin-3",
      },
    });

    expect(decision).toEqual({
      stage: "canary",
      variant: "structured",
      reason: "canary_allowlist",
    });
    expect(rolloutTelemetry(decision)).toEqual({
      rollout_stage: "canary",
      rollout_variant: "structured",
      rollout_reason: "canary_allowlist",
    });
  });

  it("supports an intentional legacy stage independently per mode", () => {
    expect(
      resolveAiValidationRollout({
        mode: "local",
        userId: "admin-1",
        env: { AI_VALIDATION_LOCAL_ROLLOUT_STAGE: "legacy" },
      }),
    ).toEqual({
      stage: "legacy",
      variant: "legacy",
      reason: "stage_legacy",
    });
  });
});
