BEGIN;

DO $structure$
DECLARE
  function_oid regprocedure := to_regprocedure(
    'public.get_highlightly_daily_request_usage(uuid,date)'
  );
BEGIN
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'get_highlightly_daily_request_usage(uuid,date) is missing';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = function_oid) THEN
    RAISE EXCEPTION 'daily usage aggregate must remain SECURITY INVOKER';
  END IF;

  IF has_function_privilege('anon', function_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'daily usage aggregate leaked outside service_role';
  END IF;

  IF NOT has_function_privilege('service_role', function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute daily usage aggregate';
  END IF;
END
$structure$;

DO $aggregate$
DECLARE
  provider_uuid uuid;
  aggregate_usage bigint;
  test_date date := DATE '2099-12-31';
BEGIN
  SELECT id
  INTO provider_uuid
  FROM public.sports_providers
  WHERE code = 'highlightly';

  IF provider_uuid IS NULL THEN
    RAISE EXCEPTION 'Highlightly provider seed is missing';
  END IF;

  INSERT INTO public.hl_rate_limit_usage (
    provider_id,
    endpoint_key,
    request_date,
    requests_used
  )
  SELECT
    provider_uuid,
    'smoke.daily-usage.' || series.value,
    test_date,
    1
  FROM generate_series(1, 1001) AS series(value);

  SELECT public.get_highlightly_daily_request_usage(provider_uuid, test_date)
  INTO aggregate_usage;

  IF aggregate_usage <> 1001 THEN
    RAISE EXCEPTION 'expected usage 1001 above the REST row cap, got %', aggregate_usage;
  END IF;
END
$aggregate$;

ROLLBACK;
