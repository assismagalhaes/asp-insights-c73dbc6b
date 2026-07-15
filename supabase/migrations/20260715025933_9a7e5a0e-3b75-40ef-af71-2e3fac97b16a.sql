CREATE TABLE IF NOT EXISTS public.hl_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_key text NOT NULL,
  sport text NOT NULL,
  resource text NOT NULL,
  request_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  priority smallint NOT NULL DEFAULT 2,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  worker_id text,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_ingestion_jobs_sport_check CHECK (sport IN ('football', 'baseball', 'basketball')),
  CONSTRAINT hl_ingestion_jobs_status_check CHECK (
    status IN ('pending', 'running', 'retry', 'succeeded', 'dead', 'cancelled')
  ),
  CONSTRAINT hl_ingestion_jobs_priority_check CHECK (priority BETWEEN 0 AND 4),
  CONSTRAINT hl_ingestion_jobs_attempts_check CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20),
  CONSTRAINT hl_ingestion_jobs_lock_consistency CHECK (
    (status = 'running' AND worker_id IS NOT NULL AND locked_at IS NOT NULL AND lock_expires_at IS NOT NULL)
    OR status <> 'running'
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_ingestion_jobs_claim
  ON public.hl_ingestion_jobs (priority, scheduled_at, created_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_hl_ingestion_jobs_expired_lock
  ON public.hl_ingestion_jobs (lock_expires_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_hl_ingestion_jobs_endpoint_status
  ON public.hl_ingestion_jobs (endpoint_key, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.hl_ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.hl_ingestion_jobs(id) ON DELETE CASCADE,
  worker_id text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  http_status integer,
  records_received integer NOT NULL DEFAULT 0,
  records_normalized integer NOT NULL DEFAULT 0,
  records_rejected integer NOT NULL DEFAULT 0,
  duration_ms integer,
  rate_limit integer,
  rate_remaining integer,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_ingestion_runs_status_check CHECK (
    status IN ('running', 'succeeded', 'failed', 'partial', 'cancelled')
  ),
  CONSTRAINT hl_ingestion_runs_count_check CHECK (
    records_received >= 0 AND records_normalized >= 0 AND records_rejected >= 0
  ),
  CONSTRAINT hl_ingestion_runs_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT hl_ingestion_runs_http_status_check CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599)
);

CREATE INDEX IF NOT EXISTS idx_hl_ingestion_runs_job
  ON public.hl_ingestion_runs (job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hl_ingestion_runs_status_started
  ON public.hl_ingestion_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.hl_raw_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.hl_ingestion_jobs(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.hl_ingestion_runs(id) ON DELETE SET NULL,
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE RESTRICT,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  endpoint_key text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'highlightly-raw',
  storage_path text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/json',
  content_encoding text NOT NULL DEFAULT 'gzip',
  sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_fingerprint text,
  retention_until timestamptz,
  normalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_raw_objects_storage_unique UNIQUE (storage_bucket, storage_path),
  CONSTRAINT hl_raw_objects_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hl_raw_objects_byte_size_check CHECK (byte_size >= 0),
  CONSTRAINT hl_raw_objects_encoding_check CHECK (content_encoding IN ('identity', 'gzip'))
);

CREATE INDEX IF NOT EXISTS idx_hl_raw_objects_job
  ON public.hl_raw_objects (job_id, created_at DESC)
  WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hl_raw_objects_run
  ON public.hl_raw_objects (run_id)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hl_raw_objects_provider_created
  ON public.hl_raw_objects (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hl_raw_objects_sport_created
  ON public.hl_raw_objects (sport_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hl_raw_objects_endpoint_created
  ON public.hl_raw_objects (endpoint_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hl_raw_objects_retention
  ON public.hl_raw_objects (retention_until)
  WHERE retention_until IS NOT NULL;

ALTER TABLE public.hl_ingestion_jobs
  ADD COLUMN IF NOT EXISTS reprocess_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hl_ingestion_jobs_reprocess_raw
  ON public.hl_ingestion_jobs (reprocess_raw_object_id)
  WHERE reprocess_raw_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hl_rate_limit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.hl_ingestion_runs(id) ON DELETE SET NULL,
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE CASCADE,
  endpoint_key text NOT NULL,
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  requests_used integer NOT NULL DEFAULT 1,
  rate_limit integer,
  rate_remaining integer,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_rate_limit_usage_requests_check CHECK (requests_used > 0),
  CONSTRAINT hl_rate_limit_usage_limits_check CHECK (
    (rate_limit IS NULL OR rate_limit >= 0) AND (rate_remaining IS NULL OR rate_remaining >= 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_rate_limit_usage_daily
  ON public.hl_rate_limit_usage (provider_id, request_date, endpoint_key);
CREATE INDEX IF NOT EXISTS idx_hl_rate_limit_usage_run
  ON public.hl_rate_limit_usage (run_id)
  WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hl_data_quality_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.hl_ingestion_runs(id) ON DELETE SET NULL,
  raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  endpoint_key text NOT NULL,
  sport text NOT NULL,
  severity text NOT NULL,
  issue_code text NOT NULL,
  entity_type text,
  external_id text,
  field_path text,
  expected_value jsonb,
  actual_value jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_status text NOT NULL DEFAULT 'open',
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_data_quality_issues_sport_check CHECK (sport IN ('football', 'baseball', 'basketball')),
  CONSTRAINT hl_data_quality_issues_severity_check CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  CONSTRAINT hl_data_quality_issues_resolution_check CHECK (
    resolution_status IN ('open', 'accepted', 'resolved', 'ignored')
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_data_quality_issues_open
  ON public.hl_data_quality_issues (severity, created_at DESC)
  WHERE resolution_status = 'open';
CREATE INDEX IF NOT EXISTS idx_hl_data_quality_issues_run
  ON public.hl_data_quality_issues (run_id)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hl_data_quality_issues_raw
  ON public.hl_data_quality_issues (raw_object_id)
  WHERE raw_object_id IS NOT NULL;

DO $phase1$
DECLARE
  table_name text;
  tables text[] := ARRAY[
    'hl_ingestion_jobs', 'hl_ingestion_runs', 'hl_raw_objects',
    'hl_rate_limit_usage', 'hl_data_quality_issues'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables LOOP
    IF table_name IN ('hl_ingestion_jobs', 'hl_data_quality_issues') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || table_name || '_touch_updated_at', table_name);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
        'trg_' || table_name || '_touch_updated_at', table_name
      );
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = 'admin_read_' || table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::public.app_role)))',
        'admin_read_' || table_name,
        table_name
      );
    END IF;
  END LOOP;
END
$phase1$;

DO $storage_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'highlightly_raw_admin_read'
  ) THEN
    CREATE POLICY highlightly_raw_admin_read
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'highlightly-raw'
        AND (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      );
  END IF;
END
$storage_policy$;

NOTIFY pgrst, 'reload schema';