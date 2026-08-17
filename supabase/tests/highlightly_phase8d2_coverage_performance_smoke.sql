BEGIN;

DO $structure$
DECLARE
  job_index_definition text;
BEGIN
  SELECT pg_get_indexdef(index_row.indexrelid)
  INTO job_index_definition
  FROM pg_index AS index_row
  WHERE index_row.indexrelid = to_regclass(
    'public.idx_hl_ingestion_jobs_endpoint_sport_match_updated'
  );

  IF job_index_definition IS NULL
     OR job_index_definition NOT LIKE '%endpoint_key, sport, ((request_params ->> ''matchId''::text)), updated_at DESC%' THEN
    RAISE EXCEPTION 'coverage refresh job lookup index is missing or malformed';
  END IF;

  IF to_regprocedure(
    'public.refresh_highlightly_odds_league_coverage(date,timestamp with time zone,timestamp with time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'coverage refresh function is missing';
  END IF;
END
$structure$;

ROLLBACK;
