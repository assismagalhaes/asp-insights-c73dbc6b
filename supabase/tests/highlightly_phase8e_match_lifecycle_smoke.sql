BEGIN;

DO $structure$
DECLARE
  policy_count integer;
BEGIN
  IF to_regclass('public.hl_match_lifecycle_policies') IS NULL
     OR to_regclass('public.hl_match_lifecycle_states') IS NULL
     OR to_regclass('public.hl_match_lifecycle_resources') IS NULL THEN
    RAISE EXCEPTION 'one or more Phase 8E lifecycle tables are missing';
  END IF;

  SELECT count(*)
  INTO policy_count
  FROM public.hl_match_lifecycle_policies AS lifecycle_policy
  JOIN public.sports AS sport
    ON sport.id = lifecycle_policy.sport_id
  WHERE sport.code IN ('football', 'baseball', 'basketball')
    AND NOT lifecycle_policy.enabled;

  IF policy_count <> 3 THEN
    RAISE EXCEPTION 'expected three disabled lifecycle policies, got %', policy_count;
  END IF;

  IF to_regprocedure(
    'public.get_highlightly_match_lifecycle_candidates(timestamp with time zone,integer,boolean)'
  ) IS NULL OR to_regprocedure(
    'public.refresh_highlightly_match_lifecycle_states(timestamp with time zone)'
  ) IS NULL OR to_regprocedure(
    'public.get_highlightly_match_lifecycle_report(timestamp with time zone,timestamp with time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'one or more Phase 8E lifecycle RPCs are missing';
  END IF;

  IF has_table_privilege('anon', 'public.hl_match_lifecycle_policies', 'SELECT')
     OR has_table_privilege('anon', 'public.hl_match_lifecycle_states', 'SELECT')
     OR has_table_privilege('anon', 'public.hl_match_lifecycle_resources', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read lifecycle tables';
  END IF;

  IF NOT has_table_privilege(
    'authenticated',
    'public.hl_match_lifecycle_states',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.hl_match_lifecycle_states',
    'INSERT'
  ) THEN
    RAISE EXCEPTION 'authenticated lifecycle table privileges are invalid';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_match_lifecycle_candidates(timestamp with time zone,integer,boolean)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.get_highlightly_match_lifecycle_candidates(timestamp with time zone,integer,boolean)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_match_lifecycle_candidates(timestamp with time zone,integer,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'lifecycle candidate privileges are invalid';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.refresh_highlightly_match_lifecycle_states(timestamp with time zone)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.refresh_highlightly_match_lifecycle_states(timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.refresh_highlightly_match_lifecycle_states(timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'lifecycle refresh privileges are invalid';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_match_lifecycle_report(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_match_lifecycle_report(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_match_lifecycle_report(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'lifecycle report privileges are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'get_highlightly_match_lifecycle_candidates',
        'refresh_highlightly_match_lifecycle_states',
        'get_highlightly_match_lifecycle_report'
      )
      AND procedure.prosecdef
  ) THEN
    RAISE EXCEPTION 'Phase 8E functions must remain SECURITY INVOKER';
  END IF;
END
$structure$;

DO $contract$
DECLARE
  candidates_definition text;
  refresh_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_highlightly_match_lifecycle_candidates(timestamp with time zone,integer,boolean)'::regprocedure
  )
  INTO candidates_definition;

  SELECT pg_get_functiondef(
    'public.refresh_highlightly_match_lifecycle_states(timestamp with time zone)'::regprocedure
  )
  INTO refresh_definition;

  IF candidates_definition NOT LIKE '%phase8e:lifecycle:%'
     OR candidates_definition NOT LIKE '%post15m%'
     OR candidates_definition NOT LIKE '%post2h%'
     OR candidates_definition NOT LIKE '%post24h%'
     OR candidates_definition NOT LIKE '%live-%'
     OR candidates_definition NOT LIKE '%p_include_disabled%' THEN
    RAISE EXCEPTION 'lifecycle cadence, preview flag or idempotent key is incomplete';
  END IF;

  IF candidates_definition NOT LIKE '%FootballLiveEventsController_getLiveEvents%'
     OR candidates_definition NOT LIKE '%BaseballBoxScoresController_getBoxScores%'
     OR candidates_definition NOT LIKE '%BasketballStatisticsController_getStatistics%'
     OR candidates_definition NOT LIKE '%HighlightsController_getHighlights%' THEN
    RAISE EXCEPTION 'sport lifecycle endpoint matrix is incomplete';
  END IF;

  IF refresh_definition NOT LIKE '%complete_with_exceptions%'
     OR refresh_definition NOT LIKE '%finished_pending_detail%'
     OR refresh_definition NOT LIKE '%missing_resources%' THEN
    RAISE EXCEPTION 'lifecycle completion state math is incomplete';
  END IF;

END
$contract$;

ROLLBACK;
