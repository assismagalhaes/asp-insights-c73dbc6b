BEGIN;

DO $structure$
DECLARE
  materializer_oid regprocedure :=
    to_regprocedure(
      'public.materialize_highlightly_football_score_labels_v2(integer,integer,timestamptz,uuid)'
    );
  report_oid regprocedure :=
    to_regprocedure(
      'public.get_highlightly_training_accumulation_report_v2(integer)'
    );
  evaluator_oid regprocedure :=
    to_regprocedure(
      'public.evaluate_highlightly_football_training_dataset_v1(timestamptz,timestamptz,integer)'
    );
  materializer_source text;
  report_source text;
  evaluator_source text;
BEGIN
  IF materializer_oid IS NULL
     OR report_oid IS NULL
     OR evaluator_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.4.3 functions are missing';
  END IF;

  SELECT pg_get_functiondef(materializer_oid)
  INTO materializer_source;
  SELECT pg_get_functiondef(report_oid)
  INTO report_source;
  SELECT pg_get_functiondef(evaluator_oid)
  INTO evaluator_source;

  IF materializer_source NOT LIKE
       '%terminal_state_requires_manual_review%'
     OR materializer_source NOT LIKE
       '%participant_identity_collision%'
     OR materializer_source NOT LIKE
       '%'||quote_literal('rejected')||'%'
     OR materializer_source NOT LIKE
       '%permanent_for_label_version%'
     OR materializer_source NOT LIKE
       '%deterministic_rejections_excluded%' THEN
    RAISE EXCEPTION
      'deterministic rejection contract is incomplete';
  END IF;

  IF report_source NOT LIKE '%deterministic_rejections%'
     OR report_source NOT LIKE '%training_rows_excluded%'
     OR report_source NOT LIKE '%phase8g.4.3%' THEN
    RAISE EXCEPTION 'Phase 8G.4.3 report contract is incomplete';
  END IF;

  IF evaluator_source NOT LIKE
       '%label.quality_status = ''valid''%'
     OR strpos(evaluator_source, 'label.quality_status = ''valid''')
       > strpos(evaluator_source, 'LIMIT p_limit') THEN
    RAISE EXCEPTION
      'dataset evaluator must exclude rejected labels before LIMIT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid IN (materializer_oid, report_oid, evaluator_oid)
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'Phase 8G.4.3 functions must be SECURITY INVOKER';
  END IF;

  IF has_function_privilege(
       'anon',
       materializer_oid,
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       materializer_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       materializer_oid,
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       evaluator_oid,
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       evaluator_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       evaluator_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'materializer privileges are invalid';
  END IF;

  IF has_function_privilege('anon', report_oid, 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated',
       report_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       report_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'report privileges are invalid';
  END IF;

  IF (
    SELECT provider.enabled
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly'
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled';
  END IF;
END
$structure$;

DO $training_exclusion$
DECLARE
  training_index text;
BEGIN
  SELECT pg_get_indexdef(index_row.indexrelid)
  INTO training_index
  FROM pg_index AS index_row
  JOIN pg_class AS table_row
    ON table_row.oid = index_row.indrelid
  JOIN pg_class AS index_name
    ON index_name.oid = index_row.indexrelid
  JOIN pg_namespace AS schema_row
    ON schema_row.oid = table_row.relnamespace
  WHERE schema_row.nspname = 'public'
    AND table_row.relname = 'hl_match_labels'
    AND index_name.relname = 'idx_hl_match_labels_training';

  IF training_index IS NULL
     OR training_index NOT LIKE
       '%quality_status = ''valid''%' THEN
    RAISE EXCEPTION
      'rejected labels are not excluded from the training index';
  END IF;
END
$training_exclusion$;

ROLLBACK;
