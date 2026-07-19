CREATE OR REPLACE FUNCTION public.accept_highlightly_unavailable_odds_issues()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  accepted_count integer;
BEGIN
  UPDATE public.hl_data_quality_issues
  SET
    resolution_status = 'accepted',
    resolved_at = now(),
    updated_at = now()
  WHERE endpoint_key = 'football.FootballOddsController_getOddsV2'
    AND issue_code = 'ODDS_QUOTE_INVALID'
    AND resolution_status = 'open'
    AND COALESCE(details #>> '{context,odd}', '') ~ '^[+]?[0-9]+(?:[.][0-9]+)?$'
    AND (details #>> '{context,odd}')::numeric = 1;

  GET DIAGNOSTICS accepted_count = ROW_COUNT;
  RETURN accepted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_highlightly_unavailable_odds_issues() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_highlightly_unavailable_odds_issues() FROM anon;
REVOKE ALL ON FUNCTION public.accept_highlightly_unavailable_odds_issues() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_highlightly_unavailable_odds_issues() TO service_role;

COMMENT ON FUNCTION public.accept_highlightly_unavailable_odds_issues() IS
  'Accepts only open football ODDS_QUOTE_INVALID issues whose provider price is exactly the unavailable sentinel 1.00.';