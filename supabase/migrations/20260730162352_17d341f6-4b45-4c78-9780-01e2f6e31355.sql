ALTER FUNCTION
  public.materialize_highlightly_football_score_labels_v2(
    integer,
    integer,
    timestamptz,
    uuid
  )
  RENAME TO
    materialize_highlightly_football_score_labels_v2_phase8g43_legacy;

REVOKE ALL
  ON FUNCTION
    public.materialize_highlightly_football_score_labels_v2_phase8g43_legacy(
      integer,
      integer,
      timestamptz,
      uuid
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.materialize_highlightly_football_score_labels_v2_phase8g43_legacy(
      integer,
      integer,
      timestamptz,
      uuid
    )
  TO service_role;

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
  base_result jsonb;
  rejected_count integer := 0;
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

  base_result :=
    public.materialize_highlightly_football_score_labels_v2_phase8g43_legacy(
      p_days,
      p_limit,
      p_before_at,
      p_before_id
    );

  WITH source_matches AS (
    SELECT
      match_value,
      (match_value ->> 'match_id')::uuid AS match_id,
      (match_value ->> 'kickoff_at')::timestamptz AS kickoff_at,
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
      COALESCE(
        source.terminal_observed_at,
        source.kickoff_at,
        statement_timestamp()
      ),
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
        'materialization_run_id', base_result ->> 'run_id',
        'label_set_code', target.code,
        'label_set_version', target.version,
        'terminal_observation_source',
          source.terminal_observation_source,
        'terminal_observed_at', source.terminal_observed_at,
        'rejection_effective_at', COALESCE(
          source.terminal_observed_at,
          source.kickoff_at,
          statement_timestamp()
        ),
        'generation_mode', 'deterministic_rejection',
        'rejection_reason', source.block_reason,
        'permanent_for_label_version', true,
        'manual_review_required',
          source.block_reason =
            'terminal_state_requires_manual_review',
        'null_terminal_rejection_fix', true,
        'provider_calls', 0,
        'automatic_training', false,
        'automatic_predictions', false
      )
    FROM source_matches AS source
    WHERE source.block_reason IN (
        'terminal_state_requires_manual_review',
        'participant_identity_collision'
      )
    ON CONFLICT (match_id, label_version) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer
  INTO rejected_count
  FROM rejected;

  UPDATE public.hl_label_materialization_runs AS run
  SET diagnostics = run.diagnostics || jsonb_build_object(
    'labels_rejected', rejected_count,
    'permanent_blockers_recorded', rejected_count,
    'null_terminal_rejection_fix', true
  )
  WHERE run.id = (base_result ->> 'run_id')::uuid;

  RETURN base_result || jsonb_build_object(
    'labels_rejected', rejected_count,
    'permanent_blockers_recorded', rejected_count,
    'safeguards',
      COALESCE(base_result -> 'safeguards', '{}'::jsonb)
      || jsonb_build_object(
        'null_terminal_rejection_fix', true,
        'deterministic_rejections_excluded', true,
        'rejected_labels_training_eligible', false
      )
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

COMMENT ON FUNCTION
  public.materialize_highlightly_football_score_labels_v2(
    integer,
    integer,
    timestamptz,
    uuid
  ) IS
  'Stored-data cursor label materializer that permanently records deterministic blockers even when terminal_observed_at is null.';

NOTIFY pgrst, 'reload schema';