CREATE TABLE IF NOT EXISTS public.hl_training_readiness_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_spec_id uuid NOT NULL UNIQUE
    REFERENCES public.hl_training_dataset_specs(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft',
  is_enabled boolean NOT NULL DEFAULT false,
  minimum_total_rows integer NOT NULL DEFAULT 500,
  minimum_train_rows integer NOT NULL DEFAULT 350,
  minimum_validation_rows integer NOT NULL DEFAULT 75,
  minimum_test_rows integer NOT NULL DEFAULT 75,
  minimum_distinct_competitions integer NOT NULL DEFAULT 10,
  minimum_observation_days integer NOT NULL DEFAULT 60,
  minimum_outcome_class_rows integer NOT NULL DEFAULT 50,
  minimum_outcome_class_pct numeric(7, 2) NOT NULL DEFAULT 10,
  maximum_outcome_class_pct numeric(7, 2) NOT NULL DEFAULT 70,
  required_outcome_classes text[] NOT NULL
    DEFAULT ARRAY['home', 'draw', 'away']::text[],
  quality_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_training_readiness_policies_status_check
    CHECK (status IN ('draft', 'shadow', 'active', 'retired')),
  CONSTRAINT hl_training_readiness_policies_rows_check
    CHECK (
      minimum_total_rows >= 1
      AND minimum_train_rows >= 1
      AND minimum_validation_rows >= 1
      AND minimum_test_rows >= 1
      AND minimum_train_rows
        + minimum_validation_rows
        + minimum_test_rows
        <= minimum_total_rows
    ),
  CONSTRAINT hl_training_readiness_policies_scope_check
    CHECK (
      minimum_distinct_competitions >= 1
      AND minimum_observation_days >= 1
    ),
  CONSTRAINT hl_training_readiness_policies_outcome_check
    CHECK (
      minimum_outcome_class_rows >= 1
      AND minimum_outcome_class_pct BETWEEN 0 AND 100
      AND maximum_outcome_class_pct BETWEEN 0 AND 100
      AND minimum_outcome_class_pct < maximum_outcome_class_pct
      AND cardinality(required_outcome_classes) >= 2
    ),
  CONSTRAINT hl_training_readiness_policies_quality_contract_check
    CHECK (jsonb_typeof(quality_contract) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_hl_training_readiness_policies_state
  ON public.hl_training_readiness_policies (
    dataset_spec_id,
    status,
    is_enabled
  );

ALTER TABLE public.hl_training_readiness_policies
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL
  ON TABLE public.hl_training_readiness_policies
  FROM PUBLIC, anon, authenticated;
GRANT SELECT
  ON TABLE public.hl_training_readiness_policies
  TO authenticated;
GRANT ALL
  ON TABLE public.hl_training_readiness_policies
  TO service_role;

DROP POLICY IF EXISTS admin_read_hl_training_readiness_policies
  ON public.hl_training_readiness_policies;
CREATE POLICY admin_read_hl_training_readiness_policies
  ON public.hl_training_readiness_policies
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

DROP TRIGGER IF EXISTS trg_hl_training_readiness_policies_touch_updated_at
  ON public.hl_training_readiness_policies;
CREATE TRIGGER trg_hl_training_readiness_policies_touch_updated_at
  BEFORE UPDATE ON public.hl_training_readiness_policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.hl_training_readiness_policies (
  dataset_spec_id,
  status,
  is_enabled,
  minimum_total_rows,
  minimum_train_rows,
  minimum_validation_rows,
  minimum_test_rows,
  minimum_distinct_competitions,
  minimum_observation_days,
  minimum_outcome_class_rows,
  minimum_outcome_class_pct,
  maximum_outcome_class_pct,
  required_outcome_classes,
  quality_contract
)
SELECT
  dataset_spec.id,
  'draft',
  false,
  500,
  350,
  75,
  75,
  10,
  60,
  50,
  10,
  70,
  ARRAY['home', 'draw', 'away']::text[],
  jsonb_build_object(
    'quality_contract_version', 'phase8g.4',
    'decision_owner', 'deterministic_readiness_gate',
    'target_market', 'full_time_result',
    'target_domain', jsonb_build_array('home', 'draw', 'away'),
    'latest_build_run_only', true,
    'temporal_split_required', true,
    'provider_calls', 0,
    'automatic_training', false,
    'automatic_predictions', false
  )
FROM public.hl_training_dataset_specs AS dataset_spec
JOIN public.sports AS sport
  ON sport.id = dataset_spec.sport_id
 AND sport.code = 'football'
WHERE dataset_spec.code = 'highlightly_football_prematch_score'
  AND dataset_spec.version = '1.0.0'
ON CONFLICT (dataset_spec_id) DO UPDATE SET
  status = 'draft',
  is_enabled = false,
  minimum_total_rows = EXCLUDED.minimum_total_rows,
  minimum_train_rows = EXCLUDED.minimum_train_rows,
  minimum_validation_rows = EXCLUDED.minimum_validation_rows,
  minimum_test_rows = EXCLUDED.minimum_test_rows,
  minimum_distinct_competitions
    = EXCLUDED.minimum_distinct_competitions,
  minimum_observation_days = EXCLUDED.minimum_observation_days,
  minimum_outcome_class_rows = EXCLUDED.minimum_outcome_class_rows,
  minimum_outcome_class_pct = EXCLUDED.minimum_outcome_class_pct,
  maximum_outcome_class_pct = EXCLUDED.maximum_outcome_class_pct,
  required_outcome_classes = EXCLUDED.required_outcome_classes,
  quality_contract = EXCLUDED.quality_contract,
  updated_at = now();

CREATE OR REPLACE FUNCTION
  public.get_highlightly_training_readiness_report_v1(
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
  target_policy public.hl_training_readiness_policies%ROWTYPE;
  target_spec public.hl_training_dataset_specs%ROWTYPE;
  dataset_report jsonb;
  latest_run_id uuid;
  provider_enabled boolean;
  total_rows integer := 0;
  train_rows integer := 0;
  validation_rows integer := 0;
  test_rows integer := 0;
  distinct_matches integer := 0;
  distinct_competitions integer := 0;
  observation_days integer := 0;
  minimum_coverage_pct numeric := 0;
  outcome_distribution jsonb := '[]'::jsonb;
  competition_profiles jsonb := '[]'::jsonb;
  outcomes_below_minimum integer := 0;
  outcomes_outside_pct_bounds integer := 0;
  integrity_clean boolean := false;
  volume_ready boolean := false;
  scope_ready boolean := false;
  outcome_ready boolean := false;
  data_ready boolean := false;
  manual_training_authorized boolean := false;
  gates jsonb := '[]'::jsonb;
  failed_gates integer := 0;
  result jsonb;
BEGIN
  IF p_sport IS DISTINCT FROM 'football' THEN
    RAISE EXCEPTION 'Phase 8G.4 currently supports Football only'
      USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'readiness report days must be between 1 and 3650'
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
      'Highlightly training readiness report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    readiness_policy,
    dataset_spec
  INTO
    target_policy,
    target_spec
  FROM public.hl_training_readiness_policies AS readiness_policy
  JOIN public.hl_training_dataset_specs AS dataset_spec
    ON dataset_spec.id = readiness_policy.dataset_spec_id
  JOIN public.sports AS sport
    ON sport.id = dataset_spec.sport_id
   AND sport.code = p_sport
  WHERE dataset_spec.code = 'highlightly_football_prematch_score'
    AND dataset_spec.version = '1.0.0'
  LIMIT 1;

  IF target_policy.id IS NULL OR target_spec.id IS NULL THEN
    RETURN jsonb_build_object(
      'phase', '8G.4',
      'quality_contract_version', 'phase8g.4',
      'sport', p_sport,
      'data_ready', false,
      'manual_training_authorized', false,
      'recommendation', 'install_training_readiness_contract'
    );
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';

  dataset_report :=
    public.get_highlightly_training_dataset_report_v1(
      p_sport,
      p_days
    );
  latest_run_id :=
    NULLIF(dataset_report #>> '{latest_run,id}', '')::uuid;

  IF latest_run_id IS NOT NULL THEN
    WITH latest_rows AS (
      SELECT
        dataset_row.*,
        match_row.competition_id,
        label.labels AS label_payload
      FROM public.hl_training_dataset_rows AS dataset_row
      JOIN public.sports_matches AS match_row
        ON match_row.id = dataset_row.match_id
      JOIN public.hl_match_labels AS label
        ON label.id = dataset_row.label_id
      WHERE dataset_row.build_run_id = latest_run_id
    ),
    row_summary AS (
      SELECT
        count(*)::integer AS total_rows,
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
        count(DISTINCT competition_id)::integer
          AS distinct_competitions,
        CASE
          WHEN min(kickoff_at) IS NULL OR max(kickoff_at) IS NULL
            THEN 0
          ELSE floor(
            extract(epoch FROM (max(kickoff_at) - min(kickoff_at)))
              / 86400
          )::integer + 1
        END AS observation_days,
        COALESCE(min(feature_coverage_pct), 0)
          AS minimum_coverage_pct
      FROM latest_rows
    ),
    profile_summary AS (
      SELECT
        competition_profile,
        count(*)::integer AS rows
      FROM latest_rows
      GROUP BY competition_profile
    )
    SELECT
      summary.total_rows,
      summary.train_rows,
      summary.validation_rows,
      summary.test_rows,
      summary.distinct_matches,
      summary.distinct_competitions,
      summary.observation_days,
      summary.minimum_coverage_pct,
      COALESCE(
        (
          SELECT jsonb_agg(
            to_jsonb(profile)
            ORDER BY profile.rows DESC, profile.competition_profile
          )
          FROM profile_summary AS profile
        ),
        '[]'::jsonb
      )
    INTO
      total_rows,
      train_rows,
      validation_rows,
      test_rows,
      distinct_matches,
      distinct_competitions,
      observation_days,
      minimum_coverage_pct,
      competition_profiles
    FROM row_summary AS summary;

    WITH latest_rows AS (
      SELECT
        dataset_row.match_id,
        label.labels AS label_payload
      FROM public.hl_training_dataset_rows AS dataset_row
      JOIN public.hl_match_labels AS label
        ON label.id = dataset_row.label_id
      WHERE dataset_row.build_run_id = latest_run_id
    ),
    actual_outcomes AS (
      SELECT
        label_value ->> 'outcome' AS outcome,
        count(DISTINCT latest_row.match_id)::integer AS rows
      FROM latest_rows AS latest_row
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(
          latest_row.label_payload -> 'values',
          '[]'::jsonb
        )
      ) AS label_value
      WHERE label_value ->> 'label_key' = 'full_time_result'
      GROUP BY label_value ->> 'outcome'
    ),
    required_outcomes AS (
      SELECT unnest(target_policy.required_outcome_classes) AS outcome
    ),
    assessed_outcomes AS (
      SELECT
        required.outcome,
        COALESCE(actual.rows, 0)::integer AS rows,
        round(
          100.0 * COALESCE(actual.rows, 0)
            / NULLIF(total_rows, 0),
          2
        ) AS pct,
        COALESCE(actual.rows, 0)
          >= target_policy.minimum_outcome_class_rows
          AS meets_minimum_rows,
        COALESCE(
          100.0 * actual.rows / NULLIF(total_rows, 0)
            BETWEEN target_policy.minimum_outcome_class_pct
              AND target_policy.maximum_outcome_class_pct,
          false
        ) AS within_pct_bounds
      FROM required_outcomes AS required
      LEFT JOIN actual_outcomes AS actual
        ON actual.outcome = required.outcome
    )
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'outcome', assessed.outcome,
            'rows', assessed.rows,
            'pct', COALESCE(assessed.pct, 0),
            'meets_minimum_rows', assessed.meets_minimum_rows,
            'within_pct_bounds', assessed.within_pct_bounds
          )
          ORDER BY array_position(
            target_policy.required_outcome_classes,
            assessed.outcome
          )
        ),
        '[]'::jsonb
      ),
      count(*) FILTER (
        WHERE NOT assessed.meets_minimum_rows
      )::integer,
      count(*) FILTER (
        WHERE NOT assessed.within_pct_bounds
      )::integer
    INTO
      outcome_distribution,
      outcomes_below_minimum,
      outcomes_outside_pct_bounds
    FROM assessed_outcomes AS assessed;
  END IF;

  integrity_clean :=
    COALESCE(
      (dataset_report #>> '{integrity,provider_disabled}')::boolean,
      false
    )
    AND COALESCE(
      (dataset_report #>> '{integrity,provider_calls_zero}')::boolean,
      false
    )
    AND COALESCE(
      (dataset_report #>> '{integrity,dataset_spec_draft_disabled}')
        ::boolean,
      false
    )
    AND COALESCE(
      (dataset_report #>> '{integrity,distinct_match_rows}')::boolean,
      false
    )
    AND COALESCE(
      (dataset_report #>> '{integrity,temporal_violations}')::integer,
      -1
    ) = 0
    AND COALESCE(
      (
        dataset_report
          #>> '{integrity,feature_reference_violations}'
      )::integer,
      -1
    ) = 0
    AND COALESCE(
      (
        dataset_report
          #>> '{integrity,label_reference_violations}'
      )::integer,
      -1
    ) = 0
    AND COALESCE(
      (dataset_report #>> '{integrity,lineage_violations}')::integer,
      -1
    ) = 0;

  volume_ready :=
    total_rows >= target_policy.minimum_total_rows
    AND train_rows >= target_policy.minimum_train_rows
    AND validation_rows >= target_policy.minimum_validation_rows
    AND test_rows >= target_policy.minimum_test_rows;
  scope_ready :=
    distinct_competitions
      >= target_policy.minimum_distinct_competitions
    AND observation_days >= target_policy.minimum_observation_days;
  outcome_ready :=
    outcomes_below_minimum = 0
    AND outcomes_outside_pct_bounds = 0;
  data_ready :=
    provider_enabled IS FALSE
    AND integrity_clean
    AND volume_ready
    AND scope_ready
    AND outcome_ready
    AND total_rows = distinct_matches;
  manual_training_authorized :=
    data_ready
    AND target_policy.status = 'active'
    AND target_policy.is_enabled
    AND target_spec.status = 'active'
    AND target_spec.is_enabled;

  gates := jsonb_build_array(
    jsonb_build_object(
      'key', 'provider_disabled',
      'passed', provider_enabled IS FALSE,
      'actual', provider_enabled,
      'required', false
    ),
    jsonb_build_object(
      'key', 'integrity_clean',
      'passed', integrity_clean,
      'actual', integrity_clean,
      'required', true
    ),
    jsonb_build_object(
      'key', 'distinct_match_rows',
      'passed', total_rows = distinct_matches,
      'actual', distinct_matches,
      'required', total_rows
    ),
    jsonb_build_object(
      'key', 'minimum_total_rows',
      'passed', total_rows >= target_policy.minimum_total_rows,
      'actual', total_rows,
      'required', target_policy.minimum_total_rows
    ),
    jsonb_build_object(
      'key', 'minimum_train_rows',
      'passed', train_rows >= target_policy.minimum_train_rows,
      'actual', train_rows,
      'required', target_policy.minimum_train_rows
    ),
    jsonb_build_object(
      'key', 'minimum_validation_rows',
      'passed',
        validation_rows >= target_policy.minimum_validation_rows,
      'actual', validation_rows,
      'required', target_policy.minimum_validation_rows
    ),
    jsonb_build_object(
      'key', 'minimum_test_rows',
      'passed', test_rows >= target_policy.minimum_test_rows,
      'actual', test_rows,
      'required', target_policy.minimum_test_rows
    ),
    jsonb_build_object(
      'key', 'minimum_distinct_competitions',
      'passed',
        distinct_competitions
          >= target_policy.minimum_distinct_competitions,
      'actual', distinct_competitions,
      'required', target_policy.minimum_distinct_competitions
    ),
    jsonb_build_object(
      'key', 'minimum_observation_days',
      'passed',
        observation_days >= target_policy.minimum_observation_days,
      'actual', observation_days,
      'required', target_policy.minimum_observation_days
    ),
    jsonb_build_object(
      'key', 'outcome_distribution',
      'passed', outcome_ready,
      'actual', outcome_distribution,
      'required', jsonb_build_object(
        'minimum_rows_per_class',
          target_policy.minimum_outcome_class_rows,
        'minimum_pct', target_policy.minimum_outcome_class_pct,
        'maximum_pct', target_policy.maximum_outcome_class_pct
      )
    )
  );

  SELECT count(*)::integer
  INTO failed_gates
  FROM jsonb_array_elements(gates) AS gate
  WHERE COALESCE((gate ->> 'passed')::boolean, false) = false;

  result := jsonb_build_object(
    'phase', '8G.4',
    'quality_contract_version', 'phase8g.4',
    'sport', p_sport,
    'window_days', p_days,
    'dataset_spec', jsonb_build_object(
      'code', target_spec.code,
      'version', target_spec.version,
      'status', target_spec.status,
      'is_enabled', target_spec.is_enabled,
      'latest_build_run_id', latest_run_id
    ),
    'readiness_policy', jsonb_build_object(
      'status', target_policy.status,
      'is_enabled', target_policy.is_enabled,
      'minimum_total_rows', target_policy.minimum_total_rows,
      'minimum_train_rows', target_policy.minimum_train_rows,
      'minimum_validation_rows',
        target_policy.minimum_validation_rows,
      'minimum_test_rows', target_policy.minimum_test_rows,
      'minimum_distinct_competitions',
        target_policy.minimum_distinct_competitions,
      'minimum_observation_days',
        target_policy.minimum_observation_days,
      'minimum_outcome_class_rows',
        target_policy.minimum_outcome_class_rows,
      'minimum_outcome_class_pct',
        target_policy.minimum_outcome_class_pct,
      'maximum_outcome_class_pct',
        target_policy.maximum_outcome_class_pct,
      'required_outcome_classes',
        target_policy.required_outcome_classes
    ),
    'actuals', jsonb_build_object(
      'total_rows', total_rows,
      'train_rows', train_rows,
      'validation_rows', validation_rows,
      'test_rows', test_rows,
      'distinct_matches', distinct_matches,
      'distinct_competitions', distinct_competitions,
      'observation_days', observation_days,
      'minimum_coverage_pct', minimum_coverage_pct
    ),
    'outcome_distribution', outcome_distribution,
    'competition_profiles', competition_profiles,
    'gates', gates,
    'gates_passed', jsonb_array_length(gates) - failed_gates,
    'gates_failed', failed_gates,
    'readiness_pct', round(
      100.0
        * (jsonb_array_length(gates) - failed_gates)
        / NULLIF(jsonb_array_length(gates), 0),
      2
    ),
    'data_ready', data_ready,
    'manual_training_authorized', manual_training_authorized,
    'safeguards', jsonb_build_object(
      'read_only', true,
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'database_writes', 0,
      'latest_build_run_only', true,
      'deterministic_gate', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN provider_enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      WHEN NOT integrity_clean
        THEN 'block_training_and_review_integrity'
      WHEN total_rows < target_policy.minimum_total_rows
        THEN 'accumulate_more_eligible_matches'
      WHEN NOT volume_ready
        THEN 'expand_temporal_split_volume'
      WHEN observation_days
        < target_policy.minimum_observation_days
        THEN 'expand_observation_window'
      WHEN distinct_competitions
        < target_policy.minimum_distinct_competitions
        THEN 'expand_competition_coverage'
      WHEN NOT outcome_ready
        THEN 'collect_more_balanced_outcomes'
      WHEN NOT manual_training_authorized
        THEN 'ready_for_manual_policy_review'
      ELSE 'ready_for_manual_training_canary'
    END
  );

  RETURN result;
END
$function$;

REVOKE ALL
  ON FUNCTION public.get_highlightly_training_readiness_report_v1(
    text,
    integer
  )
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.get_highlightly_training_readiness_report_v1(
    text,
    integer
  )
  TO authenticated, service_role;

COMMENT ON TABLE public.hl_training_readiness_policies IS
  'Disabled-by-default deterministic thresholds that gate manual Football training readiness.';
COMMENT ON FUNCTION
  public.get_highlightly_training_readiness_report_v1(
    text,
    integer
  ) IS
  'Read-only Phase 8G.4 report separating data readiness from manual training authorization.';

NOTIFY pgrst, 'reload schema';
