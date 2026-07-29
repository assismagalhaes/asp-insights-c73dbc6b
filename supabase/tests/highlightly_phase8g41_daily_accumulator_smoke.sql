BEGIN;

DO $structure$
DECLARE
  preview_proc oid;
  run_proc oid;
  report_proc oid;
BEGIN
  IF to_regclass('public.hl_training_accumulation_runs') IS NULL THEN
    RAISE EXCEPTION 'training accumulation run table is missing';
  END IF;
  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.hl_training_accumulation_runs'::regclass
  ) THEN
    RAISE EXCEPTION 'training accumulation run table must have RLS';
  END IF;
  IF has_table_privilege(
    'anon',
    'public.hl_training_accumulation_runs',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'anon must not read accumulation runs';
  END IF;
  IF NOT has_table_privilege(
    'authenticated',
    'public.hl_training_accumulation_runs',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'authenticated administrators need SELECT before RLS';
  END IF;

  preview_proc := to_regprocedure(
    'public.get_highlightly_training_accumulation_preview_v1(integer,integer,integer,integer,integer)'
  );
  run_proc := to_regprocedure(
    'public.run_highlightly_football_training_accumulation_v1(integer,integer,integer,integer,integer)'
  );
  report_proc := to_regprocedure(
    'public.get_highlightly_training_accumulation_report_v1(integer)'
  );
  IF preview_proc IS NULL OR run_proc IS NULL OR report_proc IS NULL THEN
    RAISE EXCEPTION 'one or more Phase 8G.4.1 RPCs are missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid IN (preview_proc, run_proc, report_proc)
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'all Phase 8G.4.1 RPCs must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', preview_proc, 'EXECUTE')
     OR has_function_privilege('anon', run_proc, 'EXECUTE')
     OR has_function_privilege('anon', report_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute Phase 8G.4.1 RPCs';
  END IF;
  IF has_function_privilege(
    'authenticated',
    preview_proc,
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    run_proc,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'authenticated must not execute accumulation write RPCs';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    report_proc,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'authenticated administrators must execute accumulation report';
  END IF;
  IF NOT has_function_privilege('service_role', preview_proc, 'EXECUTE')
     OR NOT has_function_privilege('service_role', run_proc, 'EXECUTE')
     OR NOT has_function_privilege(
       'service_role',
       report_proc,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'service_role must execute all Phase 8G.4.1 RPCs';
  END IF;
END
$structure$;

DO $contract$
DECLARE
  run_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.run_highlightly_football_training_accumulation_v1(integer,integer,integer,integer,integer)'
      ::regprocedure
  )
  INTO run_definition;

  IF run_definition NOT LIKE
       '%materialize_highlightly_football_score_labels_v1%'
     OR run_definition NOT LIKE
       '%backfill_highlightly_football_labeled_features_v2%'
     OR run_definition NOT LIKE
       '%build_highlightly_football_training_dataset_v1%'
     OR run_definition NOT LIKE
       '%get_highlightly_training_readiness_report_v1%'
     OR run_definition NOT LIKE '%provider_calls%'
     OR run_definition NOT LIKE '%automatic_training%'
     OR run_definition NOT LIKE '%automatic_predictions%' THEN
    RAISE EXCEPTION 'daily accumulator contract is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.sports_providers
    WHERE code = 'highlightly'
      AND enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;
END
$contract$;

ROLLBACK;
