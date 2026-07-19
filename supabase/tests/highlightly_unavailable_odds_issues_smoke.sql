BEGIN;

DO $structure$
BEGIN
  IF to_regprocedure('public.accept_highlightly_unavailable_odds_issues()') IS NULL THEN
    RAISE EXCEPTION 'accept_highlightly_unavailable_odds_issues() is missing';
  END IF;
  IF has_function_privilege('anon', 'public.accept_highlightly_unavailable_odds_issues()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute unavailable odds acceptance';
  END IF;
  IF has_function_privilege('authenticated', 'public.accept_highlightly_unavailable_odds_issues()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute unavailable odds acceptance';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.accept_highlightly_unavailable_odds_issues()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute unavailable odds acceptance';
  END IF;
END;
$structure$;

DO $behavior$
DECLARE
  sentinel_id uuid := gen_random_uuid();
  real_error_id uuid := gen_random_uuid();
  accepted_count integer;
BEGIN
  INSERT INTO public.hl_data_quality_issues (
    id, endpoint_key, sport, severity, issue_code, details, resolution_status
  ) VALUES
  (
    sentinel_id,
    'football.FootballOddsController_getOddsV2',
    'football',
    'error',
    'ODDS_QUOTE_INVALID',
    '{"context":{"odd":1,"market":"Total Goals 2.5"}}'::jsonb,
    'open'
  ),
  (
    real_error_id,
    'football.FootballOddsController_getOddsV2',
    'football',
    'error',
    'ODDS_QUOTE_INVALID',
    '{"context":{"odd":0.5,"market":"Total Goals 2.5"}}'::jsonb,
    'open'
  );

  SELECT public.accept_highlightly_unavailable_odds_issues() INTO accepted_count;
  IF accepted_count < 1 THEN
    RAISE EXCEPTION 'sentinel issue was not accepted';
  END IF;
  IF (SELECT resolution_status FROM public.hl_data_quality_issues WHERE id = sentinel_id) <> 'accepted' THEN
    RAISE EXCEPTION 'sentinel issue status is not accepted';
  END IF;
  IF (SELECT resolution_status FROM public.hl_data_quality_issues WHERE id = real_error_id) <> 'open' THEN
    RAISE EXCEPTION 'real invalid odd must remain open';
  END IF;
END;
$behavior$;

ROLLBACK;
