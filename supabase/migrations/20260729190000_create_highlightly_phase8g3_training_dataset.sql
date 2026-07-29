CREATE TABLE IF NOT EXISTS public.hl_training_dataset_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  code text NOT NULL,
  version text NOT NULL,
  feature_set_id uuid NOT NULL
    REFERENCES public.hl_feature_sets(id) ON DELETE RESTRICT,
  label_set_id uuid NOT NULL
    REFERENCES public.hl_label_sets(id) ON DELETE RESTRICT,
  label_version text NOT NULL,
  horizon_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  is_enabled boolean NOT NULL DEFAULT false,
  minimum_coverage_pct numeric(7, 2) NOT NULL DEFAULT 70,
  split_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_training_dataset_specs_code_format
    CHECK (code ~ '^[a-z0-9][a-z0-9._-]*$'),
  CONSTRAINT hl_training_dataset_specs_version_format
    CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT hl_training_dataset_specs_label_version_format
    CHECK (label_version ~ '^[a-z0-9][a-z0-9._-]*$'),
  CONSTRAINT hl_training_dataset_specs_horizon_check
    CHECK (horizon_key IN ('t24h', 't6h', 't60m')),
  CONSTRAINT hl_training_dataset_specs_status_check
    CHECK (status IN ('draft', 'shadow', 'active', 'retired')),
  CONSTRAINT hl_training_dataset_specs_coverage_check
    CHECK (minimum_coverage_pct BETWEEN 0 AND 100),
  CONSTRAINT hl_training_dataset_specs_split_policy_check
    CHECK (jsonb_typeof(split_policy) = 'object'),
  CONSTRAINT hl_training_dataset_specs_quality_contract_check
    CHECK (jsonb_typeof(quality_contract) = 'object'),
  CONSTRAINT hl_training_dataset_specs_unique
    UNIQUE (sport_id, code, version)
);

CREATE TABLE IF NOT EXISTS public.hl_training_dataset_build_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_spec_id uuid NOT NULL
    REFERENCES public.hl_training_dataset_specs(id) ON DELETE RESTRICT,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  sample_limit integer NOT NULL,
  status text NOT NULL DEFAULT 'running',
  matches_considered integer NOT NULL DEFAULT 0,
  rows_eligible integer NOT NULL DEFAULT 0,
  rows_inserted integer NOT NULL DEFAULT 0,
  rows_blocked integer NOT NULL DEFAULT 0,
  provider_calls integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_training_dataset_build_runs_window_check
    CHECK (window_from < window_to),
  CONSTRAINT hl_training_dataset_build_runs_limit_check
    CHECK (sample_limit BETWEEN 1 AND 5000),
  CONSTRAINT hl_training_dataset_build_runs_status_check
    CHECK (
      status IN (
        'running',
        'completed',
        'completed_with_exceptions',
        'failed'
      )
    ),
  CONSTRAINT hl_training_dataset_build_runs_counts_check
    CHECK (
      matches_considered >= 0
      AND rows_eligible >= 0
      AND rows_inserted >= 0
      AND rows_blocked >= 0
      AND provider_calls = 0
    ),
  CONSTRAINT hl_training_dataset_build_runs_diagnostics_check
    CHECK (jsonb_typeof(diagnostics) = 'object')
);

CREATE TABLE IF NOT EXISTS public.hl_training_dataset_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_run_id uuid NOT NULL
    REFERENCES public.hl_training_dataset_build_runs(id) ON DELETE RESTRICT,
  dataset_spec_id uuid NOT NULL
    REFERENCES public.hl_training_dataset_specs(id) ON DELETE RESTRICT,
  match_id uuid NOT NULL
    REFERENCES public.sports_matches(id) ON DELETE RESTRICT,
  feature_snapshot_id uuid NOT NULL
    REFERENCES public.hl_match_feature_snapshots(id) ON DELETE RESTRICT,
  label_id uuid NOT NULL
    REFERENCES public.hl_match_labels(id) ON DELETE RESTRICT,
  split_key text NOT NULL,
  horizon_key text NOT NULL,
  feature_cutoff_at timestamptz NOT NULL,
  kickoff_at timestamptz NOT NULL,
  outcome_at timestamptz NOT NULL,
  feature_coverage_pct numeric(7, 2) NOT NULL,
  competition_profile text NOT NULL,
  row_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_training_dataset_rows_split_check
    CHECK (split_key IN ('train', 'validation', 'test')),
  CONSTRAINT hl_training_dataset_rows_horizon_check
    CHECK (horizon_key IN ('t24h', 't6h', 't60m')),
  CONSTRAINT hl_training_dataset_rows_time_check
    CHECK (feature_cutoff_at < kickoff_at AND kickoff_at <= outcome_at),
  CONSTRAINT hl_training_dataset_rows_coverage_check
    CHECK (feature_coverage_pct BETWEEN 0 AND 100),
  CONSTRAINT hl_training_dataset_rows_fingerprint_check
    CHECK (row_fingerprint ~ '^[0-9a-f]{32}$'),
  CONSTRAINT hl_training_dataset_rows_match_unique
    UNIQUE (build_run_id, match_id),
  CONSTRAINT hl_training_dataset_rows_pair_unique
    UNIQUE (build_run_id, feature_snapshot_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_hl_training_dataset_specs_status
  ON public.hl_training_dataset_specs (sport_id, status, is_enabled);
CREATE INDEX IF NOT EXISTS idx_hl_training_dataset_build_runs_latest
  ON public.hl_training_dataset_build_runs (
    dataset_spec_id,
    started_at DESC
  );
CREATE INDEX IF NOT EXISTS idx_hl_training_dataset_rows_export
  ON public.hl_training_dataset_rows (
    build_run_id,
    split_key,
    kickoff_at,
    match_id
  );
CREATE INDEX IF NOT EXISTS idx_hl_training_dataset_rows_match
  ON public.hl_training_dataset_rows (
    dataset_spec_id,
    match_id,
    created_at DESC
  );

ALTER TABLE public.hl_training_dataset_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_training_dataset_build_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_training_dataset_rows ENABLE ROW LEVEL SECURITY;

DO $security$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'hl_training_dataset_specs',
    'hl_training_dataset_build_runs',
    'hl_training_dataset_rows'
  ]
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      target_table
    );
    EXECUTE format(
      'GRANT SELECT ON TABLE public.%I TO authenticated',
      target_table
    );
    EXECUTE format(
      'GRANT ALL ON TABLE public.%I TO service_role',
      target_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'admin_read_' || target_table,
      target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      || 'USING ((SELECT public.has_role((SELECT auth.uid()), '
      || '''admin''::public.app_role)))',
      'admin_read_' || target_table,
      target_table
    );
  END LOOP;
END
$security$;

DROP TRIGGER IF EXISTS trg_hl_training_dataset_specs_touch_updated_at
  ON public.hl_training_dataset_specs;
CREATE TRIGGER trg_hl_training_dataset_specs_touch_updated_at
  BEFORE UPDATE ON public.hl_training_dataset_specs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION
  public.prevent_highlightly_training_dataset_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION
    'training dataset rows are immutable; create a new build run instead'
    USING ERRCODE = '55000';
END
$function$;

REVOKE ALL
  ON FUNCTION public.prevent_highlightly_training_dataset_row_mutation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hl_training_dataset_rows_immutable
  ON public.hl_training_dataset_rows;
CREATE TRIGGER trg_hl_training_dataset_rows_immutable
  BEFORE UPDATE OR DELETE ON public.hl_training_dataset_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_highlightly_training_dataset_row_mutation();

INSERT INTO public.hl_training_dataset_specs (
  sport_id,
  code,
  version,
  feature_set_id,
  label_set_id,
  label_version,
  horizon_key,
  status,
  is_enabled,
  minimum_coverage_pct,
  split_policy,
  quality_contract
)
SELECT
  sport.id,
  'highlightly_football_prematch_score',
  '1.0.0',
  feature_set.id,
  label_set.id,
  'highlightly_football_postmatch.score.1.0.0',
  't24h',
  'draft',
  false,
  70,
  jsonb_build_object(
    'strategy', 'temporal_ordered',
    'shuffle', false,
    'train_pct', 70,
    'validation_pct', 15,
    'test_pct', 15,
    'ordering', jsonb_build_array('kickoff_at', 'match_id'),
    'scope', 'per_build_run'
  ),
  jsonb_build_object(
    'quality_contract_version', 'phase8g.3',
    'feature_set', jsonb_build_object(
      'code', feature_set.code,
      'version', feature_set.version,
      'horizon', 't24h',
      'required_leakage_status', 'clean',
      'required_model_eligible', true,
      'minimum_coverage_pct', 70,
      'target_match_facts_used', false,
      'source_timestamps_at_or_before_cutoff', true
    ),
    'label_set', jsonb_build_object(
      'code', label_set.code,
      'version', label_set.version,
      'label_version',
        'highlightly_football_postmatch.score.1.0.0',
      'required_quality_status', 'valid',
      'required_definition_count', 18,
      'required_scope', 'score_based'
    ),
    'temporal_join', jsonb_build_object(
      'feature_cutoff_before_kickoff', true,
      'outcome_at_or_after_kickoff', true,
      'label_available_at_or_after_outcome', true
    ),
    'provider_calls', 0,
    'automatic_training', false,
    'automatic_predictions', false
  )
FROM public.sports AS sport
JOIN public.hl_feature_sets AS feature_set
  ON feature_set.sport_id = sport.id
 AND feature_set.code = 'highlightly_football_prematch'
 AND feature_set.version = '1.2.0'
JOIN public.hl_label_sets AS label_set
  ON label_set.sport_id = sport.id
 AND label_set.code = 'highlightly_football_postmatch'
 AND label_set.version = '1.0.0'
WHERE sport.code = 'football'
ON CONFLICT (sport_id, code, version) DO UPDATE SET
  feature_set_id = EXCLUDED.feature_set_id,
  label_set_id = EXCLUDED.label_set_id,
  label_version = EXCLUDED.label_version,
  horizon_key = EXCLUDED.horizon_key,
  status = 'draft',
  is_enabled = false,
  minimum_coverage_pct = EXCLUDED.minimum_coverage_pct,
  split_policy = EXCLUDED.split_policy,
  quality_contract = EXCLUDED.quality_contract,
  updated_at = now();

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
  ON FUNCTION public.evaluate_highlightly_football_training_dataset_v1(
    timestamptz,
    timestamptz,
    integer
  )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.evaluate_highlightly_football_training_dataset_v1(
    timestamptz,
    timestamptz,
    integer
  )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.get_highlightly_training_dataset_preview_v1(
    p_from timestamptz,
    p_to timestamptz,
    p_limit integer DEFAULT 100
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  provider_enabled boolean;
  result jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'dataset preview window must be ordered'
      USING ERRCODE = '22023';
  END IF;
  IF p_to > p_from + interval '3650 days' THEN
    RAISE EXCEPTION 'dataset preview window must not exceed 3650 days'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'dataset preview limit must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';

  WITH evaluated AS (
    SELECT *
    FROM public.evaluate_highlightly_football_training_dataset_v1(
      p_from,
      p_to,
      p_limit
    )
  ),
  summary AS (
    SELECT
      count(*)::integer AS matches_considered,
      count(*) FILTER (
        WHERE block_reason IS NULL
      )::integer AS rows_eligible,
      count(*) FILTER (
        WHERE block_reason IS NOT NULL
      )::integer AS rows_blocked,
      round(
        100.0 * count(*) FILTER (
          WHERE block_reason IS NULL
        ) / NULLIF(count(*), 0),
        2
      ) AS overlap_pct
    FROM evaluated
  ),
  blockers AS (
    SELECT block_reason, count(*)::integer AS matches
    FROM evaluated
    WHERE block_reason IS NOT NULL
    GROUP BY block_reason
  )
  SELECT jsonb_build_object(
    'phase', '8G.3',
    'quality_contract_version', 'phase8g.3',
    'sport', 'football',
    'feature_set', 'highlightly_football_prematch@1.2.0',
    'label_version',
      'highlightly_football_postmatch.score.1.0.0',
    'horizon', 't24h',
    'window_from', p_from,
    'window_to', p_to,
    'sample_limit', p_limit,
    'matches_considered', summary.matches_considered,
    'rows_eligible', summary.rows_eligible,
    'rows_blocked', summary.rows_blocked,
    'feature_label_overlap_pct', COALESCE(summary.overlap_pct, 0),
    'blockers', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(blocker)
          ORDER BY blocker.matches DESC, blocker.block_reason
        )
        FROM blockers AS blocker
      ),
      '[]'::jsonb
    ),
    'safeguards', jsonb_build_object(
      'read_only', true,
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'temporal_split', true,
      'target_match_facts_forbidden', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN provider_enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      WHEN summary.rows_eligible = 0
        THEN 'expand_feature_label_overlap'
      WHEN summary.rows_eligible < 20
        THEN 'review_small_dataset_canary'
      ELSE 'ready_for_dataset_canary'
    END
  )
  INTO result
  FROM summary;

  RETURN result;
END
$function$;

REVOKE ALL
  ON FUNCTION public.get_highlightly_training_dataset_preview_v1(
    timestamptz,
    timestamptz,
    integer
  )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.get_highlightly_training_dataset_preview_v1(
    timestamptz,
    timestamptz,
    integer
  )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.build_highlightly_football_training_dataset_v1(
    p_from timestamptz,
    p_to timestamptz,
    p_limit integer DEFAULT 100
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  target public.hl_training_dataset_specs%ROWTYPE;
  provider_enabled boolean;
  target_run_id uuid;
  considered_count integer := 0;
  eligible_count integer := 0;
  inserted_count integer := 0;
  blocked_count integer := 0;
  result jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'dataset build window must be ordered'
      USING ERRCODE = '22023';
  END IF;
  IF p_to > p_from + interval '3650 days' THEN
    RAISE EXCEPTION 'dataset build window must not exceed 3650 days'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'dataset build limit must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must be disabled before dataset build'
      USING ERRCODE = '55000';
  END IF;

  SELECT dataset_spec.*
  INTO target
  FROM public.hl_training_dataset_specs AS dataset_spec
  JOIN public.sports AS sport
    ON sport.id = dataset_spec.sport_id
   AND sport.code = 'football'
  JOIN public.hl_feature_sets AS feature_set
    ON feature_set.id = dataset_spec.feature_set_id
   AND feature_set.code = 'highlightly_football_prematch'
   AND feature_set.version = '1.2.0'
   AND feature_set.status = 'draft'
   AND NOT feature_set.is_enabled
  JOIN public.hl_label_sets AS label_set
    ON label_set.id = dataset_spec.label_set_id
   AND label_set.code = 'highlightly_football_postmatch'
   AND label_set.version = '1.0.0'
   AND label_set.status = 'draft'
   AND NOT label_set.is_enabled
  WHERE dataset_spec.code = 'highlightly_football_prematch_score'
    AND dataset_spec.version = '1.0.0'
  LIMIT 1;

  IF target.id IS NULL
     OR target.status IS DISTINCT FROM 'draft'
     OR target.is_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Football dataset canary requires draft, disabled contracts'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.hl_training_dataset_build_runs (
    dataset_spec_id,
    sport_id,
    window_from,
    window_to,
    sample_limit,
    diagnostics
  )
  VALUES (
    target.id,
    target.sport_id,
    p_from,
    p_to,
    p_limit,
    jsonb_build_object(
      'phase', '8G.3',
      'quality_contract_version', 'phase8g.3',
      'generation_mode', 'manual_canary',
      'feature_set', 'highlightly_football_prematch@1.2.0',
      'label_version', target.label_version,
      'horizon', target.horizon_key,
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  )
  RETURNING id INTO target_run_id;

  WITH evaluated AS (
    SELECT *
    FROM public.evaluate_highlightly_football_training_dataset_v1(
      p_from,
      p_to,
      p_limit
    )
  ),
  eligible AS (
    SELECT
      evaluated.*,
      row_number() OVER (
        ORDER BY evaluated.kickoff_at, evaluated.match_id
      ) AS row_position,
      count(*) OVER () AS total_rows
    FROM evaluated
    WHERE evaluated.block_reason IS NULL
  ),
  inserted AS (
    INSERT INTO public.hl_training_dataset_rows (
      build_run_id,
      dataset_spec_id,
      match_id,
      feature_snapshot_id,
      label_id,
      split_key,
      horizon_key,
      feature_cutoff_at,
      kickoff_at,
      outcome_at,
      feature_coverage_pct,
      competition_profile,
      row_fingerprint
    )
    SELECT
      target_run_id,
      target.id,
      eligible.match_id,
      eligible.feature_snapshot_id,
      eligible.label_id,
      CASE
        WHEN (eligible.row_position - 1)::numeric
          / NULLIF(eligible.total_rows, 0) < 0.70 THEN 'train'
        WHEN (eligible.row_position - 1)::numeric
          / NULLIF(eligible.total_rows, 0) < 0.85 THEN 'validation'
        ELSE 'test'
      END,
      target.horizon_key,
      eligible.feature_cutoff_at,
      eligible.kickoff_at,
      eligible.outcome_at,
      eligible.feature_coverage_pct,
      eligible.competition_profile,
      md5(
        target.id::text
        || ':' || eligible.feature_snapshot_id::text
        || ':' || eligible.label_id::text
      )
    FROM eligible
    RETURNING id
  )
  SELECT
    (SELECT count(*)::integer FROM evaluated),
    (SELECT count(*)::integer FROM eligible),
    (SELECT count(*)::integer FROM inserted)
  INTO considered_count, eligible_count, inserted_count;

  blocked_count := greatest(considered_count - eligible_count, 0);

  UPDATE public.hl_training_dataset_build_runs AS run
  SET
    status = CASE
      WHEN blocked_count > 0 THEN 'completed_with_exceptions'
      ELSE 'completed'
    END,
    matches_considered = considered_count,
    rows_eligible = eligible_count,
    rows_inserted = inserted_count,
    rows_blocked = blocked_count,
    provider_calls = 0,
    finished_at = statement_timestamp(),
    diagnostics = run.diagnostics || jsonb_build_object(
      'rows_inserted', inserted_count,
      'rows_blocked', blocked_count
    )
  WHERE run.id = target_run_id;

  SELECT jsonb_build_object(
    'phase', '8G.3',
    'quality_contract_version', 'phase8g.3',
    'build_run_id', target_run_id,
    'sport', 'football',
    'dataset_spec', jsonb_build_object(
      'code', target.code,
      'version', target.version,
      'status', target.status,
      'is_enabled', target.is_enabled
    ),
    'feature_set', 'highlightly_football_prematch@1.2.0',
    'label_version', target.label_version,
    'horizon', target.horizon_key,
    'matches_considered', considered_count,
    'rows_eligible', eligible_count,
    'rows_inserted', inserted_count,
    'rows_blocked', blocked_count,
    'splits', COALESCE(
      (
        SELECT jsonb_object_agg(split_summary.split_key, split_summary.rows)
        FROM (
          SELECT split_key, count(*)::integer AS rows
          FROM public.hl_training_dataset_rows
          WHERE build_run_id = target_run_id
          GROUP BY split_key
        ) AS split_summary
      ),
      '{}'::jsonb
    ),
    'safeguards', jsonb_build_object(
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'temporal_split', true,
      'immutable_rows', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN inserted_count = 0 THEN 'expand_feature_label_overlap'
      WHEN inserted_count < 20 THEN 'review_small_dataset_canary'
      WHEN inserted_count < 100 THEN 'review_canary_then_expand_to_100'
      ELSE 'ready_for_phase8g4_export_contract'
    END
  )
  INTO result;

  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    IF target_run_id IS NOT NULL THEN
      UPDATE public.hl_training_dataset_build_runs
      SET
        status = 'failed',
        provider_calls = 0,
        finished_at = statement_timestamp(),
        diagnostics = diagnostics || jsonb_build_object(
          'sqlstate', SQLSTATE,
          'error', SQLERRM,
          'provider_calls', 0
        )
      WHERE id = target_run_id;
    END IF;
    RAISE;
END
$function$;

REVOKE ALL
  ON FUNCTION public.build_highlightly_football_training_dataset_v1(
    timestamptz,
    timestamptz,
    integer
  )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.build_highlightly_football_training_dataset_v1(
    timestamptz,
    timestamptz,
    integer
  )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.get_highlightly_training_dataset_report_v1(
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
    RAISE EXCEPTION 'Phase 8G.3 currently supports Football only'
      USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'dataset report days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role(
         (SELECT auth.uid()),
         'admin'::public.app_role
       )
     ) THEN
    RAISE EXCEPTION 'Highlightly dataset report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH target AS (
    SELECT dataset_spec.*
    FROM public.hl_training_dataset_specs AS dataset_spec
    JOIN public.sports AS sport
      ON sport.id = dataset_spec.sport_id
     AND sport.code = p_sport
    WHERE dataset_spec.code = 'highlightly_football_prematch_score'
      AND dataset_spec.version = '1.0.0'
    LIMIT 1
  ),
  recent_runs AS (
    SELECT run.*
    FROM target
    JOIN public.hl_training_dataset_build_runs AS run
      ON run.dataset_spec_id = target.id
    WHERE run.started_at
      >= statement_timestamp() - make_interval(days => p_days)
  ),
  latest_run AS (
    SELECT run.*
    FROM recent_runs AS run
    ORDER BY run.started_at DESC, run.id DESC
    LIMIT 1
  ),
  latest_rows AS (
    SELECT dataset_row.*
    FROM latest_run
    JOIN public.hl_training_dataset_rows AS dataset_row
      ON dataset_row.build_run_id = latest_run.id
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
      COALESCE(sum(matches_considered), 0)::integer
        AS matches_considered,
      COALESCE(sum(rows_eligible), 0)::integer AS rows_eligible,
      COALESCE(sum(rows_inserted), 0)::integer AS rows_inserted,
      COALESCE(sum(rows_blocked), 0)::integer AS rows_blocked,
      COALESCE(sum(provider_calls), 0)::integer AS provider_calls,
      max(finished_at) AS last_finished_at
    FROM recent_runs
  ),
  latest_summary AS (
    SELECT
      count(*)::integer AS rows,
      count(*) FILTER (
        WHERE split_key = 'train'
      )::integer AS train_rows,
      count(*) FILTER (
        WHERE split_key = 'validation'
      )::integer AS validation_rows,
      count(*) FILTER (
        WHERE split_key = 'test'
      )::integer AS test_rows,
      count(DISTINCT match_id)::integer AS distinct_matches,
      round(avg(feature_coverage_pct), 2) AS average_coverage_pct,
      min(feature_coverage_pct) AS minimum_coverage_pct,
      max(feature_coverage_pct) AS maximum_coverage_pct,
      min(kickoff_at) AS first_kickoff_at,
      max(kickoff_at) AS last_kickoff_at
    FROM latest_rows
  ),
  profile_summary AS (
    SELECT competition_profile, count(*)::integer AS rows
    FROM latest_rows
    GROUP BY competition_profile
  ),
  integrity AS (
    SELECT
      count(*) FILTER (
        WHERE dataset_row.feature_cutoff_at >= dataset_row.kickoff_at
          OR dataset_row.kickoff_at > dataset_row.outcome_at
      )::integer AS temporal_violations,
      count(*) FILTER (
        WHERE snapshot.id IS NULL
          OR snapshot.match_id <> dataset_row.match_id
          OR snapshot.feature_set_id <> target.feature_set_id
          OR snapshot.horizon_key <> target.horizon_key
          OR snapshot.leakage_status <> 'clean'
          OR dataset_row.feature_coverage_pct
            < target.minimum_coverage_pct
          OR COALESCE(
            (snapshot.quality ->> 'model_eligible')::boolean,
            false
          ) IS DISTINCT FROM true
      )::integer AS feature_reference_violations,
      count(*) FILTER (
        WHERE label.id IS NULL
          OR label.match_id <> dataset_row.match_id
          OR label.label_set_id <> target.label_set_id
          OR label.label_version <> target.label_version
          OR label.quality_status <> 'valid'
          OR label.label_available_at < label.outcome_at
      )::integer AS label_reference_violations,
      count(*) FILTER (
        WHERE COALESCE(
          snapshot.lineage ->> 'target_match_facts_used',
          'missing'
        ) <> 'false'
          OR NULLIF(
            snapshot.lineage ->> 'home_source_max_at',
            ''
          )::timestamptz > snapshot.cutoff_at
          OR NULLIF(
            snapshot.lineage ->> 'away_source_max_at',
            ''
          )::timestamptz > snapshot.cutoff_at
          OR NULLIF(
            snapshot.lineage ->> 'odds_source_max_at',
            ''
          )::timestamptz > snapshot.cutoff_at
          OR NULLIF(
            snapshot.lineage ->> 'lineup_source_max_at',
            ''
          )::timestamptz > snapshot.cutoff_at
      )::integer AS lineage_violations
    FROM latest_rows AS dataset_row
    LEFT JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.id = dataset_row.feature_snapshot_id
    LEFT JOIN public.hl_match_labels AS label
      ON label.id = dataset_row.label_id
    CROSS JOIN target
  ),
  provider_state AS (
    SELECT enabled
    FROM public.sports_providers
    WHERE code = 'highlightly'
  )
  SELECT jsonb_build_object(
    'phase', '8G.3',
    'quality_contract_version', 'phase8g.3',
    'sport', p_sport,
    'window_days', p_days,
    'dataset_spec', jsonb_build_object(
      'code', target.code,
      'version', target.version,
      'status', target.status,
      'is_enabled', target.is_enabled,
      'feature_set_id', target.feature_set_id,
      'label_set_id', target.label_set_id,
      'label_version', target.label_version,
      'horizon', target.horizon_key,
      'minimum_coverage_pct', target.minimum_coverage_pct,
      'split_policy', target.split_policy
    ),
    'runs', to_jsonb(run_summary),
    'latest_run', CASE
      WHEN latest_run.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', latest_run.id,
        'status', latest_run.status,
        'window_from', latest_run.window_from,
        'window_to', latest_run.window_to,
        'sample_limit', latest_run.sample_limit,
        'matches_considered', latest_run.matches_considered,
        'rows_eligible', latest_run.rows_eligible,
        'rows_inserted', latest_run.rows_inserted,
        'rows_blocked', latest_run.rows_blocked,
        'started_at', latest_run.started_at,
        'finished_at', latest_run.finished_at
      )
    END,
    'rows', to_jsonb(latest_summary),
    'competition_profiles', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(profile)
          ORDER BY profile.rows DESC, profile.competition_profile
        )
        FROM profile_summary AS profile
      ),
      '[]'::jsonb
    ),
    'integrity', jsonb_build_object(
      'provider_disabled', provider_state.enabled = false,
      'provider_calls_zero', run_summary.provider_calls = 0,
      'dataset_spec_draft_disabled',
        target.status = 'draft' AND NOT target.is_enabled,
      'temporal_violations', integrity.temporal_violations,
      'feature_reference_violations',
        integrity.feature_reference_violations,
      'label_reference_violations',
        integrity.label_reference_violations,
      'lineage_violations', integrity.lineage_violations,
      'distinct_match_rows',
        latest_summary.rows = latest_summary.distinct_matches
    ),
    'safeguards', jsonb_build_object(
      'provider_calls', 0,
      'dataset_rows_immutable', true,
      'temporal_split', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN provider_state.enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      WHEN run_summary.failed_runs > 0
        THEN 'investigate_failed_dataset_build'
      WHEN integrity.temporal_violations > 0
        OR integrity.feature_reference_violations > 0
        OR integrity.label_reference_violations > 0
        OR integrity.lineage_violations > 0
        THEN 'block_training_and_review_integrity'
      WHEN latest_run.id IS NULL
        THEN 'ready_for_dataset_canary'
      WHEN latest_summary.rows = 0
        THEN 'expand_feature_label_overlap'
      WHEN latest_summary.rows < 20
        THEN 'review_small_dataset_canary'
      WHEN latest_summary.rows < 100
        THEN 'review_canary_then_expand_to_100'
      ELSE 'ready_for_phase8g4_export_contract'
    END
  )
  INTO result
  FROM target
  CROSS JOIN run_summary
  LEFT JOIN latest_run ON true
  CROSS JOIN latest_summary
  CROSS JOIN integrity
  CROSS JOIN provider_state;

  RETURN COALESCE(
    result,
    jsonb_build_object(
      'phase', '8G.3',
      'sport', p_sport,
      'recommendation', 'dataset_contract_missing'
    )
  );
END
$function$;

REVOKE ALL
  ON FUNCTION public.get_highlightly_training_dataset_report_v1(
    text,
    integer
  )
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.get_highlightly_training_dataset_report_v1(
    text,
    integer
  )
  TO authenticated, service_role;

COMMENT ON TABLE public.hl_training_dataset_specs IS
  'Versioned, disabled-by-default contracts joining immutable pre-match features to post-match labels.';
COMMENT ON TABLE public.hl_training_dataset_build_runs IS
  'Audited manual Phase 8G.3 dataset builds; provider calls are forbidden.';
COMMENT ON TABLE public.hl_training_dataset_rows IS
  'Immutable run-scoped references to leakage-clean feature snapshots and valid labels.';
COMMENT ON FUNCTION
  public.get_highlightly_training_dataset_preview_v1(
    timestamptz,
    timestamptz,
    integer
  ) IS
  'Read-only Phase 8G.3 Football feature-label overlap and blocker preview.';
COMMENT ON FUNCTION
  public.build_highlightly_football_training_dataset_v1(
    timestamptz,
    timestamptz,
    integer
  ) IS
  'Manual Phase 8G.3 Football dataset build over stored immutable data, with temporal splits and zero provider calls.';
COMMENT ON FUNCTION
  public.get_highlightly_training_dataset_report_v1(
    text,
    integer
  ) IS
  'Admin-gated Phase 8G.3 dataset quality, temporal integrity and split report.';

NOTIFY pgrst, 'reload schema';
