-- Highlightly Phase 8E.1: safe policy control and bounded operational reporting.
-- This migration does not enable the provider, any lifecycle policy, worker or timer.

CREATE INDEX IF NOT EXISTS idx_hl_ingestion_jobs_phase8e_created
  ON public.hl_ingestion_jobs (created_at DESC, status, sport)
  WHERE shadow_scope LIKE 'phase8e-lifecycle-%';

CREATE INDEX IF NOT EXISTS idx_hl_match_lifecycle_resources_phase8e_updated
  ON public.hl_match_lifecycle_resources (updated_at DESC, resource, status)
  WHERE metadata ->> 'phase' = '8E';

CREATE OR REPLACE FUNCTION public.set_highlightly_match_lifecycle_policy(
  p_sport_code text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  normalized_sport text := lower(btrim(p_sport_code));
  provider_row public.sports_providers%ROWTYPE;
  policy_result jsonb;
BEGIN
  IF p_sport_code IS NULL
     OR normalized_sport NOT IN ('football', 'baseball', 'basketball') THEN
    RAISE EXCEPTION 'sport must be football, baseball or basketball'
      USING ERRCODE = '22023';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled must not be null'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.*
  INTO provider_row
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Highlightly provider not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_enabled AND provider_row.enabled THEN
    RAISE EXCEPTION 'Highlightly provider must be disabled before enabling a lifecycle policy'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.hl_match_lifecycle_policies AS lifecycle_policy
  SET enabled = p_enabled,
      metadata = lifecycle_policy.metadata || jsonb_build_object(
        'lastControlledAt', statement_timestamp(),
        'lastControlledBy', current_user,
        'controlVersion', '8E.1'
      ),
      updated_at = now()
  FROM public.sports AS sport
  WHERE sport.id = lifecycle_policy.sport_id
    AND sport.code = normalized_sport
  RETURNING jsonb_build_object(
    'sport', sport.code,
    'enabled', lifecycle_policy.enabled,
    'provider_enabled', provider_row.enabled,
    'updated_at', lifecycle_policy.updated_at
  )
  INTO policy_result;

  IF policy_result IS NULL THEN
    RAISE EXCEPTION 'Highlightly lifecycle policy not found for sport %', normalized_sport
      USING ERRCODE = 'P0002';
  END IF;

  RETURN policy_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_highlightly_match_lifecycle_policy(text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_highlightly_match_lifecycle_policy(text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.set_highlightly_match_lifecycle_policy(text, boolean) IS
  'Phase 8E.1 service-role control for one lifecycle policy. Enabling requires the provider to be disabled.';

CREATE OR REPLACE FUNCTION public.get_highlightly_match_lifecycle_operational_report(
  p_from timestamptz DEFAULT now() - interval '24 hours',
  p_to timestamptz DEFAULT now()
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
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from
     OR p_to > p_from + interval '7 days' THEN
    RAISE EXCEPTION 'operational report interval must be greater than zero and at most seven days'
      USING ERRCODE = '22023';
  END IF;

  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Highlightly lifecycle operational report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH provider_row AS (
    SELECT
      provider.id,
      provider.enabled,
      provider.contract_version
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly'
    LIMIT 1
  ),
  policy_rows AS (
    SELECT
      sport.code AS sport,
      lifecycle_policy.enabled,
      lifecycle_policy.updated_at
    FROM public.hl_match_lifecycle_policies AS lifecycle_policy
    JOIN public.sports AS sport
      ON sport.id = lifecycle_policy.sport_id
    ORDER BY sport.code
  ),
  phase_jobs AS (
    SELECT ingestion_job.*
    FROM public.hl_ingestion_jobs AS ingestion_job
    WHERE ingestion_job.shadow_scope LIKE 'phase8e-lifecycle-%'
  ),
  window_jobs AS (
    SELECT *
    FROM phase_jobs
    WHERE created_at >= p_from
      AND created_at < p_to
  ),
  window_runs AS (
    SELECT ingestion_run.*, phase_job.shadow_scope, phase_job.sport
    FROM public.hl_ingestion_runs AS ingestion_run
    JOIN phase_jobs AS phase_job
      ON phase_job.id = ingestion_run.job_id
    WHERE ingestion_run.started_at >= p_from
      AND ingestion_run.started_at < p_to
  ),
  active_jobs AS (
    SELECT count(*)::integer AS total
    FROM phase_jobs
    WHERE status IN ('pending', 'running', 'retry')
  ),
  job_totals AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE status = 'pending')::integer AS pending,
      count(*) FILTER (WHERE status = 'running')::integer AS running,
      count(*) FILTER (WHERE status = 'retry')::integer AS retry,
      count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded,
      count(*) FILTER (WHERE status = 'dead')::integer AS dead,
      count(*) FILTER (WHERE status = 'cancelled')::integer AS cancelled
    FROM window_jobs
  ),
  run_totals AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE status = 'running')::integer AS running,
      count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded,
      count(*) FILTER (WHERE status = 'failed')::integer AS failed,
      count(*) FILTER (WHERE status = 'partial')::integer AS partial,
      count(*) FILTER (WHERE status = 'cancelled')::integer AS cancelled,
      COALESCE(sum(records_received), 0)::bigint AS records_received,
      COALESCE(sum(records_normalized), 0)::bigint AS records_normalized,
      COALESCE(sum(records_rejected), 0)::bigint AS records_rejected,
      count(*) FILTER (
        WHERE status = 'succeeded' AND records_received = 0
      )::integer AS empty_succeeded
    FROM window_runs
  ),
  resource_totals AS (
    SELECT
      resource_state.resource,
      resource_state.status,
      count(*)::integer AS matches
    FROM public.hl_match_lifecycle_resources AS resource_state
    WHERE resource_state.metadata ->> 'phase' = '8E'
      AND resource_state.updated_at >= p_from
      AND resource_state.updated_at < p_to
    GROUP BY resource_state.resource, resource_state.status
  ),
  scope_totals AS (
    SELECT
      window_job.shadow_scope AS scope,
      min(window_job.created_at) AS first_job_at,
      max(window_job.updated_at) AS last_job_at,
      count(*)::integer AS jobs,
      count(*) FILTER (WHERE window_job.status = 'succeeded')::integer AS succeeded,
      count(*) FILTER (WHERE window_job.status = 'dead')::integer AS dead,
      count(*) FILTER (
        WHERE window_job.status IN ('pending', 'running', 'retry')
      )::integer AS active
    FROM window_jobs AS window_job
    GROUP BY window_job.shadow_scope
  ),
  request_usage AS (
    SELECT
      rate_usage.request_date,
      COALESCE(sum(rate_usage.requests_used), 0)::bigint AS phase8e_requests
    FROM public.hl_rate_limit_usage AS rate_usage
    JOIN window_runs AS window_run
      ON window_run.id = rate_usage.run_id
    GROUP BY rate_usage.request_date
  ),
  quality_totals AS (
    SELECT
      quality_issue.severity,
      quality_issue.resolution_status,
      count(*)::integer AS issues
    FROM public.hl_data_quality_issues AS quality_issue
    JOIN window_runs AS window_run
      ON window_run.id = quality_issue.run_id
    GROUP BY quality_issue.severity, quality_issue.resolution_status
  )
  SELECT jsonb_build_object(
    'generated_at', statement_timestamp(),
    'from', p_from,
    'to', p_to,
    'phase', '8E.1',
    'limits', jsonb_build_object(
      'max_jobs', 200,
      'request_budget', 300,
      'daily_reserve', 750
    ),
    'provider', jsonb_build_object(
      'enabled', COALESCE((SELECT enabled FROM provider_row), false),
      'contract_version', (SELECT contract_version FROM provider_row)
    ),
    'safe_at_rest', NOT COALESCE((SELECT enabled FROM provider_row), true),
    'active_jobs', COALESCE((SELECT total FROM active_jobs), 0),
    'policies', COALESCE((
      SELECT jsonb_agg(to_jsonb(policy_rows) ORDER BY policy_rows.sport)
      FROM policy_rows
    ), '[]'::jsonb),
    'jobs', COALESCE((SELECT to_jsonb(job_totals) FROM job_totals), '{}'::jsonb),
    'runs', COALESCE((SELECT to_jsonb(run_totals) FROM run_totals), '{}'::jsonb),
    'resources', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(resource_totals)
        ORDER BY resource_totals.resource, resource_totals.status
      )
      FROM resource_totals
    ), '[]'::jsonb),
    'scopes', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(scope_totals)
        ORDER BY scope_totals.first_job_at DESC, scope_totals.scope
      )
      FROM scope_totals
    ), '[]'::jsonb),
    'request_usage', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(request_usage)
        ORDER BY request_usage.request_date
      )
      FROM request_usage
    ), '[]'::jsonb),
    'quality_issues', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(quality_totals)
        ORDER BY quality_totals.severity, quality_totals.resolution_status
      )
      FROM quality_totals
    ), '[]'::jsonb)
  )
  INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_match_lifecycle_operational_report(
  timestamptz,
  timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_match_lifecycle_operational_report(
  timestamptz,
  timestamptz
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_match_lifecycle_operational_report(
  timestamptz,
  timestamptz
) IS 'Phase 8E.1 bounded (<=7 days) operational report for the lifecycle scope. Admin-gated.';