function publicBoolean(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

/**
 * Public UI flags. These are rollout controls, not authorization boundaries.
 * Server routes and database access must still enforce admin authorization.
 */
export const featureFlags = Object.freeze({
  highlightlyAnalysis: publicBoolean(import.meta.env.VITE_HIGHLIGHTLY_ANALYSIS_ENABLED),
});
