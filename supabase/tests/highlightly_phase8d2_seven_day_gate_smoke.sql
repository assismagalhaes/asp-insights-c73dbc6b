BEGIN;

DO $structure$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(function_row.oid)
  INTO function_definition
  FROM pg_proc AS function_row
  WHERE function_row.oid =
    'public.get_highlightly_odds_league_coverage_report(integer,integer)'::regprocedure;

  IF function_definition NOT LIKE '%observed_days < p_days%' THEN
    RAISE EXCEPTION 'league recommendation must require the full observation window';
  END IF;
  IF function_definition NOT LIKE '%matches_due < p_min_matches%' THEN
    RAISE EXCEPTION 'league recommendation must require the minimum sample';
  END IF;
  IF function_definition NOT LIKE '%' || quote_literal('automatic_exclusions') || ', false%' THEN
    RAISE EXCEPTION 'automatic exclusions must remain disabled';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.get_highlightly_odds_league_coverage_report(integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute the league coverage report';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_odds_league_coverage_report(integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must retain gated report access';
  END IF;
  IF (
    SELECT function_row.prosecdef
    FROM pg_proc AS function_row
    WHERE function_row.oid =
      'public.get_highlightly_odds_league_coverage_report(integer,integer)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'league coverage report must remain SECURITY INVOKER';
  END IF;
END
$structure$;

ROLLBACK;
