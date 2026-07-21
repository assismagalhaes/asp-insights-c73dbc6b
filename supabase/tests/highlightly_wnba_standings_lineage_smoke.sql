BEGIN;

DO $structure$
DECLARE
  wnba_scope public.hl_competition_scopes%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS index_row
    JOIN pg_index AS index_definition ON index_definition.indexrelid = index_row.oid
    WHERE index_row.relname = 'idx_hl_raw_objects_run_unique'
      AND index_definition.indisunique
  ) THEN
    RAISE EXCEPTION 'Unique raw-object run lineage index is missing';
  END IF;

  SELECT * INTO STRICT wnba_scope
  FROM public.hl_competition_scopes
  WHERE provider_family = 'basketball'
    AND scope_key = 'wnba'
    AND provider_competition_id = '11847';

  IF COALESCE((wnba_scope.capabilities ->> 'standings')::boolean, true)
    OR wnba_scope.metadata ->> 'standingsPolicy' <> 'provider_quarantined' THEN
    RAISE EXCEPTION 'WNBA standings quarantine is not explicit in the catalog';
  END IF;

  IF has_table_privilege('anon', 'public.hl_raw_objects', 'SELECT')
    OR has_table_privilege('anon', 'public.hl_data_quality_issues', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read raw lineage or quality issues';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sports_providers WHERE code = 'highlightly' AND enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled';
  END IF;
END
$structure$;

DO $lineage$
DECLARE
  provider uuid;
  basketball uuid;
  job_one uuid := gen_random_uuid();
  job_two uuid := gen_random_uuid();
  run_one uuid := gen_random_uuid();
  run_two uuid := gen_random_uuid();
  raw_one uuid := gen_random_uuid();
  raw_two uuid := gen_random_uuid();
  shared_sha text := repeat('a', 64);
BEGIN
  SELECT id INTO STRICT provider
  FROM public.sports_providers
  WHERE code = 'highlightly';

  SELECT id INTO STRICT basketball
  FROM public.sports
  WHERE code = 'basketball';

  INSERT INTO public.hl_ingestion_jobs (
    id, endpoint_key, sport, resource, dedupe_key, status
  ) VALUES
    (job_one, 'basketball.BasketballStandingsController_getStandings', 'basketball', 'standings', 'smoke:wnba-lineage:' || job_one, 'succeeded'),
    (job_two, 'basketball.BasketballStandingsController_getStandings', 'basketball', 'standings', 'smoke:wnba-lineage:' || job_two, 'succeeded');

  INSERT INTO public.hl_ingestion_runs (
    id, job_id, worker_id, status, http_status, records_received, records_rejected
  ) VALUES
    (run_one, job_one, 'smoke-worker', 'partial', 200, 30, 30),
    (run_two, job_two, 'smoke-worker', 'partial', 200, 30, 30);

  INSERT INTO public.hl_raw_objects (
    id, job_id, run_id, provider_id, sport_id, endpoint_key,
    storage_path, sha256, byte_size
  ) VALUES
    (raw_one, job_one, run_one, provider, basketball, 'basketball.BasketballStandingsController_getStandings', 'basketball/smoke/' || run_one || '/same.json.gz', shared_sha, 10),
    (raw_two, job_two, run_two, provider, basketball, 'basketball/smoke/' || run_two || '/same.json.gz', shared_sha, 10);

  INSERT INTO public.hl_data_quality_issues (
    run_id, raw_object_id, endpoint_key, sport, severity, issue_code
  ) VALUES
    (run_one, raw_one, 'basketball.BasketballStandingsController_getStandings', 'basketball', 'critical', 'BASKETBALL_STANDINGS_CORRUPTED'),
    (run_two, raw_two, 'basketball.BasketballStandingsController_getStandings', 'basketball', 'critical', 'BASKETBALL_STANDINGS_CORRUPTED');

  IF (SELECT count(*) FROM public.hl_raw_objects WHERE run_id IN (run_one, run_two)) <> 2
    OR (SELECT count(DISTINCT run_id) FROM public.hl_raw_objects WHERE run_id IN (run_one, run_two)) <> 2
    OR (SELECT count(*) FROM public.hl_data_quality_issues WHERE run_id IN (run_one, run_two)) <> 2 THEN
    RAISE EXCEPTION 'Repeated content was collapsed across ingestion runs';
  END IF;
END
$lineage$;

ROLLBACK;
