CREATE OR REPLACE FUNCTION public.get_highlightly_daily_request_usage(
  p_provider_id uuid,
  p_request_date date
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(SUM(usage.requests_used), 0)::bigint
  FROM public.hl_rate_limit_usage AS usage
  WHERE usage.provider_id = p_provider_id
    AND usage.request_date = p_request_date;
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_daily_request_usage(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_daily_request_usage(uuid, date)
  TO service_role;

NOTIFY pgrst, 'reload schema';