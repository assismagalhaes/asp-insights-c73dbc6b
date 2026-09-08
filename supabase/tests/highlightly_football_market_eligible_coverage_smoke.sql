BEGIN;

DO $structure$
DECLARE
  refresh_definition text;
  report_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hl_football_market_coverage_daily'
      AND column_name = 'matches_provider_empty'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hl_football_market_coverage_daily'
      AND column_name = 'eligible_availability_pct'
  ) THEN
    RAISE EXCEPTION 'eligible market coverage columns are missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.refresh_highlightly_football_market_coverage(date,timestamp with time zone,timestamp with time zone)'::regprocedure
  ) INTO refresh_definition;
  SELECT pg_get_functiondef(
    'public.get_highlightly_football_market_coverage_report(integer,numeric)'::regprocedure
  ) INTO report_definition;

  IF refresh_definition NOT LIKE '%ODDS_PROVIDER_EMPTY%'
     OR refresh_definition NOT LIKE '%ODDS_QUOTE_UNAVAILABLE%'
     OR refresh_definition NOT LIKE '%records_received%'
     OR refresh_definition NOT LIKE '%matches_provider_empty%' THEN
    RAISE EXCEPTION 'provider-empty classification is incomplete';
  END IF;

  IF report_definition NOT LIKE '%raw_coverage_pct%'
     OR report_definition NOT LIKE '%eligible_coverage_pct%'
     OR report_definition NOT LIKE '%eligible_matches_due%'
     OR report_definition NOT LIKE '%coverage_basis%'
     OR report_definition NOT LIKE '%provider_unavailable%' THEN
    RAISE EXCEPTION 'raw/eligible market report contract is incomplete';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.get_highlightly_football_market_coverage_report(integer,numeric)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.get_highlightly_football_market_coverage_report(integer,numeric)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_football_market_coverage_report(integer,numeric)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'market coverage report privileges are invalid';
  END IF;
END
$structure$;

ROLLBACK;
