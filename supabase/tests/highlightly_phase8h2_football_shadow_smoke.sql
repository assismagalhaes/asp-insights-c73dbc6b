BEGIN;

DO $test$
DECLARE
  candidates_proc oid;
  record_proc oid;
  table_has_rls boolean;
BEGIN
  IF to_regclass('public.football_model_shadow_runs') IS NULL THEN
    RAISE EXCEPTION 'football shadow run table is missing';
  END IF;
  SELECT relrowsecurity INTO table_has_rls
  FROM pg_class WHERE oid = 'public.football_model_shadow_runs'::regclass;
  IF NOT table_has_rls THEN
    RAISE EXCEPTION 'football shadow run table must have RLS';
  END IF;
  IF has_table_privilege('anon', 'public.football_model_shadow_runs', 'SELECT')
     OR has_table_privilege('anon', 'public.football_model_shadow_runs', 'INSERT') THEN
    RAISE EXCEPTION 'anon must not access football shadow runs';
  END IF;

  candidates_proc := to_regprocedure('public.get_football_model_input_candidates_v1(date)');
  record_proc := to_regprocedure('public.record_football_shadow_run_v1(uuid,text,jsonb,jsonb,jsonb)');
  IF candidates_proc IS NULL OR record_proc IS NULL THEN
    RAISE EXCEPTION 'Phase 8H.2 RPCs are missing';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = candidates_proc)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = record_proc) THEN
    RAISE EXCEPTION 'Phase 8H.2 RPCs must remain SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', candidates_proc, 'EXECUTE')
     OR has_function_privilege('authenticated', record_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 8H.2 RPC grants are too broad';
  END IF;
  IF NOT has_function_privilege('service_role', candidates_proc, 'EXECUTE')
     OR NOT has_function_privilege('service_role', record_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute the Phase 8H.2 RPCs';
  END IF;
END
$test$;

ROLLBACK;
