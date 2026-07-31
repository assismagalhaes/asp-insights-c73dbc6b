BEGIN;

DO $test$
DECLARE
  table_name text;
  build_proc oid;
  immutable_definition text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['model_input_contracts','model_input_builds','model_input_matches','model_input_features','model_input_odds_snapshots'] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION '% is missing', table_name;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || table_name)) THEN
      RAISE EXCEPTION '% must have RLS', table_name;
    END IF;
    IF has_table_privilege('anon', 'public.' || table_name, 'SELECT') THEN
      RAISE EXCEPTION 'anon must not read %', table_name;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.model_input_contracts WHERE active) <> 4 THEN
    RAISE EXCEPTION 'four active model contracts are required';
  END IF;

  build_proc := to_regprocedure('public.create_model_input_build_v1(text,date,timestamptz,jsonb,jsonb,jsonb,text,jsonb,text[],jsonb)');
  IF build_proc IS NULL OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = build_proc) THEN
    RAISE EXCEPTION 'secure atomic build RPC is missing';
  END IF;
  IF has_function_privilege('anon', build_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute the build RPC';
  END IF;

  SELECT pg_get_functiondef('public.prevent_sealed_model_input_mutation_v1()'::regprocedure)
  INTO immutable_definition;
  IF immutable_definition NOT LIKE '%sealed model input builds are immutable%'
     OR immutable_definition NOT LIKE '%children of sealed model input builds are immutable%' THEN
    RAISE EXCEPTION 'sealed-build immutability contract is incomplete';
  END IF;
END
$test$;

ROLLBACK;
