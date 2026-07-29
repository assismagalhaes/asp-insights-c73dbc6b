CREATE TABLE IF NOT EXISTS public.hl_label_materialization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_set_id uuid NOT NULL
    REFERENCES public.hl_label_sets(id) ON DELETE RESTRICT,
  sport_id uuid NOT NULL
    REFERENCES public.sports(id) ON DELETE RESTRICT,
  label_version text NOT NULL,
  window_days integer NOT NULL,
  sample_limit integer NOT NULL,
  status text NOT NULL DEFAULT 'running',
  matches_considered integer NOT NULL DEFAULT 0,
  matches_eligible integer NOT NULL DEFAULT 0,
  labels_inserted integer NOT NULL DEFAULT 0,
  labels_skipped integer NOT NULL DEFAULT 0,
  labels_blocked integer NOT NULL DEFAULT 0,
  provider_calls integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_label_materialization_runs_version_check CHECK (
    label_version ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  CONSTRAINT hl_label_materialization_runs_window_check CHECK (
    window_days BETWEEN 1 AND 3650
  ),
  CONSTRAINT hl_label_materialization_runs_limit_check CHECK (
    sample_limit BETWEEN 1 AND 200
  ),
  CONSTRAINT hl_label_materialization_runs_status_check CHECK (
    status IN (
      'running',
      'completed',
      'completed_with_exceptions',
      'failed'
    )
  ),
  CONSTRAINT hl_label_materialization_runs_counts_check CHECK (
    matches_considered >= 0
    AND matches_eligible >= 0
    AND labels_inserted >= 0
    AND labels_skipped >= 0
    AND labels_blocked >= 0
    AND provider_calls = 0
  ),
  CONSTRAINT hl_label_materialization_runs_diagnostics_check CHECK (
    jsonb_typeof(diagnostics) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_label_materialization_runs_latest
  ON public.hl_label_materialization_runs (
    label_set_id,
    started_at DESC
  );

ALTER TABLE public.hl_label_materialization_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hl_label_materialization_runs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hl_label_materialization_runs
  TO authenticated;
GRANT ALL ON TABLE public.hl_label_materialization_runs
  TO service_role;

DROP POLICY IF EXISTS admin_read_hl_label_materialization_runs
  ON public.hl_label_materialization_runs;
CREATE POLICY admin_read_hl_label_materialization_runs
  ON public.hl_label_materialization_runs
  FOR SELECT
  TO authenticated
  USING (
    (
      SELECT public.has_role(
        (SELECT auth.uid()),
        'admin'::public.app_role
      )
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_highlightly_match_label_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION
    'match labels are immutable; create a new label version instead'
    USING ERRCODE = '55000';
END
$function$;

REVOKE ALL
  ON FUNCTION public.prevent_highlightly_match_label_mutation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hl_match_labels_immutable
  ON public.hl_match_labels;
CREATE TRIGGER trg_hl_match_labels_immutable
  BEFORE UPDATE OR DELETE ON public.hl_match_labels
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_highlightly_match_label_mutation();

CREATE OR REPLACE FUNCTION
  public.materialize_highlightly_football_score_labels_v1(
    p_days integer DEFAULT 365,
    p_limit integer DEFAULT 20
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
  run_id uuid;
  target_label_version constant text :=
    'highlightly_football_postmatch.score.1.0.0';
  considered_count integer := 0;
  eligible_count integer := 0;
  inserted_count integer := 0;
  skipped_count integer := 0;
  blocked_count integer := 0;
  result jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'label materialization days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'label materialization limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';

  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must be disabled before label materialization'
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
  LIMIT 1;

  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Football label set 1.0.0 must be installed';
  END IF;
  IF target.status IS DISTINCT FROM 'draft'
     OR target.is_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Football label canary requires the draft, disabled label set'
      USING ERRCODE = '55000';
  END IF;

  preview :=
    public.get_highlightly_label_settlement_preview_v2(
      'football',
      p_days,
      p_limit
    );

  considered_count :=
    COALESCE((preview ->> 'sampled_matches')::integer, 0);

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
      'phase', '8G.2',
      'quality_contract_version', 'phase8g.2',
      'generation_mode', 'manual_canary',
      'market_scope', jsonb_build_array(
        'full_time_result',
        'total_goals',
        'both_teams_to_score',
        'asian_handicap'
      ),
      'preview_recommendation', preview ->> 'recommendation',
      'preview_score_ready_matches',
        COALESCE((preview ->> 'score_ready_matches')::integer, 0),
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  )
  RETURNING id INTO run_id;

  WITH source_matches AS (
    SELECT
      match_value,
      (match_value ->> 'match_id')::uuid AS match_id,
      (match_value ->> 'terminal_observed_at')::timestamptz
        AS terminal_observed_at,
      match_value ->> 'terminal_observation_source'
        AS terminal_observation_source,
      match_value ->> 'base_block_reason' AS base_block_reason
    FROM jsonb_array_elements(
      COALESCE(preview -> 'matches', '[]'::jsonb)
    ) AS match_value
  ),
  eligible AS (
    SELECT
      source.match_id,
      source.terminal_observed_at,
      source.terminal_observation_source,
      score_labels.labels,
      jsonb_array_length(score_labels.labels) AS definition_count
    FROM source_matches AS source
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          label_value
          ORDER BY
            label_value ->> 'market_family',
            NULLIF(label_value ->> 'line_value', '')::numeric
              NULLS FIRST,
            label_value ->> 'label_key'
        ),
        '[]'::jsonb
      ) AS labels
      FROM jsonb_array_elements(
        COALESCE(
          source.match_value -> 'labels_preview',
          '[]'::jsonb
        )
      ) AS label_value
      WHERE label_value ->> 'market_family' IN (
        'full_time_result',
        'total_goals',
        'both_teams_to_score',
        'asian_handicap'
      )
        AND label_value ->> 'status' = 'ready'
        AND NULLIF(label_value ->> 'outcome', '') IS NOT NULL
    ) AS score_labels
    WHERE NULLIF(source.base_block_reason, '') IS NULL
      AND source.terminal_observed_at IS NOT NULL
      AND source.match_value
        #>> '{family_readiness,full_time_result,status}' = 'ready'
      AND source.match_value
        #>> '{family_readiness,total_goals,status}' = 'ready'
      AND source.match_value
        #>> '{family_readiness,both_teams_to_score,status}' = 'ready'
      AND source.match_value
        #>> '{family_readiness,asian_handicap,status}' = 'ready'
  ),
  validated AS (
    SELECT eligible.*
    FROM eligible
    WHERE eligible.definition_count = 18
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
      validated.match_id,
      target.id,
      target_label_version,
      validated.terminal_observed_at,
      statement_timestamp(),
      jsonb_build_object(
        'contract_version', 'phase8g.2',
        'scope', 'score_based',
        'definition_count', validated.definition_count,
        'values', validated.labels
      ),
      'valid',
      validated.terminal_observed_at,
      jsonb_build_object(
        'phase', '8G.2',
        'quality_contract_version', 'phase8g.2',
        'materialization_run_id', run_id,
        'label_set_code', target.code,
        'label_set_version', target.version,
        'terminal_observation_source',
          validated.terminal_observation_source,
        'terminal_observed_at', validated.terminal_observed_at,
        'settlement_preview_version', 'phase8g.1.1',
        'provider_calls', 0,
        'generation_mode', 'manual_canary',
        'automatic_training', false,
        'automatic_predictions', false
      )
    FROM validated
    ON CONFLICT (match_id, label_version) DO NOTHING
    RETURNING id
  )
  SELECT
    (SELECT count(*)::integer FROM validated),
    (SELECT count(*)::integer FROM inserted)
  INTO eligible_count, inserted_count;

  skipped_count := greatest(eligible_count - inserted_count, 0);
  blocked_count := greatest(considered_count - eligible_count, 0);

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
    labels_skipped = skipped_count,
    labels_blocked = blocked_count,
    provider_calls = 0,
    finished_at = statement_timestamp(),
    diagnostics = run.diagnostics || jsonb_build_object(
      'family_summary', COALESCE(
        preview -> 'family_summary',
        '[]'::jsonb
      ),
      'labels_written', inserted_count,
      'labels_skipped_existing', skipped_count,
      'labels_blocked', blocked_count
    )
  WHERE run.id = run_id;

  SELECT jsonb_build_object(
    'phase', '8G.2',
    'quality_contract_version', 'phase8g.2',
    'run_id', run_id,
    'sport', 'football',
    'label_set', jsonb_build_object(
      'code', target.code,
      'version', target.version,
      'status', target.status,
      'is_enabled', target.is_enabled
    ),
    'label_version', target_label_version,
    'window_days', p_days,
    'sample_limit', p_limit,
    'matches_considered', considered_count,
    'matches_eligible', eligible_count,
    'labels_inserted', inserted_count,
    'labels_skipped', skipped_count,
    'labels_blocked', blocked_count,
    'safeguards', jsonb_build_object(
      'provider_calls', 0,
      'provider_enabled', provider_enabled,
      'manual_canary', true,
      'score_families_only', true,
      'immutable_labels', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN eligible_count = 0
        THEN 'no_eligible_score_labels'
      WHEN inserted_count > 0
        THEN 'review_materialized_label_canary'
      ELSE 'idempotency_confirmed'
    END
  )
  INTO result;

  RETURN result;
END
$function$;

REVOKE ALL
  ON FUNCTION public.materialize_highlightly_football_score_labels_v1(
    integer,
    integer
  )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.materialize_highlightly_football_score_labels_v1(
    integer,
    integer
  )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.get_highlightly_label_materialization_report_v1(
    p_sport text DEFAULT 'football',
    p_days integer DEFAULT 365
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
  IF p_sport IS DISTINCT FROM 'football' THEN
    RAISE EXCEPTION 'Phase 8G.2 currently supports Football only'
      USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'label report days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role(
         (SELECT auth.uid()),
         'admin'::public.app_role
       )
     ) THEN
    RAISE EXCEPTION 'Highlightly label report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH target AS (
    SELECT label_set.*
    FROM public.hl_label_sets AS label_set
    JOIN public.sports AS sport
      ON sport.id = label_set.sport_id
     AND sport.code = p_sport
    WHERE label_set.code = 'highlightly_football_postmatch'
      AND label_set.version = '1.0.0'
    LIMIT 1
  ),
  stored AS (
    SELECT label.*
    FROM target
    JOIN public.hl_match_labels AS label
      ON label.label_set_id = target.id
     AND label.label_version
       = 'highlightly_football_postmatch.score.1.0.0'
     AND label.outcome_at
       >= statement_timestamp() - make_interval(days => p_days)
  ),
  label_summary AS (
    SELECT
      count(*)::integer AS stored_labels,
      count(*) FILTER (
        WHERE quality_status = 'valid'
      )::integer AS valid_labels,
      count(*) FILTER (
        WHERE labels ->> 'scope' = 'score_based'
          AND (labels ->> 'definition_count')::integer = 18
          AND jsonb_array_length(
            COALESCE(labels -> 'values', '[]'::jsonb)
          ) = 18
      )::integer AS contract_valid_labels,
      count(*) FILTER (
        WHERE lineage ->> 'terminal_observation_source'
          = 'lifecycle_ended_at'
      )::integer AS lifecycle_observations,
      count(*) FILTER (
        WHERE lineage ->> 'terminal_observation_source'
          = 'provider_finished_observation'
      )::integer AS provider_finished_observations,
      min(outcome_at) AS first_outcome_at,
      max(outcome_at) AS last_outcome_at,
      max(label_available_at) AS last_label_available_at
    FROM stored
  ),
  family_summary AS (
    SELECT
      label_value ->> 'market_family' AS market_family,
      count(DISTINCT stored.match_id)::integer AS matches,
      count(*)::integer AS definitions,
      count(*) FILTER (
        WHERE NULLIF(label_value ->> 'outcome', '') IS NOT NULL
      )::integer AS settled_definitions
    FROM stored
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(stored.labels -> 'values', '[]'::jsonb)
    ) AS label_value
    GROUP BY label_value ->> 'market_family'
  ),
  run_summary AS (
    SELECT
      count(run.id)::integer AS runs,
      count(*) FILTER (
        WHERE run.status = 'completed'
      )::integer AS completed_runs,
      count(*) FILTER (
        WHERE run.status = 'completed_with_exceptions'
      )::integer AS completed_with_exceptions_runs,
      count(*) FILTER (
        WHERE run.status = 'failed'
      )::integer AS failed_runs,
      COALESCE(sum(run.matches_considered), 0)::integer
        AS matches_considered,
      COALESCE(sum(run.matches_eligible), 0)::integer
        AS matches_eligible,
      COALESCE(sum(run.labels_inserted), 0)::integer
        AS labels_inserted,
      COALESCE(sum(run.labels_skipped), 0)::integer
        AS labels_skipped,
      COALESCE(sum(run.labels_blocked), 0)::integer
        AS labels_blocked,
      COALESCE(sum(run.provider_calls), 0)::integer
        AS provider_calls,
      max(run.finished_at) AS last_finished_at
    FROM target
    LEFT JOIN public.hl_label_materialization_runs AS run
      ON run.label_set_id = target.id
     AND run.started_at
       >= statement_timestamp() - make_interval(days => p_days)
  ),
  provider_state AS (
    SELECT provider.enabled
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly'
  )
  SELECT jsonb_build_object(
    'phase', '8G.2',
    'quality_contract_version', 'phase8g.2',
    'sport', p_sport,
    'window_days', p_days,
    'label_set', jsonb_build_object(
      'code', target.code,
      'version', target.version,
      'status', target.status,
      'is_enabled', target.is_enabled
    ),
    'label_version',
      'highlightly_football_postmatch.score.1.0.0',
    'labels', to_jsonb(label_summary),
    'families', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(family)
          ORDER BY family.market_family
        )
        FROM family_summary AS family
      ),
      '[]'::jsonb
    ),
    'runs', to_jsonb(run_summary),
    'integrity', jsonb_build_object(
      'all_labels_valid',
        label_summary.stored_labels = label_summary.valid_labels,
      'all_labels_match_contract',
        label_summary.stored_labels
          = label_summary.contract_valid_labels,
      'provider_calls_zero', run_summary.provider_calls = 0,
      'provider_disabled', provider_state.enabled = false,
      'label_set_draft_disabled',
        target.status = 'draft' AND NOT target.is_enabled
    ),
    'safeguards', jsonb_build_object(
      'provider_calls', 0,
      'automatic_generation', false,
      'automatic_training', false,
      'automatic_predictions', false,
      'score_families_only', true,
      'immutable_labels', true
    ),
    'recommendation', CASE
      WHEN provider_state.enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      WHEN label_summary.stored_labels = 0
        THEN 'ready_for_score_label_canary'
      WHEN label_summary.stored_labels
        <> label_summary.contract_valid_labels
        THEN 'quarantine_invalid_label_contract'
      WHEN run_summary.provider_calls <> 0
        THEN 'investigate_unexpected_provider_calls'
      ELSE 'review_canary_before_training_dataset'
    END
  )
  INTO result
  FROM target
  CROSS JOIN label_summary
  CROSS JOIN run_summary
  CROSS JOIN provider_state;

  RETURN COALESCE(
    result,
    jsonb_build_object(
      'phase', '8G.2',
      'sport', p_sport,
      'recommendation', 'label_contract_missing'
    )
  );
END
$function$;

REVOKE ALL
  ON FUNCTION public.get_highlightly_label_materialization_report_v1(
    text,
    integer
  )
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.get_highlightly_label_materialization_report_v1(
    text,
    integer
  )
  TO authenticated, service_role;

COMMENT ON TABLE public.hl_label_materialization_runs IS
  'Audited manual Phase 8G label materialization runs. Provider calls are forbidden.';
COMMENT ON FUNCTION
  public.materialize_highlightly_football_score_labels_v1(
    integer,
    integer
  ) IS
  'Idempotent manual Phase 8G.2 Football score-label canary over stored data only; writes no first-goal or corner labels and performs no provider calls.';
COMMENT ON FUNCTION
  public.get_highlightly_label_materialization_report_v1(
    text,
    integer
  ) IS
  'Admin-gated Phase 8G.2 report for immutable stored Football score labels and materialization runs.';

NOTIFY pgrst, 'reload schema';
