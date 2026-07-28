BEGIN;

DO $structure$
DECLARE
  report_definition text;
BEGIN
  IF to_regclass('public.hl_odds_league_coverage_daily') IS NULL THEN
    RAISE EXCEPTION 'hl_odds_league_coverage_daily is missing';
  END IF;

  IF to_regprocedure(
    'public.refresh_highlightly_odds_league_coverage(date,timestamp with time zone,timestamp with time zone)'
  ) IS NULL OR to_regprocedure(
    'public.get_highlightly_odds_league_coverage_report(integer,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Phase 8D.2 RPCs are missing';
  END IF;

  IF has_table_privilege(
    'anon',
    'public.hl_odds_league_coverage_daily',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'anon must not read league coverage snapshots';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.refresh_highlightly_odds_league_coverage(date,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.refresh_highlightly_odds_league_coverage(date,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.refresh_highlightly_odds_league_coverage(date,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'league coverage refresh privileges are invalid';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_odds_league_coverage_report(integer,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_odds_league_coverage_report(integer,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_odds_league_coverage_report(integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'league coverage report privileges are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    WHERE procedure.oid IN (
      'public.refresh_highlightly_odds_league_coverage(date,timestamp with time zone,timestamp with time zone)'::regprocedure,
      'public.get_highlightly_odds_league_coverage_report(integer,integer)'::regprocedure
    )
      AND procedure.prosecdef
  ) THEN
    RAISE EXCEPTION 'Phase 8D.2 RPCs must remain SECURITY INVOKER';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_highlightly_odds_league_coverage_report(integer,integer)'::regprocedure
  )
  INTO report_definition;

  IF report_definition NOT LIKE '%insufficient_sample%'
     OR report_definition NOT LIKE '%candidate_t60m_only%'
     OR report_definition NOT LIKE '%monitor_provider_coverage%'
     OR report_definition NOT LIKE '%keep_full_cadence%'
     OR report_definition NOT LIKE '%automatic_exclusions%'
     OR report_definition NOT LIKE '%false%' THEN
    RAISE EXCEPTION 'league coverage recommendations are incomplete';
  END IF;
END
$structure$;

ROLLBACK;
