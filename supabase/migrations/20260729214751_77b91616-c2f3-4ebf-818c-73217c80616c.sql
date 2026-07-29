CREATE TABLE IF NOT EXISTS public.hl_training_accumulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'running',
  window_days integer NOT NULL,
  label_limit integer NOT NULL,
  feature_limit integer NOT NULL,
  max_candidates_per_kickoff integer NOT NULL,
  dataset_limit integer NOT NULL,
  label_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  dataset_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_calls integer NOT NULL DEFAULT 0,
  automatic_training boolean NOT NULL DEFAULT false,
  automatic_predictions boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_training_accumulation_runs_status_check
    CHECK (
      status IN (
        'running',
        'completed',
        'completed_with_exceptions',
        'failed'
      )
    ),
  CONSTRAINT hl_training_accumulation_runs_limits_check
    CHECK (
      window_days BETWEEN 1 AND 3650
      AND label_limit BETWEEN 1 AND 200
      AND feature_limit BETWEEN 1 AND 200
      AND max_candidates_per_kickoff BETWEEN 1 AND 500
      AND dataset_limit BETWEEN 1 AND 5000
    ),
  CONSTRAINT hl_training_accumulation_runs_safety_check
    CHECK (
      provider_calls = 0
      AND NOT automatic_training
      AND NOT automatic_predictions
    ),
  CONSTRAINT hl_training_accumulation_runs_payload_check
    CHECK (
      jsonb_typeof(label_result) = 'object'
      AND jsonb_typeof(feature_result) = 'object'
      AND jsonb_typeof(dataset_result) = 'object'
      AND jsonb_typeof(readiness_result) = 'object'
      AND jsonb_typeof(diagnostics) = 'object'
    )
);

CREATE INDEX IF NOT EXISTS idx_hl_training_accumulation_runs_latest
  ON public.hl_training_accumulation_runs (
    sport_id,
    started_at DESC
  );

ALTER TABLE public.hl_training_accumulation_runs
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL
  ON TABLE public.hl_training_accumulation_runs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT
  ON TABLE public.hl_training_accumulation_runs
  TO authenticated;
GRANT ALL
  ON TABLE public.hl_training_accumulation_runs
  TO service_role;

DROP POLICY IF EXISTS admin_read_hl_training_accumulation_runs
  ON public.hl_training_accumulation_runs;
CREATE POLICY admin_read_hl_training_accumulation_runs
  ON public.hl_training_accumulation_runs
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

CREATE OR REPLACE FUNCTION
  public.get_highlightly_training_accumulation_preview_v1(
    p_days integer DEFAULT 365,
    p_label_limit integer DEFAULT 200,
    p_feature_limit integer DEFAULT 200,
    p_max_candidates_per_kickoff integer DEFAULT 200,
    p_dataset_limit integer DEFAULT 5000
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  provider_enabled boolean;
  window_to timestamptz := statement_timestamp();
  window_from timestamptz;
  label_preview jsonb;
  feature_preview jsonb;
  dataset_preview jsonb;
  readiness_report jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'accumulation days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;
  IF p_label_limit IS NULL
     OR p_label_limit < 1
     OR p_label_limit > 200 THEN
    RAISE EXCEPTION 'label limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;
  IF p_feature_limit IS NULL
     OR p_feature_limit < 1
     OR p_feature_limit > 200 THEN
    RAISE EXCEPTION 'feature limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;
  IF p_max_candidates_per_kickoff IS NULL
     OR p_max_candidates_per_kickoff < 1
     OR p_max_candidates_per_kickoff > 500 THEN
    RAISE EXCEPTION
      'maximum candidates per kickoff must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;
  IF p_dataset_limit IS NULL
     OR p_dataset_limit < 1
     OR p_dataset_limit > 5000 THEN
    RAISE EXCEPTION 'dataset limit must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';

  window_from := window_to - make_interval(days => p_days);
  label_preview :=
    public.get_highlightly_label_settlement_preview_v2(
      'football',
      p_days,
      p_label_limit
    );
  feature_preview :=
    public.get_highlightly_labeled_feature_backfill_preview_v2(
      p_feature_limit,
      p_max_candidates_per_kickoff
    );
  dataset_preview :=
    public.get_highlightly_training_dataset_preview_v1(
      window_from,
      window_to,
      p_dataset_limit
    );
  readiness_report :=
    public.get_highlightly_training_readiness_report_v1(
      'football',
      p_days
    );

  RETURN jsonb_build_object(
    'phase', '8G.4.1',
    'quality_contract_version', 'phase8g.4.1',
    'mode', 'dry-run',
    'sport', 'football',
    'window_days', p_days,
    'limits', jsonb_build_object(
      'labels', p_label_limit,
      'features', p_feature_limit,
      'max_candidates_per_kickoff',
        p_max_candidates_per_kickoff,
      'dataset_rows', p_dataset_limit
    ),
    'components', jsonb_build_object(
      'labels', label_preview,
      'features', feature_preview,
      'dataset', dataset_preview,
      'readiness', readiness_report
    ),
    'safeguards', jsonb_build_object(
      'read_only', true,
      'stored_data_only', true,
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'database_writes', 0,
      'global_lock_required', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN provider_enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      ELSE 'ready_for_daily_accumulation_canary'
    END
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.get_highlightly_training_accumulation_preview_v1(
      integer,
      integer,
      integer,
      integer,
      integer
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.get_highlightly_training_accumulation_preview_v1(
      integer,
      integer,
      integer,
      integer,
      integer
    )
  TO service_role;
