BEGIN;

DO $structure$
DECLARE
  report_proc oid;
  readiness_policy public.hl_training_readiness_policies%ROWTYPE;
BEGIN
  IF to_regclass('public.hl_training_readiness_policies') IS NULL THEN
    RAISE EXCEPTION 'training readiness policy table is missing';
  END IF;
  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.hl_training_readiness_policies'::regclass
  ) THEN
    RAISE EXCEPTION 'training readiness policy table must have RLS';
  END IF;
  IF has_table_privilege(
    'anon',
    'public.hl_training_readiness_policies',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'anon must not read training readiness policies';
  END IF;
  IF NOT has_table_privilege(
    'authenticated',
    'public.hl_training_readiness_policies',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'authenticated administrators need table SELECT before RLS';
  END IF;

  report_proc := to_regprocedure(
    'public.get_highlightly_training_readiness_report_v1(text,integer)'
  );
  IF report_proc IS NULL THEN
    RAISE EXCEPTION 'training readiness report RPC is missing';
  END IF;
  IF (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = report_proc
  ) THEN
    RAISE EXCEPTION 'training readiness report must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', report_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute training readiness report';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    report_proc,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'authenticated administrators must execute readiness report';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    report_proc,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute readiness report';
  END IF;

  SELECT readiness.*
  INTO readiness_policy
  FROM public.hl_training_readiness_policies AS readiness
  JOIN public.hl_training_dataset_specs AS dataset_spec
    ON dataset_spec.id = readiness.dataset_spec_id
  JOIN public.sports AS sport
    ON sport.id = dataset_spec.sport_id
   AND sport.code = 'football'
  WHERE dataset_spec.code = 'highlightly_football_prematch_score'
    AND dataset_spec.version = '1.0.0'
  LIMIT 1;

  IF readiness_policy.id IS NULL
     OR readiness_policy.status <> 'draft'
     OR readiness_policy.is_enabled THEN
    RAISE EXCEPTION 'readiness policy must remain draft and disabled';
  END IF;
  IF readiness_policy.minimum_total_rows <> 500
     OR readiness_policy.minimum_train_rows <> 350
     OR readiness_policy.minimum_validation_rows <> 75
     OR readiness_policy.minimum_test_rows <> 75
     OR readiness_policy.minimum_distinct_competitions <> 10
     OR readiness_policy.minimum_observation_days <> 60
     OR readiness_policy.minimum_outcome_class_rows <> 50 THEN
    RAISE EXCEPTION 'readiness thresholds differ from Phase 8G.4';
  END IF;
END
$structure$;

DO $contract$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_highlightly_training_readiness_report_v1(text,integer)'
      ::regprocedure
  )
  INTO function_definition;

  IF function_definition NOT LIKE '%data_ready%'
     OR function_definition NOT LIKE '%manual_training_authorized%'
     OR function_definition NOT LIKE '%outcome_distribution%'
     OR function_definition NOT LIKE '%latest_build_run_only%'
     OR function_definition NOT LIKE '%automatic_training%'
     OR function_definition NOT LIKE '%automatic_predictions%' THEN
    RAISE EXCEPTION 'readiness report contract is incomplete';
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
