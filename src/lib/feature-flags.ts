/**
 * Public UI flags. These are rollout controls, not authorization boundaries.
 * Server routes and database access must still enforce admin authorization.
 */
export const featureFlags = Object.freeze({
  // Phase 7 now has real shadow data. Expose the read-only analysis surface so
  // administrators can validate matches, statistics and odds in practice.
  // This does not enable the ingestion worker or the Highlightly provider.
  highlightlyAnalysis: true,
});
