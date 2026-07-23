BEGIN;

DO $structure$
DECLARE
  candidates_regprocedure regprocedure;
  report_regprocedure regprocedure;
BEGIN
  candidates_regprocedure := to_regprocedure(
    'public.get_highlightly_match_lifecycle_candidates_v2(timestamptz,integer,boolean)'
  );
  report_regprocedure := to_regprocedure(
    'public.get_highlightly_match_lifecycle_report_v2(timestamptz,timestamptz)'
  );

  IF candidates_regprocedure IS NULL OR report_regprocedure IS NULL THEN
    RAISE EXCEPTION 'Phase 8E empty-response RPCs are missing';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = candidates_regprocedure)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = report_regprocedure) THEN
    RAISE EXCEPTION 'Phase 8E hotfix RPCs must remain SECURITY INVOKER';
  END IF;

  IF has_function_privilege(
    'anon',
    candidates_regprocedure,
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    candidates_regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Lifecycle candidate v2 RPC leaked to a client role';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    candidates_regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Lifecycle candidate v2 RPC is unavailable to service_role';
  END IF;

  IF has_function_privilege(
    'anon',
    report_regprocedure,
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    report_regprocedure,
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    report_regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Lifecycle report v2 privileges are invalid';
  END IF;

  IF pg_get_function_arguments(report_regprocedure) NOT LIKE '%36:00:00%'
     AND pg_get_function_arguments(report_regprocedure) NOT LIKE '%36 hours%' THEN
    RAISE EXCEPTION 'Lifecycle report v2 does not default to 36 historical hours';
  END IF;

  IF NOT pg_get_functiondef(candidates_regprocedure)
    LIKE '%provider_unavailable%' OR NOT pg_get_functiondef(candidates_regprocedure)
    LIKE '%not_supported%' THEN
    RAISE EXCEPTION 'Lifecycle candidate v2 does not suppress terminal empty resources';
  END IF;
END;
$structure$;

DO $contract$
DECLARE
  football_id uuid;
  provider_is_enabled boolean;
BEGIN
  SELECT sport.id
  INTO football_id
  FROM public.sports AS sport
  WHERE sport.code = 'football';

  IF football_id IS NULL THEN
    RAISE EXCEPTION 'Football seed is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hl_match_lifecycle_policies AS lifecycle_policy
    WHERE lifecycle_policy.enabled
  ) THEN
    RAISE EXCEPTION 'Phase 8E rollout policies must remain disabled';
  END IF;

  SELECT sports_provider.enabled
  INTO provider_is_enabled
  FROM public.sports_providers AS sports_provider
  WHERE sports_provider.code = 'highlightly';

  IF provider_is_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;
END;
$contract$;

ROLLBACK;
