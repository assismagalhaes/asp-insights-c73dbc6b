BEGIN;

DO $structure$
DECLARE
  function_definition text;
BEGIN
  IF to_regprocedure(
    'public.get_highlightly_odds_quality_report_v2(timestamp with time zone,timestamp with time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'get_highlightly_odds_quality_report_v2 is missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_odds_quality_report_v2(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_odds_quality_report_v2(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_odds_quality_report_v2(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'odds quality report v2 privileges are invalid';
  END IF;

  IF (
    SELECT procedure.prosecdef
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'public.get_highlightly_odds_quality_report_v2(timestamp with time zone,timestamp with time zone)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'odds quality report v2 must remain SECURITY INVOKER';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_highlightly_odds_quality_report_v2(timestamp with time zone,timestamp with time zone)'::regprocedure
  )
  INTO function_definition;

  IF function_definition NOT LIKE '%raw_availability_pct%'
     OR function_definition NOT LIKE '%eligible_availability_pct%'
     OR function_definition NOT LIKE '%provider_empty_pct%'
     OR function_definition NOT LIKE '%provider_supported_matches%'
     OR function_definition NOT LIKE '%phase8d.1%' THEN
    RAISE EXCEPTION 'Phase 8D.1 quality contract is incomplete';
  END IF;
END
$structure$;

ROLLBACK;
