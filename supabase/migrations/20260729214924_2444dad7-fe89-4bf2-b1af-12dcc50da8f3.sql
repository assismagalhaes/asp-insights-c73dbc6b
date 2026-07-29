CREATE OR REPLACE FUNCTION
  public.run_highlightly_football_training_accumulation_v1(
    p_days integer DEFAULT 365,
    p_label_limit integer DEFAULT 200,
    p_feature_limit integer DEFAULT 200,
    p_max_candidates_per_kickoff integer DEFAULT 200,
    p_dataset_limit integer DEFAULT 5000
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  football_id uuid;
  provider_enabled boolean;
  provider_enabled_after boolean;
  target_run_id uuid;
  window_to timestamptz := statement_timestamp();
  window_from timestamptz;
  v_label_result jsonb := '{}'::jsonb;
  v_feature_result jsonb := '{}'::jsonb;
  v_dataset_result jsonb := '{}'::jsonb;
  v_readiness_result jsonb := '{}'::jsonb;
  final_status text;
  error_payload jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.get_highlightly_training_accumulation_preview_v1(
    p_days,
    p_label_limit,
    p_feature_limit,
    p_max_candidates_per_kickoff,
    p_dataset_limit
  );

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must be disabled before accumulation'
      USING ERRCODE = '55000';
  END IF;

  SELECT sport.id
  INTO football_id
  FROM public.sports AS sport
  WHERE sport.code = 'football';
  IF football_id IS NULL THEN
    RAISE EXCEPTION 'Football sport must be installed'
      USING ERRCODE = '55000';
  END IF;

  window_from := window_to - make_interval(days => p_days);
  INSERT INTO public.hl_training_accumulation_runs (
    sport_id,
    window_days,
    label_limit,
    feature_limit,
    max_candidates_per_kickoff,
    dataset_limit,
    diagnostics
  )
  VALUES (
    football_id,
    p_days,
    p_label_limit,
    p_feature_limit,
    p_max_candidates_per_kickoff,
    p_dataset_limit,
    jsonb_build_object(
      'phase', '8G.4.1',
      'quality_contract_version', 'phase8g.4.1',
      'generation_mode', 'daily_stored_data_accumulation',
      'global_lock_required', true,
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  )
  RETURNING id INTO target_run_id;

  BEGIN
    v_label_result :=
      public.materialize_highlightly_football_score_labels_v1(
        p_days,
        p_label_limit
      );
    v_feature_result :=
      public.backfill_highlightly_football_labeled_features_v2(
        p_feature_limit,
        p_max_candidates_per_kickoff
      );
    v_dataset_result :=
      public.build_highlightly_football_training_dataset_v1(
        window_from,
        window_to,
        p_dataset_limit
      );
    v_readiness_result :=
      public.get_highlightly_training_readiness_report_v1(
        'football',
        p_days
      );

    SELECT provider.enabled
    INTO provider_enabled_after
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly';
    IF provider_enabled_after IS DISTINCT FROM false THEN
      RAISE EXCEPTION
        'Highlightly provider changed during stored-data accumulation'
        USING ERRCODE = '55000';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      error_payload := jsonb_build_object(
        'sqlstate', SQLSTATE,
        'error', SQLERRM
      );
      UPDATE public.hl_training_accumulation_runs AS accumulation
      SET
        status = 'failed',
        provider_calls = 0,
        automatic_training = false,
        automatic_predictions = false,
        finished_at = statement_timestamp(),
        diagnostics = accumulation.diagnostics
          || jsonb_build_object('failure', error_payload)
      WHERE accumulation.id = target_run_id;

      RETURN jsonb_build_object(
        'phase', '8G.4.1',
        'quality_contract_version', 'phase8g.4.1',
        'run_id', target_run_id,
        'status', 'failed',
        'error', error_payload,
        'safeguards', jsonb_build_object(
          'provider_calls', 0,
          'automatic_training', false,
          'automatic_predictions', false
        ),
        'recommendation', 'review_accumulation_failure'
      );
  END;

  final_status := CASE
    WHEN COALESCE(
      (v_label_result ->> 'labels_blocked')::integer,
      0
    ) > 0
      OR COALESCE(
        (v_feature_result ->> 'kickoff_groups_failed')::integer,
        0
      ) > 0
      OR COALESCE(
        (v_dataset_result ->> 'rows_blocked')::integer,
        0
      ) > 0
      THEN 'completed_with_exceptions'
    ELSE 'completed'
  END;

  UPDATE public.hl_training_accumulation_runs AS accumulation
  SET
    status = final_status,
    label_result = v_label_result,
    feature_result = v_feature_result,
    dataset_result = v_dataset_result,
    readiness_result = v_readiness_result,
    provider_calls = 0,
    automatic_training = false,
    automatic_predictions = false,
    finished_at = statement_timestamp(),
    diagnostics = accumulation.diagnostics || jsonb_build_object(
      'labels_inserted',
        COALESCE((v_label_result ->> 'labels_inserted')::integer, 0),
      'labeled_snapshots_created',
        COALESCE(
          (v_feature_result ->> 'labeled_snapshots_created')::integer,
          0
        ),
      'dataset_rows_inserted',
        COALESCE((v_dataset_result ->> 'rows_inserted')::integer, 0),
      'readiness_pct',
        COALESCE((v_readiness_result ->> 'readiness_pct')::numeric, 0)
    )
  WHERE accumulation.id = target_run_id;

  RETURN jsonb_build_object(
    'phase', '8G.4.1',
    'quality_contract_version', 'phase8g.4.1',
    'run_id', target_run_id,
    'status', final_status,
    'sport', 'football',
    'window_days', p_days,
    'components', jsonb_build_object(
      'labels', v_label_result,
      'features', v_feature_result,
      'dataset', v_dataset_result,
      'readiness', v_readiness_result
    ),
    'safeguards', jsonb_build_object(
      'stored_data_only', true,
      'provider_enabled_before', provider_enabled,
      'provider_enabled_after', provider_enabled_after,
      'provider_calls', 0,
      'global_lock_required', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN COALESCE(
        (v_readiness_result ->> 'data_ready')::boolean,
        false
      ) THEN 'review_manual_training_authorization'
      ELSE 'continue_daily_accumulation'
    END
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.run_highlightly_football_training_accumulation_v1(
      integer,
      integer,
      integer,
      integer,
      integer
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.run_highlightly_football_training_accumulation_v1(
      integer,
      integer,
      integer,
      integer,
      integer
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.get_highlightly_training_accumulation_report_v1(
    p_days integer DEFAULT 30
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'accumulation report days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role(
         (SELECT auth.uid()),
         'admin'::public.app_role
       )
     ) THEN
    RAISE EXCEPTION
      'Highlightly accumulation report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH target_sport AS (
    SELECT sport.id
    FROM public.sports AS sport
    WHERE sport.code = 'football'
  ),
  recent_runs AS (
    SELECT accumulation.*
    FROM public.hl_training_accumulation_runs AS accumulation
    JOIN target_sport
      ON target_sport.id = accumulation.sport_id
    WHERE accumulation.started_at
      >= statement_timestamp() - make_interval(days => p_days)
  ),
  latest_run AS (
    SELECT recent.*
    FROM recent_runs AS recent
    ORDER BY recent.started_at DESC, recent.id DESC
    LIMIT 1
  ),
  run_summary AS (
    SELECT
      count(*)::integer AS runs,
      count(*) FILTER (
        WHERE status = 'completed'
      )::integer AS completed_runs,
      count(*) FILTER (
        WHERE status = 'completed_with_exceptions'
      )::integer AS completed_with_exceptions_runs,
      count(*) FILTER (
        WHERE status = 'failed'
      )::integer AS failed_runs,
      COALESCE(sum(provider_calls), 0)::integer AS provider_calls,
      max(finished_at) AS last_finished_at
    FROM recent_runs
  ),
  provider_state AS (
    SELECT provider.enabled
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly'
  )
  SELECT jsonb_build_object(
    'phase', '8G.4.1',
    'quality_contract_version', 'phase8g.4.1',
    'sport', 'football',
    'window_days', p_days,
    'runs', to_jsonb(run_summary),
    'latest_run', CASE
      WHEN latest_run.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', latest_run.id,
        'status', latest_run.status,
        'window_days', latest_run.window_days,
        'label_limit', latest_run.label_limit,
        'feature_limit', latest_run.feature_limit,
        'max_candidates_per_kickoff',
          latest_run.max_candidates_per_kickoff,
        'dataset_limit', latest_run.dataset_limit,
        'label_result', latest_run.label_result,
        'feature_result', latest_run.feature_result,
        'dataset_result', latest_run.dataset_result,
        'readiness_result', latest_run.readiness_result,
        'started_at', latest_run.started_at,
        'finished_at', latest_run.finished_at,
        'diagnostics', latest_run.diagnostics
      )
    END,
    'current_readiness',
      public.get_highlightly_training_readiness_report_v1(
        'football',
        365
      ),
    'safeguards', jsonb_build_object(
      'read_only', true,
      'provider_enabled', provider_state.enabled,
      'provider_calls', run_summary.provider_calls,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN provider_state.enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      WHEN run_summary.failed_runs > 0
        THEN 'review_accumulation_failures'
      WHEN latest_run.id IS NULL
        THEN 'ready_for_daily_accumulation_canary'
      ELSE 'continue_daily_accumulation'
    END
  )
  INTO result
  FROM run_summary
  LEFT JOIN latest_run ON true
  CROSS JOIN provider_state;

  RETURN result;
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.get_highlightly_training_accumulation_report_v1(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION
    public.get_highlightly_training_accumulation_report_v1(integer)
  TO authenticated, service_role;

COMMENT ON TABLE public.hl_training_accumulation_runs IS
  'Audited daily stored-data-only Football label, feature, dataset and readiness accumulation runs.';
COMMENT ON FUNCTION
  public.get_highlightly_training_accumulation_preview_v1(
    integer,
    integer,
    integer,
    integer,
    integer
  ) IS
  'Read-only Phase 8G.4.1 preview for the bounded daily Football accumulator.';
COMMENT ON FUNCTION
  public.run_highlightly_football_training_accumulation_v1(
    integer,
    integer,
    integer,
    integer,
    integer
  ) IS
  'Transactional Phase 8G.4.1 daily Football accumulator using stored data only and never training.';
COMMENT ON FUNCTION
  public.get_highlightly_training_accumulation_report_v1(integer) IS
  'Read-only Phase 8G.4.1 operational report with current deterministic readiness.';

NOTIFY pgrst, 'reload schema';
