CREATE OR REPLACE FUNCTION
  public.materialize_highlightly_football_score_labels_v2(
    p_days integer DEFAULT 365,
    p_limit integer DEFAULT 20,
    p_before_at timestamptz DEFAULT NULL,
    p_before_id uuid DEFAULT NULL
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  target public.hl_label_sets%ROWTYPE;
  provider_enabled boolean;
  preview jsonb;
  target_run_id uuid;
  considered_count integer := 0;
  eligible_count integer := 0;
  inserted_count integer := 0;
  rejected_count integer := 0;
  blocked_count integer := 0;
  target_label_version constant text :=
    'highlightly_football_postmatch.score.1.0.0';
BEGIN
  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must be disabled before label batching'
      USING ERRCODE = '55000';
  END IF;

  SELECT label_set.*
  INTO target
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport
    ON sport.id = label_set.sport_id
   AND sport.code = 'football'
  WHERE label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0'
    AND label_set.status = 'draft'
    AND NOT label_set.is_enabled
  LIMIT 1;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Football label set 1.0.0 must be installed'
      USING ERRCODE = '55000';
  END IF;

  preview := public.get_highlightly_score_label_batch_preview_v1(
    p_days,
    p_limit,
    p_before_at,
    p_before_id
  );
  considered_count :=
    COALESCE((preview ->> 'candidates_considered')::integer, 0);
  eligible_count :=
    COALESCE((preview ->> 'candidates_eligible')::integer, 0);
  blocked_count :=
    COALESCE((preview ->> 'candidates_blocked')::integer, 0);

  INSERT INTO public.hl_label_materialization_runs (
    label_set_id,
    sport_id,
    label_version,
    window_days,
    sample_limit,
    diagnostics
  )
  VALUES (
    target.id,
    target.sport_id,
    target_label_version,
    p_days,
    p_limit,
    jsonb_build_object(
      'phase', '8G.4.3',
      'quality_contract_version', 'phase8g.4.3',
      'generation_mode', 'cursor_batch',
      'cursor_before', preview -> 'cursor_before',
      'next_cursor', preview -> 'next_cursor',
      'deterministic_rejections', true,
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  )
  RETURNING id INTO target_run_id;

  WITH source_matches AS (
    SELECT
      match_value,
      (match_value ->> 'match_id')::uuid AS match_id,
      (match_value ->> 'terminal_observed_at')::timestamptz
        AS terminal_observed_at,
      match_value ->> 'terminal_observation_source'
        AS terminal_observation_source,
      match_value ->> 'block_reason' AS block_reason,
      (match_value ->> 'definition_count')::integer
        AS definition_count
    FROM jsonb_array_elements(
      COALESCE(preview -> 'matches', '[]'::jsonb)
    ) AS match_value
  ),
  inserted AS (
    INSERT INTO public.hl_match_labels (
      match_id,
      label_set_id,
      label_version,
      outcome_at,
      label_available_at,
      labels,
      quality_status,
      source_data_max_at,
      lineage
    )
    SELECT
      source.match_id,
      target.id,
      target_label_version,
      source.terminal_observed_at,
      statement_timestamp(),
      jsonb_build_object(
        'contract_version', 'phase8g.4.3',
        'scope', 'score_based',
        'definition_count', source.definition_count,
        'values', source.match_value -> 'labels'
      ),
      'valid',
      source.terminal_observed_at,
      jsonb_build_object(
        'phase', '8G.4.3',
        'quality_contract_version', 'phase8g.4.3',
        'materialization_run_id', target_run_id,
        'label_set_code', target.code,
        'label_set_version', target.version,
        'terminal_observation_source',
          source.terminal_observation_source,
        'terminal_observed_at', source.terminal_observed_at,
        'generation_mode', 'cursor_batch',
        'provider_calls', 0,
        'automatic_training', false,
        'automatic_predictions', false
      )
    FROM source_matches AS source
    WHERE NULLIF(source.block_reason, '') IS NULL
      AND source.terminal_observed_at IS NOT NULL
      AND source.definition_count = 18
    ON CONFLICT (match_id, label_version) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer
  INTO inserted_count
  FROM inserted;

  WITH source_matches AS (
    SELECT
      match_value,
      (match_value ->> 'match_id')::uuid AS match_id,
      (match_value ->> 'terminal_observed_at')::timestamptz
        AS terminal_observed_at,
      match_value ->> 'terminal_observation_source'
        AS terminal_observation_source,
      match_value ->> 'block_reason' AS block_reason,
      (match_value ->> 'definition_count')::integer
        AS definition_count
    FROM jsonb_array_elements(
      COALESCE(preview -> 'matches', '[]'::jsonb)
    ) AS match_value
  ),
  rejected AS (
    INSERT INTO public.hl_match_labels (
      match_id,
      label_set_id,
      label_version,
      outcome_at,
      label_available_at,
      labels,
      quality_status,
      source_data_max_at,
      lineage
    )
    SELECT
      source.match_id,
      target.id,
      target_label_version,
      source.terminal_observed_at,
      statement_timestamp(),
      jsonb_build_object(
        'contract_version', 'phase8g.4.3',
        'scope', 'score_based',
        'rejected', true,
        'rejection_reason', source.block_reason,
        'definition_count', source.definition_count,
        'values', '[]'::jsonb
      ),
      'rejected',
      source.terminal_observed_at,
      jsonb_build_object(
        'phase', '8G.4.3',
        'quality_contract_version', 'phase8g.4.3',
        'materialization_run_id', target_run_id,
        'label_set_code', target.code,
        'label_set_version', target.version,
        'terminal_observation_source',
          source.terminal_observation_source,
        'terminal_observed_at', source.terminal_observed_at,
        'generation_mode', 'deterministic_rejection',
        'rejection_reason', source.block_reason,
        'permanent_for_label_version', true,
        'manual_review_required',
          source.block_reason =
            'terminal_state_requires_manual_review',
        'provider_calls', 0,
        'automatic_training', false,
        'automatic_predictions', false
      )
    FROM source_matches AS source
    WHERE source.block_reason IN (
        'terminal_state_requires_manual_review',
        'participant_identity_collision'
      )
      AND source.terminal_observed_at IS NOT NULL
    ON CONFLICT (match_id, label_version) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer
  INTO rejected_count
  FROM rejected;

  UPDATE public.hl_label_materialization_runs AS run
  SET
    status = CASE
      WHEN blocked_count > 0
        THEN 'completed_with_exceptions'
      ELSE 'completed'
    END,
    matches_considered = considered_count,
    matches_eligible = eligible_count,
    labels_inserted = inserted_count,
    labels_skipped = greatest(eligible_count - inserted_count, 0),
    labels_blocked = blocked_count,
    provider_calls = 0,
    finished_at = statement_timestamp(),
    diagnostics = run.diagnostics || jsonb_build_object(
      'labels_written', inserted_count,
      'labels_rejected', rejected_count,
      'labels_blocked', blocked_count,
      'permanent_blockers_recorded', rejected_count,
      'has_more', COALESCE((preview ->> 'has_more')::boolean, false)
    )
  WHERE run.id = target_run_id;

  RETURN jsonb_build_object(
    'phase', '8G.4.3',
    'quality_contract_version', 'phase8g.4.3',
    'run_id', target_run_id,
    'sport', 'football',
    'window_days', p_days,
    'batch_limit', p_limit,
    'cursor_before', preview -> 'cursor_before',
    'next_cursor', preview -> 'next_cursor',
    'has_more', COALESCE((preview ->> 'has_more')::boolean, false),
    'candidates_considered', considered_count,
    'candidates_eligible', eligible_count,
    'candidates_blocked', blocked_count,
    'labels_inserted', inserted_count,
    'labels_rejected', rejected_count,
    'permanent_blockers_recorded', rejected_count,
    'labels_skipped', greatest(eligible_count - inserted_count, 0),
    'safeguards', jsonb_build_object(
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'stored_data_only', true,
      'cursor_pagination', true,
      'immutable_labels', true,
      'deterministic_rejections_excluded', true,
      'rejected_labels_training_eligible', false,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN considered_count = 0 THEN 'batch_window_exhausted'
      WHEN COALESCE((preview ->> 'has_more')::boolean, false)
        THEN 'continue_next_cursor'
      ELSE 'rebuild_feature_overlap_and_dataset'
    END
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.materialize_highlightly_football_score_labels_v2(
      integer,
      integer,
      timestamptz,
      uuid
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.materialize_highlightly_football_score_labels_v2(
      integer,
      integer,
      timestamptz,
      uuid
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.evaluate_highlightly_football_training_dataset_v1(
    p_from timestamptz,
    p_to timestamptz,
    p_limit integer DEFAULT 100
  )
RETURNS TABLE (
  match_id uuid,
  feature_snapshot_id uuid,
  label_id uuid,
  kickoff_at timestamptz,
  feature_cutoff_at timestamptz,
  outcome_at timestamptz,
  label_available_at timestamptz,
  feature_coverage_pct numeric,
  competition_profile text,
  block_reason text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH target AS (
    SELECT dataset_spec.*
    FROM public.hl_training_dataset_specs AS dataset_spec
    JOIN public.sports AS sport
      ON sport.id = dataset_spec.sport_id
     AND sport.code = 'football'
    WHERE dataset_spec.code = 'highlightly_football_prematch_score'
      AND dataset_spec.version = '1.0.0'
    LIMIT 1
  ),
  candidates AS (
    SELECT
      match_row.id AS match_id,
      snapshot.id AS feature_snapshot_id,
      label.id AS label_id,
      match_row.kickoff_at,
      snapshot.cutoff_at AS feature_cutoff_at,
      label.outcome_at,
      label.label_available_at,
      snapshot.coverage_pct AS feature_coverage_pct,
      COALESCE(
        NULLIF(snapshot.quality ->> 'competition_profile', ''),
        'unknown'
      ) AS competition_profile,
      snapshot.leakage_status,
      snapshot.quality AS feature_quality,
      snapshot.lineage AS feature_lineage,
      label.quality_status AS label_quality_status,
      label.labels AS label_payload,
      label.source_data_max_at,
      target.minimum_coverage_pct
    FROM target
    JOIN public.hl_match_labels AS label
      ON label.label_set_id = target.label_set_id
     AND label.label_version = target.label_version
     AND label.quality_status = 'valid'
    JOIN public.sports_matches AS match_row
      ON match_row.id = label.match_id
     AND match_row.sport_id = target.sport_id
    LEFT JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.feature_set_id = target.feature_set_id
     AND snapshot.match_id = label.match_id
     AND snapshot.horizon_key = target.horizon_key
     AND snapshot.kickoff_at = match_row.kickoff_at
    WHERE match_row.kickoff_at >= p_from
      AND match_row.kickoff_at < p_to
    ORDER BY match_row.kickoff_at, match_row.id
    LIMIT p_limit
  )
  SELECT
    candidate.match_id,
    candidate.feature_snapshot_id,
    candidate.label_id,
    candidate.kickoff_at,
    candidate.feature_cutoff_at,
    candidate.outcome_at,
    candidate.label_available_at,
    candidate.feature_coverage_pct,
    candidate.competition_profile,
    CASE
      WHEN candidate.feature_snapshot_id IS NULL
        THEN 'missing_feature_snapshot'
      WHEN candidate.leakage_status <> 'clean'
        THEN 'feature_leakage_not_clean'
      WHEN COALESCE(
        (candidate.feature_quality ->> 'model_eligible')::boolean,
        false
      ) IS DISTINCT FROM true
        THEN 'feature_not_model_eligible'
      WHEN candidate.feature_coverage_pct
        < candidate.minimum_coverage_pct
        THEN 'feature_coverage_below_minimum'
      WHEN candidate.feature_cutoff_at >= candidate.kickoff_at
        THEN 'feature_cutoff_not_before_kickoff'
      WHEN COALESCE(
        candidate.feature_lineage ->> 'target_match_facts_used',
        'missing'
      ) <> 'false'
        THEN 'target_match_facts_not_explicitly_forbidden'
      WHEN NULLIF(
        candidate.feature_lineage ->> 'home_source_max_at',
        ''
      )::timestamptz > candidate.feature_cutoff_at
        OR NULLIF(
          candidate.feature_lineage ->> 'away_source_max_at',
          ''
        )::timestamptz > candidate.feature_cutoff_at
        OR NULLIF(
          candidate.feature_lineage ->> 'odds_source_max_at',
          ''
        )::timestamptz > candidate.feature_cutoff_at
        OR NULLIF(
          candidate.feature_lineage ->> 'lineup_source_max_at',
          ''
        )::timestamptz > candidate.feature_cutoff_at
        THEN 'feature_source_after_cutoff'
      WHEN candidate.label_quality_status <> 'valid'
        THEN 'label_not_valid'
      WHEN candidate.label_payload ->> 'scope' <> 'score_based'
        OR COALESCE(
          (candidate.label_payload ->> 'definition_count')::integer,
          -1
        ) <> 18
        OR CASE
          WHEN jsonb_typeof(candidate.label_payload -> 'values') = 'array'
            THEN jsonb_array_length(candidate.label_payload -> 'values')
          ELSE -1
        END <> 18
        THEN 'label_contract_invalid'
      WHEN candidate.outcome_at < candidate.kickoff_at
        THEN 'label_outcome_before_kickoff'
      WHEN candidate.label_available_at < candidate.outcome_at
        OR (
          candidate.source_data_max_at IS NOT NULL
          AND candidate.source_data_max_at > candidate.label_available_at
        )
        THEN 'label_temporal_contract_invalid'
      ELSE NULL
    END AS block_reason
  FROM candidates AS candidate
$function$;

REVOKE ALL
  ON FUNCTION
    public.evaluate_highlightly_football_training_dataset_v1(
      timestamptz,
      timestamptz,
      integer
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.evaluate_highlightly_football_training_dataset_v1(
      timestamptz,
      timestamptz,
      integer
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.get_highlightly_training_accumulation_report_v2(
    p_days integer DEFAULT 30
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  base_report jsonb;
  batch_report jsonb;
  rejection_report jsonb;
BEGIN
  base_report :=
    public.get_highlightly_training_accumulation_report_v1(p_days);

  WITH football AS (
    SELECT sport.id
    FROM public.sports AS sport
    WHERE sport.code = 'football'
  ),
  recent AS (
    SELECT accumulation.*
    FROM public.hl_training_accumulation_runs AS accumulation
    JOIN football
      ON football.id = accumulation.sport_id
    WHERE accumulation.diagnostics ->> 'phase' = '8G.4.2'
      AND accumulation.started_at
        >= statement_timestamp() - make_interval(days => p_days)
  ),
  summary AS (
    SELECT
      count(*)::integer AS cycles,
      count(*) FILTER (
        WHERE status = 'running'
      )::integer AS running_cycles,
      count(*) FILTER (
        WHERE status = 'completed'
      )::integer AS completed_cycles,
      count(*) FILTER (
        WHERE status = 'completed_with_exceptions'
      )::integer AS completed_with_exceptions_cycles,
      count(*) FILTER (
        WHERE status = 'failed'
      )::integer AS failed_cycles,
      COALESCE(
        sum(
          COALESCE(
            (diagnostics ->> 'batches_completed')::integer,
            0
          )
        ),
        0
      )::integer AS batches_completed,
      max(finished_at) AS last_finished_at
    FROM recent
  ),
  latest AS (
    SELECT recent.*
    FROM recent
    ORDER BY recent.started_at DESC, recent.id DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'summary', to_jsonb(summary),
    'latest_cycle', CASE
      WHEN latest.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', latest.id,
        'cycle_key', latest.diagnostics ->> 'cycle_key',
        'status', latest.status,
        'batch_limit', latest.label_limit,
        'feature_limit', latest.feature_limit,
        'dataset_limit', latest.dataset_limit,
        'max_batches', latest.diagnostics -> 'max_batches',
        'batches_completed',
          latest.diagnostics -> 'batches_completed',
        'cursor_state', latest.diagnostics -> 'cursor_state',
        'error_summary', latest.diagnostics -> 'error_summary',
        'started_at', latest.started_at,
        'finished_at', latest.finished_at
      )
    END
  )
  INTO batch_report
  FROM summary
  LEFT JOIN latest ON true;

  WITH recent_rejections AS (
    SELECT
      label.lineage ->> 'rejection_reason' AS rejection_reason,
      label.created_at
    FROM public.hl_match_labels AS label
    JOIN public.hl_label_sets AS label_set
      ON label_set.id = label.label_set_id
    JOIN public.sports AS sport
      ON sport.id = label_set.sport_id
     AND sport.code = 'football'
    WHERE label.label_version =
        'highlightly_football_postmatch.score.1.0.0'
      AND label.quality_status = 'rejected'
      AND label.lineage ->> 'phase' = '8G.4.3'
      AND label.created_at
        >= statement_timestamp() - make_interval(days => p_days)
  ),
  summary AS (
    SELECT
      count(*)::integer AS rejected_labels,
      count(*) FILTER (
        WHERE rejection_reason =
          'terminal_state_requires_manual_review'
      )::integer AS manual_review_rejections,
      count(*) FILTER (
        WHERE rejection_reason =
          'participant_identity_collision'
      )::integer AS identity_collision_rejections,
      max(created_at) AS last_rejected_at
    FROM recent_rejections
  ),
  reason_counts AS (
    SELECT
      rejection_reason,
      count(*)::integer AS rejected_labels
    FROM recent_rejections
    GROUP BY rejection_reason
  ),
  reasons AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'reason', reason_counts.rejection_reason,
          'rejected_labels', reason_counts.rejected_labels
        )
        ORDER BY reason_counts.rejected_labels DESC,
          reason_counts.rejection_reason
      ),
      '[]'::jsonb
    ) AS values
    FROM reason_counts
  )
  SELECT jsonb_build_object(
    'summary', to_jsonb(summary),
    'by_reason', reasons.values,
    'training_rows_excluded', summary.rejected_labels,
    'permanent_for_label_version', true
  )
  INTO rejection_report
  FROM summary
  CROSS JOIN reasons;

  RETURN base_report || jsonb_build_object(
    'phase', '8G.4.3',
    'quality_contract_version', 'phase8g.4.3',
    'batching', COALESCE(batch_report, '{}'::jsonb),
    'deterministic_rejections',
      COALESCE(rejection_report, '{}'::jsonb),
    'safeguards',
      COALESCE(base_report -> 'safeguards', '{}'::jsonb)
      || jsonb_build_object(
        'cursor_pagination', true,
        'maximum_batch_size', 50,
        'maximum_batches_per_cycle', 20,
        'deterministic_rejections_excluded', true,
        'rejected_labels_training_eligible', false,
        'automatic_training', false,
        'automatic_predictions', false
      )
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.get_highlightly_training_accumulation_report_v2(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION
    public.get_highlightly_training_accumulation_report_v2(integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION
  public.materialize_highlightly_football_score_labels_v2(
    integer,
    integer,
    timestamptz,
    uuid
  ) IS
  'Stored-data-only Football label materializer that records permanent deterministic blockers as immutable rejected labels.';
COMMENT ON FUNCTION
  public.get_highlightly_training_accumulation_report_v2(integer) IS
  'Admin report for keyset-batched accumulation including deterministic rejected-label observability.';
COMMENT ON FUNCTION
  public.evaluate_highlightly_football_training_dataset_v1(
    timestamptz,
    timestamptz,
    integer
  ) IS
  'Stored-data dataset evaluator that filters invalid or rejected labels before applying its bounded limit.';

NOTIFY pgrst, 'reload schema';
