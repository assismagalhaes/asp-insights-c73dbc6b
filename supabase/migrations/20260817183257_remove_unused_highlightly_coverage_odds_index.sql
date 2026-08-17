-- The refresh plan uses the existing match/market index for odds aggregation.
-- Avoid duplicate write amplification from the unused candidate index.

DROP INDEX IF EXISTS public.idx_sports_odds_current_open_pregame_match;
