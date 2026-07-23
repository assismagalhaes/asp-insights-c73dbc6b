BEGIN;

DO $structure$
DECLARE
  control_oid regprocedure :=
    to_regprocedure('public.set_highlightly_match_lifecycle_policy(text,boolean)');
  report_oid regprocedure :=
    to_regprocedure(
      'public.get_highlightly_match_lifecycle_operational_report(timestamptz,timestamptz)'
    );
  control_definition text;
  report_definition text;
BEGIN
  IF control_oid IS NULL OR report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8E.1 RPCs are missing';
  END IF;

  IF (SELECT function_row.prosecdef FROM pg_proc AS function_row WHERE function_row.oid = control_oid)
     OR (SELECT function_row.prosecdef FROM pg_proc AS function_row WHERE function_row.oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8E.1 RPCs must remain SECURITY INVOKER';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.set_highlightly_match_lifecycle_policy(text,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.set_highlightly_match_lifecycle_policy(text,boolean)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.set_highlightly_match_lifecycle_policy(text,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Lifecycle policy control privileges are invalid';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.get_highlightly_match_lifecycle_operational_report(timestamptz,timestamptz)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.get_highlightly_match_lifecycle_operational_report(timestamptz,timestamptz)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.get_highlightly_match_lifecycle_operational_report(timestamptz,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Lifecycle operational report privileges are invalid';
  END IF;

  SELECT pg_get_functiondef(control_oid) INTO control_definition;
  SELECT pg_get_functiondef(report_oid) INTO report_definition;

  IF position('FOR UPDATE' IN upper(control_definition)) = 0
     OR position('PROVIDER MUST BE DISABLED' IN upper(control_definition)) = 0 THEN
    RAISE EXCEPTION 'Lifecycle policy control lost the provider safety gate';
  END IF;

  IF position('INTERVAL ''7 DAYS''' IN upper(report_definition)) = 0
     OR position('PHASE8E-LIFECYCLE-%' IN upper(report_definition)) = 0
     OR position('''MAX_JOBS'', 200' IN upper(report_definition)) = 0
     OR position('''REQUEST_BUDGET'', 300' IN upper(report_definition)) = 0
     OR position('''DAILY_RESERVE'', 750' IN upper(report_definition)) = 0 THEN
    RAISE EXCEPTION 'Lifecycle operational report lost its bounded contract';
  END IF;
END;
$structure$;

DO $at_rest$
DECLARE
  provider_enabled boolean;
  enabled_policies integer;
BEGIN
  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';

  SELECT count(*)::integer
  INTO enabled_policies
  FROM public.hl_match_lifecycle_policies AS lifecycle_policy
  WHERE lifecycle_policy.enabled;

  IF COALESCE(provider_enabled, true) THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;

  IF enabled_policies <> 0 THEN
    RAISE EXCEPTION 'Phase 8E.1 deployment must not enable lifecycle policies';
  END IF;

  IF to_regclass('public.idx_hl_ingestion_jobs_phase8e_created') IS NULL
     OR to_regclass('public.idx_hl_match_lifecycle_resources_phase8e_updated') IS NULL THEN
    RAISE EXCEPTION 'Phase 8E.1 report indexes are missing';
  END IF;
END;
$at_rest$;

ROLLBACK;
