BEGIN;

DO $structure$
DECLARE
  function_name text;
  function_oid regprocedure;
  function_definition text;
BEGIN
  IF to_regclass(
    'public.hl_training_accumulation_runs'
  ) IS NULL THEN
    RAISE EXCEPTION
      'hl_training_accumulation_runs must exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_sports_matches_finished_keyset'
  ) THEN
    RAISE EXCEPTION 'finished match keyset index must exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname =
        'idx_hl_training_accumulation_runs_cycle_key'
  ) THEN
    RAISE EXCEPTION 'accumulation cycle key index must exist';
  END IF;

  FOREACH function_name IN ARRAY ARRAY[
    'public.get_highlightly_score_label_batch_preview_v1(integer,integer,timestamptz,uuid)',
    'public.materialize_highlightly_football_score_labels_v2(integer,integer,timestamptz,uuid)',
    'public.start_highlightly_training_accumulation_cycle_v2(text,integer,integer,integer,integer,integer,integer)',
    'public.checkpoint_highlightly_training_accumulation_cycle_v2(uuid,integer,jsonb,jsonb,jsonb)',
    'public.finish_highlightly_training_accumulation_cycle_v2(uuid,text,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'public.get_highlightly_training_accumulation_report_v2(integer)'
  ]
  LOOP
    function_oid := to_regprocedure(function_name);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'missing function %', function_name;
    END IF;
    IF (
      SELECT procedure.prosecdef
      FROM pg_proc AS procedure
      WHERE procedure.oid = function_oid
    ) THEN
      RAISE EXCEPTION '% must be SECURITY INVOKER', function_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY ARRAY[
    'public.get_highlightly_score_label_batch_preview_v1(integer,integer,timestamptz,uuid)',
    'public.materialize_highlightly_football_score_labels_v2(integer,integer,timestamptz,uuid)',
    'public.start_highlightly_training_accumulation_cycle_v2(text,integer,integer,integer,integer,integer,integer)',
    'public.checkpoint_highlightly_training_accumulation_cycle_v2(uuid,integer,jsonb,jsonb,jsonb)',
    'public.finish_highlightly_training_accumulation_cycle_v2(uuid,text,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'
  ]
  LOOP
    IF has_function_privilege('anon', function_name, 'EXECUTE')
       OR has_function_privilege(
         'authenticated',
         function_name,
         'EXECUTE'
       )
       OR NOT has_function_privilege(
         'service_role',
         function_name,
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'writer function privilege mismatch for %',
        function_name;
    END IF;
  END LOOP;

  function_name :=
    'public.get_highlightly_training_accumulation_report_v2(integer)';
  IF has_function_privilege('anon', function_name, 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated',
       function_name,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       function_name,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'report function privilege mismatch';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_highlightly_score_label_batch_preview_v1(integer,integer,timestamptz,uuid)'::regprocedure
  )
  INTO function_definition;
  IF function_definition NOT LIKE
       '%(match_row.kickoff_at, match_row.id)%'
     OR function_definition NOT LIKE
       '%existing_labels_excluded%'
     OR function_definition LIKE '%OFFSET%' THEN
    RAISE EXCEPTION
      'batch preview must use keyset pagination and exclude labels';
  END IF;

  SELECT pg_get_functiondef(
    'public.start_highlightly_training_accumulation_cycle_v2(text,integer,integer,integer,integer,integer,integer)'::regprocedure
  )
  INTO function_definition;
  IF function_definition NOT LIKE '%pg_advisory_xact_lock%'
     OR function_definition NOT LIKE '%p_batch_limit > 50%'
     OR function_definition NOT LIKE '%p_max_batches > 20%' THEN
    RAISE EXCEPTION
      'cycle starter must enforce lock and bounded limits';
  END IF;
END
$structure$;

DO $contract$
DECLARE
  preview jsonb;
  first_start jsonb;
  second_start jsonb;
  checkpoint jsonb;
  first_finish jsonb;
  second_finish jsonb;
  target_run_id uuid;
  cycle_key text := 'phase8g42:smoke:' || txid_current()::text;
  persisted_status text;
BEGIN
  IF (
    SELECT provider.enabled
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly'
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must remain disabled at rest';
  END IF;

  preview :=
    public.get_highlightly_score_label_batch_preview_v1(
      365,
      1,
      NULL,
      NULL
    );
  IF preview ->> 'quality_contract_version' <> 'phase8g.4.2'
     OR COALESCE(
       (preview #>> '{safeguards,provider_calls}')::integer,
       -1
     ) <> 0
     OR COALESCE(
       (preview #>> '{safeguards,labels_written}')::integer,
       -1
     ) <> 0 THEN
    RAISE EXCEPTION 'batch preview safeguard mismatch: %', preview;
  END IF;

  first_start :=
    public.start_highlightly_training_accumulation_cycle_v2(
      cycle_key,
      365,
      20,
      20,
      20,
      500,
      5
    );
  second_start :=
    public.start_highlightly_training_accumulation_cycle_v2(
      cycle_key,
      365,
      20,
      20,
      20,
      500,
      5
    );
  target_run_id := (first_start ->> 'run_id')::uuid;
  IF COALESCE((first_start ->> 'idempotent')::boolean, true)
     OR COALESCE(
       (second_start ->> 'idempotent')::boolean,
       false
     ) IS DISTINCT FROM true
     OR second_start ->> 'run_id' <> first_start ->> 'run_id' THEN
    RAISE EXCEPTION 'cycle start idempotency mismatch';
  END IF;

  checkpoint :=
    public.checkpoint_highlightly_training_accumulation_cycle_v2(
      target_run_id,
      1,
      '{"batches":[]}'::jsonb,
      '{"batches":[]}'::jsonb,
      jsonb_build_object(
        'kickoff_at',
        statement_timestamp(),
        'match_id',
        gen_random_uuid()
      )
    );
  IF (checkpoint ->> 'batches_completed')::integer <> 1 THEN
    RAISE EXCEPTION 'checkpoint was not persisted';
  END IF;

  first_finish :=
    public.finish_highlightly_training_accumulation_cycle_v2(
      target_run_id,
      'completed',
      1,
      '{"batches":[]}'::jsonb,
      '{"batches":[]}'::jsonb,
      '{"rows_inserted":0}'::jsonb,
      '{"readiness_pct":0}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb
    );
  second_finish :=
    public.finish_highlightly_training_accumulation_cycle_v2(
      target_run_id,
      'completed',
      1,
      '{"batches":[]}'::jsonb,
      '{"batches":[]}'::jsonb,
      '{"rows_inserted":0}'::jsonb,
      '{"readiness_pct":0}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb
    );
  SELECT accumulation.status
  INTO persisted_status
  FROM public.hl_training_accumulation_runs AS accumulation
  WHERE accumulation.id = target_run_id;
  IF persisted_status <> 'completed'
     OR COALESCE(
       (second_finish ->> 'idempotent')::boolean,
       false
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'cycle finalization idempotency mismatch';
  END IF;

  IF (
    SELECT count(*)
    FROM public.hl_training_accumulation_runs AS accumulation
    WHERE accumulation.diagnostics ->> 'cycle_key' = cycle_key
  ) <> 1 THEN
    RAISE EXCEPTION 'cycle key uniqueness mismatch';
  END IF;
END
$contract$;

ROLLBACK;
