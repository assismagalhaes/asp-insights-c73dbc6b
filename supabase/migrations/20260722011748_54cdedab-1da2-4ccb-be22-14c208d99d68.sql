CREATE OR REPLACE FUNCTION public.get_highlightly_collection_monitor(
  p_scope text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_provider_id uuid;
  v_provider_enabled boolean := false;
  v_scope text;
  v_window_id uuid;
  v_reserve_requests integer := 750;
  v_requests_used integer := 0;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role')
    AND (
      (SELECT auth.uid()) IS NULL
      OR NOT (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    ) THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  SELECT provider.id, provider.enabled
  INTO v_provider_id, v_provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';

  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'Highlightly provider seed is missing';
  END IF;

  SELECT window_row.scope, window_row.id, window_row.reserve_requests
  INTO v_scope, v_window_id, v_reserve_requests
  FROM public.hl_shadow_windows AS window_row
  WHERE window_row.provider_id = v_provider_id
    AND (
      NULLIF(btrim(p_scope), '') IS NULL
      OR window_row.scope = btrim(p_scope)
    )
  ORDER BY
    CASE WHEN window_row.scope = btrim(p_scope) THEN 0 ELSE 1 END,
    window_row.updated_at DESC,
    window_row.started_at DESC
  LIMIT 1;

  IF NULLIF(btrim(p_scope), '') IS NOT NULL AND v_scope IS NULL THEN
    RAISE EXCEPTION 'Unknown Highlightly collection scope: %', btrim(p_scope)
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(usage_row.requests_used), 0)::integer
  INTO v_requests_used
  FROM public.hl_rate_limit_usage AS usage_row
  WHERE usage_row.provider_id = v_provider_id
    AND usage_row.request_date = (now() AT TIME ZONE 'UTC')::date;

  RETURN jsonb_build_object(
    'generated_at', statement_timestamp(),
    'scope', v_scope,
    'provider_enabled', v_provider_enabled,
    'daily_usage', jsonb_build_object(
      'request_date', (now() AT TIME ZONE 'UTC')::date,
      'daily_limit', 7500,
      'reserve_requests', COALESCE(v_reserve_requests, 750),
      'usable_ceiling', 7500 - COALESCE(v_reserve_requests, 750),
      'requests_used', v_requests_used,
      'remaining_before_reserve', GREATEST(
        0,
        7500 - COALESCE(v_reserve_requests, 750) - v_requests_used
      )
    ),
    'scopes', COALESCE((
      SELECT jsonb_agg(to_jsonb(scope_row) ORDER BY scope_row.updated_at DESC)
      FROM (
        SELECT
          window_row.scope,
          window_row.status,
          window_row.sports,
          window_row.started_at,
          window_row.ended_at,
          window_row.updated_at
        FROM public.hl_shadow_windows AS window_row
        WHERE window_row.provider_id = v_provider_id
        ORDER BY window_row.updated_at DESC, window_row.started_at DESC
        LIMIT 20
      ) AS scope_row
    ), '[]'::jsonb),
    'window', COALESCE((
      SELECT jsonb_build_object(
        'id', window_row.id,
        'status', window_row.status,
        'sports', window_row.sports,
        'started_at', window_row.started_at,
        'planned_end_at', window_row.planned_end_at,
        'ended_at', window_row.ended_at,
        'daily_request_budget', window_row.daily_request_budget,
        'reserve_requests', window_row.reserve_requests,
        'current_slice', window_row.config -> 'current_slice',
        'updated_at', window_row.updated_at
      )
      FROM public.hl_shadow_windows AS window_row
      WHERE window_row.id = v_window_id
    ), '{}'::jsonb),
    'queue', COALESCE((
      SELECT jsonb_build_object(
        'total', count(*),
        'pending', count(*) FILTER (WHERE job.status = 'pending'),
        'running', count(*) FILTER (WHERE job.status = 'running'),
        'retry', count(*) FILTER (WHERE job.status = 'retry'),
        'succeeded', count(*) FILTER (WHERE job.status = 'succeeded'),
        'dead', count(*) FILTER (WHERE job.status = 'dead'),
        'cancelled', count(*) FILTER (WHERE job.status = 'cancelled'),
        'active', count(*) FILTER (WHERE job.status IN ('pending', 'running', 'retry')),
        'latest_activity_at', max(job.updated_at)
      )
      FROM public.hl_ingestion_jobs AS job
      WHERE job.shadow_scope = v_scope
    ), '{}'::jsonb),
    'running_jobs', COALESCE((
      SELECT jsonb_agg(to_jsonb(running_row) ORDER BY running_row.locked_at DESC)
      FROM (
        SELECT
          job.id,
          job.sport,
          job.endpoint_key,
          job.worker_id,
          job.locked_at,
          job.lock_expires_at,
          CASE
            WHEN job.lock_expires_at < now() THEN 'expired'
            ELSE 'active'
          END AS lock_state
        FROM public.hl_ingestion_jobs AS job
        WHERE job.shadow_scope = v_scope
          AND job.status = 'running'
        ORDER BY job.locked_at DESC
        LIMIT 10
      ) AS running_row
    ), '[]'::jsonb),
    'by_sport', COALESCE((
      SELECT jsonb_agg(to_jsonb(sport_row) ORDER BY sport_row.sport)
      FROM (
        SELECT
          job.sport,
          count(*) AS total,
          count(*) FILTER (WHERE job.status = 'pending') AS pending,
          count(*) FILTER (WHERE job.status = 'running') AS running,
          count(*) FILTER (WHERE job.status = 'retry') AS retry,
          count(*) FILTER (WHERE job.status = 'succeeded') AS succeeded,
          count(*) FILTER (WHERE job.status = 'dead') AS dead,
          max(job.updated_at) AS latest_activity_at
        FROM public.hl_ingestion_jobs AS job
        WHERE job.shadow_scope = v_scope
        GROUP BY job.sport
      ) AS sport_row
    ), '[]'::jsonb),
    'by_endpoint', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(endpoint_row)
        ORDER BY endpoint_row.active DESC, endpoint_row.total DESC, endpoint_row.endpoint_key
      )
      FROM (
        SELECT
          job.sport,
          job.endpoint_key,
          count(*) AS total,
          count(*) FILTER (WHERE job.status IN ('pending', 'running', 'retry')) AS active,
          count(*) FILTER (WHERE job.status = 'succeeded') AS succeeded,
          count(*) FILTER (WHERE job.status = 'retry') AS retry,
          count(*) FILTER (WHERE job.status = 'dead') AS dead,
          max(job.updated_at) AS latest_activity_at
        FROM public.hl_ingestion_jobs AS job
        WHERE job.shadow_scope = v_scope
        GROUP BY job.sport, job.endpoint_key
        ORDER BY
          count(*) FILTER (WHERE job.status IN ('pending', 'running', 'retry')) DESC,
          count(*) DESC,
          job.endpoint_key
        LIMIT 30
      ) AS endpoint_row
    ), '[]'::jsonb),
    'by_date', COALESCE((
      SELECT jsonb_agg(to_jsonb(date_row) ORDER BY date_row.data_date)
      FROM (
        SELECT
          (job.request_params ->> 'date')::date AS data_date,
          count(*) AS discovery_jobs,
          count(*) FILTER (WHERE job.status = 'succeeded') AS succeeded,
          count(*) FILTER (WHERE job.status IN ('pending', 'running', 'retry')) AS active,
          max(job.updated_at) AS latest_activity_at
        FROM public.hl_ingestion_jobs AS job
        WHERE job.shadow_scope = v_scope
          AND job.request_params ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$'
        GROUP BY (job.request_params ->> 'date')::date
      ) AS date_row
    ), '[]'::jsonb),
    'recent_errors', COALESCE((
      SELECT jsonb_agg(to_jsonb(error_row) ORDER BY error_row.updated_at DESC)
      FROM (
        SELECT
          job.id,
          job.sport,
          job.endpoint_key,
          job.status,
          job.attempts,
          job.max_attempts,
          left(job.last_error, 240) AS error,
          job.updated_at
        FROM public.hl_ingestion_jobs AS job
        WHERE job.shadow_scope = v_scope
          AND job.last_error IS NOT NULL
          AND job.status IN ('retry', 'dead')
        ORDER BY job.updated_at DESC
        LIMIT 12
      ) AS error_row
    ), '[]'::jsonb),
    'quality', COALESCE((
      SELECT jsonb_agg(to_jsonb(quality_row) ORDER BY quality_row.severity, quality_row.sport)
      FROM (
        SELECT issue.severity, issue.sport, count(*) AS open_issues
        FROM public.hl_data_quality_issues AS issue
        JOIN public.hl_ingestion_runs AS run_row ON run_row.id = issue.run_id
        JOIN public.hl_ingestion_jobs AS job ON job.id = run_row.job_id
        WHERE job.shadow_scope = v_scope
          AND issue.resolution_status = 'open'
        GROUP BY issue.severity, issue.sport
      ) AS quality_row
    ), '[]'::jsonb),
    'health', COALESCE((
      SELECT to_jsonb(health_row)
      FROM public.hl_phase7_window_health_v AS health_row
      WHERE health_row.window_id = v_window_id
    ), '{}'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_collection_monitor(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_collection_monitor(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_collection_monitor(text) IS
  'Admin-gated, read-only Highlightly queue, quota, quality and Phase 7 health monitor.';

NOTIFY pgrst, 'reload schema';