-- Bound the Phase 8D.2 coverage refresh lookups by their full equality keys.
-- This changes only indexes; no provider state, collection policy, or data is changed.

CREATE INDEX IF NOT EXISTS idx_hl_ingestion_jobs_endpoint_sport_match_updated
  ON public.hl_ingestion_jobs (
    endpoint_key,
    sport,
    ((request_params ->> 'matchId')),
    updated_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_sports_odds_current_open_pregame_match
  ON public.sports_odds_current (match_id)
  WHERE quote_status = 'open'
    AND NOT is_live;
