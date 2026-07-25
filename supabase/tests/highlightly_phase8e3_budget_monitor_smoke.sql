BEGIN;

DO $structure$
DECLARE
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'get_highlightly_phase8e_daily_request_usage',
    'requeue_highlightly_dead_phase8e_missing_match_id_jobs',
    'get_highlightly_match_lifecycle_operational_report_v2',
    'get_highlightly_collection_monitor_v2'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = function_name
        AND NOT procedure.prosecdef
    ) THEN
      RAISE EXCEPTION '% must exist as SECURITY INVOKER', function_name;
    END IF;
  END LOOP;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_phase8e_daily_request_usage(date)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.get_highlightly_phase8e_daily_request_usage(date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'daily lifecycle usage must be service-role only';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.requeue_highlightly_dead_phase8e_missing_match_id_jobs(integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.requeue_highlightly_dead_phase8e_missing_match_id_jobs(integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'matchId replay must be service-role only';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_phase8e_daily_request_usage(date)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.requeue_highlightly_dead_phase8e_missing_match_id_jobs(integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service role grants are missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_collection_monitor_v2(text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_collection_monitor_v2(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'monitor v2 grants are invalid';
  END IF;
END;
$structure$;

DO $contract$
DECLARE
  requeue_definition text;
BEGIN
  SELECT pg_get_functiondef(procedure.oid)
  INTO requeue_definition
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname =
      'requeue_highlightly_dead_phase8e_missing_match_id_jobs';

  IF requeue_definition NOT LIKE '%all lifecycle policies must be disabled%'
     OR requeue_definition NOT LIKE '%provider must be disabled%'
     OR requeue_definition NOT LIKE '%request_params ->> ''matchId''%'
     OR requeue_definition NOT LIKE '%request_params ->> ''id''%' THEN
    RAISE EXCEPTION 'safe matchId replay contract is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hl_match_lifecycle_policies AS lifecycle_policy
    WHERE lifecycle_policy.enabled
  ) THEN
    RAISE EXCEPTION 'all lifecycle policies must remain disabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly'
      AND provider.enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled';
  END IF;
END;
$contract$;

ROLLBACK;
