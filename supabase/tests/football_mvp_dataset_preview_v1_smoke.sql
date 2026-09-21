BEGIN;

DO $test$
DECLARE
  preview jsonb;
  is_security_definer boolean;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
  service_can_execute boolean;
BEGIN
  SELECT pro.prosecdef INTO is_security_definer
  FROM pg_proc AS pro
  WHERE pro.oid = 'public.get_football_mvp_dataset_preview_v1(timestamptz,timestamptz,integer,text)'::regprocedure;

  IF is_security_definer IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Preview function must be SECURITY INVOKER';
  END IF;

  SELECT
    has_function_privilege('anon', 'public.get_football_mvp_dataset_preview_v1(timestamptz,timestamptz,integer,text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.get_football_mvp_dataset_preview_v1(timestamptz,timestamptz,integer,text)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.get_football_mvp_dataset_preview_v1(timestamptz,timestamptz,integer,text)', 'EXECUTE')
  INTO anon_can_execute, authenticated_can_execute, service_can_execute;

  IF anon_can_execute OR authenticated_can_execute OR NOT service_can_execute THEN
    RAISE EXCEPTION 'Unexpected preview function privileges';
  END IF;

  preview := public.get_football_mvp_dataset_preview_v1(
    '1900-01-01 00:00:00+00',
    '1900-01-02 00:00:00+00',
    10,
    't24h'
  );

  IF (preview ->> 'total_matches')::integer <> 0
     OR (preview ->> 'provider_calls')::integer <> 0
     OR (preview ->> 'automatic_build')::boolean IS DISTINCT FROM false
     OR preview ->> 'dataset_spec' <> 'football_mvp_pl_laliga_j1@1.0.0' THEN
    RAISE EXCEPTION 'Empty preview contract is invalid: %', preview;
  END IF;
END
$test$;

ROLLBACK;
