BEGIN;

DO $structure$
DECLARE
  target_count integer;
  candidates_definition text;
  report_definition text;
BEGIN
  IF to_regclass('public.hl_odds_quality_targets') IS NULL THEN
    RAISE EXCEPTION 'hl_odds_quality_targets is missing';
  END IF;

  SELECT count(*)
  INTO target_count
  FROM public.hl_odds_quality_targets AS target
  JOIN public.sports AS sport ON sport.id = target.sport_id
  WHERE sport.code IN ('football', 'baseball', 'basketball')
    AND target.enabled;

  IF target_count <> 3 THEN
    RAISE EXCEPTION 'expected three enabled odds targets, got %', target_count;
  END IF;

  IF to_regprocedure(
    'public.get_highlightly_odds_refresh_candidates(timestamp with time zone,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'get_highlightly_odds_refresh_candidates is missing';
  END IF;

  IF to_regprocedure(
    'public.get_highlightly_odds_quality_report(timestamp with time zone,timestamp with time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'get_highlightly_odds_quality_report is missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_odds_refresh_candidates(timestamp with time zone,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.get_highlightly_odds_refresh_candidates(timestamp with time zone,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_odds_refresh_candidates(timestamp with time zone,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'odds refresh candidate privileges are invalid';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_odds_quality_report(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_odds_quality_report(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_odds_quality_report(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'odds quality report privileges are invalid';
  END IF;

  IF has_table_privilege('anon', 'public.hl_odds_quality_targets', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read odds quality targets';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_highlightly_odds_refresh_candidates(timestamp with time zone,integer)'::regprocedure
  )
  INTO candidates_definition;
  SELECT pg_get_functiondef(
    'public.get_highlightly_odds_quality_report(timestamp with time zone,timestamp with time zone)'::regprocedure
  )
  INTO report_definition;

  IF candidates_definition NOT LIKE '%t24h%'
     OR candidates_definition NOT LIKE '%t6h%'
     OR candidates_definition NOT LIKE '%t60m%'
     OR candidates_definition NOT LIKE '%phase8d:odds:%' THEN
    RAISE EXCEPTION 'odds refresh horizons or idempotent key are missing';
  END IF;

  IF report_definition NOT LIKE '%bookmaker_missing%'
     OR report_definition NOT LIKE '%market_missing%'
     OR report_definition NOT LIKE '%provider_empty%'
     OR report_definition NOT LIKE '%quality_rejected%' THEN
    RAISE EXCEPTION 'deterministic odds causes are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'get_highlightly_odds_refresh_candidates',
        'get_highlightly_odds_quality_report'
      )
      AND procedure.prosecdef
  ) THEN
    RAISE EXCEPTION 'Phase 8D functions must remain SECURITY INVOKER';
  END IF;
END
$structure$;

ROLLBACK;
