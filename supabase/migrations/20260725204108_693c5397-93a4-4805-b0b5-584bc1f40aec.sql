-- Phase 8E.3: bounded lifecycle quota, recoverable matchId repair and unified monitor.
CREATE OR REPLACE FUNCTION public.get_highlightly_phase8e_daily_request_usage(
  p_request_date date DEFAULT (now() AT TIME ZONE 'UTC')::date
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH phase_runs AS (
    SELECT ingestion_run.id, ingestion_run.http_status
    FROM public.hl_ingestion_runs AS ingestion_run
    JOIN public.hl_ingestion_jobs AS ingestion_job
      ON ingestion_job.id = ingestion_run.job_id
    WHERE ingestion_job.shadow_scope LIKE 'phase8e-lifecycle-%'
      AND (ingestion_run.started_at AT TIME ZONE 'UTC')::date = p_request_date
  ),
  measured AS (
    SELECT
      phase_run.id,
      COALESCE(sum(rate_usage.requests_used), 0)::bigint AS requests_used
    FROM phase_runs AS phase_run
    LEFT JOIN public.hl_rate_limit_usage AS rate_usage
      ON rate_usage.run_id = phase_run.id
     AND rate_usage.request_date = p_request_date
    GROUP BY phase_run.id
  )
  SELECT
    COALESCE(sum(measured.requests_used), 0)::bigint
    + count(*) FILTER (
      WHERE phase_run.http_status IS NOT NULL
        AND measured.requests_used = 0
    )::bigint
  FROM phase_runs AS phase_run
  JOIN measured
    ON measured.id = phase_run.id;
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_phase8e_daily_request_usage(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_phase8e_daily_request_usage(date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_highlightly_dead_phase8e_missing_match_id_jobs(
  p_limit integer DEFAULT 100
)
RETURNS SETOF public.hl_ingestion_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_limit < 1 OR p_limit > 300 THEN
    RAISE EXCEPTION 'limit must be between 1 and 300' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sports_providers AS provider WHERE provider.code = 'highlightly' AND provider.enabled) THEN
    RAISE EXCEPTION 'Highlightly provider must be disabled before requeue';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hl_match_lifecycle_policies AS lifecycle_policy WHERE lifecycle_policy.enabled) THEN
    RAISE EXCEPTION 'all lifecycle policies must be disabled before requeue';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hl_ingestion_jobs AS active_job WHERE active_job.status = 'running') THEN
    RAISE EXCEPTION 'running ingestion jobs must finish before requeue';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.hl_ingestion_jobs AS job
    WHERE job.shadow_scope LIKE 'phase8e-lifecycle-%'
      AND job.sport = 'football'
      AND job.endpoint_key = 'football.FootballPlayerBoxScoreController_getPlayerBoxScores'
      AND job.status = 'dead'
      AND job.last_error LIKE 'Missing path parameters for football.FootballPlayerBoxScoreController_getPlayerBoxScores:%'
      AND COALESCE(job.request_params ->> 'matchId', job.request_params ->> 'id') IS NOT NULL
    ORDER BY job.updated_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  repaired AS (
    UPDATE public.hl_ingestion_jobs AS job
    SET
      status = 'retry',
      priority = 1,
      scheduled_at = now(),
      attempts = 0,
      max_attempts = LEAST(job.max_attempts, 2),
      worker_id = NULL,
      locked_at = NULL,
      lock_expires_at = NULL,
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      request_params = (COALESCE(job.request_params, '{}'::jsonb) - 'id')
        || jsonb_build_object('matchId', COALESCE(job.request_params ->> 'matchId', job.request_params ->> 'id')),
      cursor_data = COALESCE(job.cursor_data, '{}'::jsonb)
        || jsonb_build_object('_phase8e3_match_id_repaired_at', now(), '_phase8e3_prior_attempts', job.attempts),
      updated_at = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  ),
  resources AS (
    UPDATE public.hl_match_lifecycle_resources AS resource_state
    SET
      status = 'retry',
      completed_at = NULL,
      last_error = 'phase8e3_match_id_repaired_pending_replay',
      metadata = resource_state.metadata || jsonb_build_object('repairedBy', 'phase8e3_match_id', 'repairedAt', now()),
      updated_at = now()
    FROM repaired
    WHERE resource_state.last_job_id = repaired.id
    RETURNING resource_state.match_id
  )
  SELECT repaired.* FROM repaired;
END;
$function$;

REVOKE ALL ON FUNCTION public.requeue_highlightly_dead_phase8e_missing_match_id_jobs(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_highlightly_dead_phase8e_missing_match_id_jobs(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_match_lifecycle_operational_report_v2(
  p_from timestamptz DEFAULT now() - interval '24 hours',
  p_to timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT jsonb_set(
    jsonb_set(
      public.get_highlightly_match_lifecycle_operational_report(p_from, p_to),
      '{phase}', '"8E.3"'::jsonb, true
    ),
    '{limits}',
    jsonb_build_object('max_jobs', 100, 'request_budget', 200, 'daily_request_budget', 1500, 'daily_reserve', 750),
    true
  );
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_match_lifecycle_operational_report_v2(timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_match_lifecycle_operational_report_v2(timestamptz, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_collection_monitor_v2(
  p_scope text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  selected_scope text;
  selected_kind text;
  base_report jsonb;
  scope_rows jsonb;
  collector_usage jsonb;
  lifecycle_queue jsonb;
  lifecycle_window jsonb;
  lifecycle_by_sport jsonb;
  lifecycle_by_endpoint jsonb;
  lifecycle_errors jsonb;
  lifecycle_status text;
BEGIN
  WITH scope_catalog AS (
    SELECT window_row.scope, 'window'::text AS kind, window_row.status, window_row.sports,
      window_row.started_at, window_row.ended_at, window_row.updated_at
    FROM public.hl_shadow_windows AS window_row
    UNION ALL
    SELECT ingestion_job.shadow_scope, 'lifecycle'::text,
      CASE
        WHEN count(*) FILTER (WHERE ingestion_job.status IN ('pending', 'running', 'retry')) > 0 THEN 'running'
        WHEN count(*) FILTER (WHERE ingestion_job.status = 'dead') > 0 THEN 'completed_with_exceptions'
        ELSE 'passed'
      END,
      array_agg(DISTINCT ingestion_job.sport ORDER BY ingestion_job.sport),
      min(ingestion_job.created_at),
      CASE WHEN count(*) FILTER (WHERE ingestion_job.status IN ('pending', 'running', 'retry')) = 0
        THEN max(ingestion_job.updated_at) END,
      max(ingestion_job.updated_at)
    FROM public.hl_ingestion_jobs AS ingestion_job
    WHERE ingestion_job.shadow_scope LIKE 'phase8e-lifecycle-%'
    GROUP BY ingestion_job.shadow_scope
  )
  SELECT catalog.scope, catalog.kind INTO selected_scope, selected_kind
  FROM scope_catalog AS catalog
  WHERE NULLIF(btrim(p_scope), '') IS NULL OR catalog.scope = btrim(p_scope)
  ORDER BY CASE WHEN catalog.scope = btrim(p_scope) THEN 0 ELSE 1 END,
    catalog.updated_at DESC, catalog.started_at DESC
  LIMIT 1;

  IF NULLIF(btrim(p_scope), '') IS NOT NULL AND selected_scope IS NULL THEN
    RAISE EXCEPTION 'Unknown Highlightly collection scope: %', btrim(p_scope) USING ERRCODE = '22023';
  END IF;

  base_report := public.get_highlightly_collection_monitor(
    CASE WHEN selected_kind = 'window' THEN selected_scope ELSE NULL END
  );

  WITH scope_catalog AS (
    SELECT window_row.scope, 'window'::text AS kind, window_row.status, window_row.sports,
      window_row.started_at, window_row.ended_at, window_row.updated_at
    FROM public.hl_shadow_windows AS window_row
    UNION ALL
    SELECT ingestion_job.shadow_scope, 'lifecycle'::text,
      CASE
        WHEN count(*) FILTER (WHERE ingestion_job.status IN ('pending', 'running', 'retry')) > 0 THEN 'running'
        WHEN count(*) FILTER (WHERE ingestion_job.status = 'dead') > 0 THEN 'completed_with_exceptions'
        ELSE 'passed'
      END,
      array_agg(DISTINCT ingestion_job.sport ORDER BY ingestion_job.sport),
      min(ingestion_job.created_at),
      CASE WHEN count(*) FILTER (WHERE ingestion_job.status IN ('pending', 'running', 'retry')) = 0
        THEN max(ingestion_job.updated_at) END,
      max(ingestion_job.updated_at)
    FROM public.hl_ingestion_jobs AS ingestion_job
    WHERE ingestion_job.shadow_scope LIKE 'phase8e-lifecycle-%'
    GROUP BY ingestion_job.shadow_scope
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(catalog) ORDER BY catalog.updated_at DESC), '[]'::jsonb)
  INTO scope_rows
  FROM (SELECT * FROM scope_catalog ORDER BY updated_at DESC, started_at DESC LIMIT 40) AS catalog;

  WITH run_requests AS (
    SELECT ingestion_run.id AS run_id, ingestion_job.shadow_scope, ingestion_run.http_status,
      COALESCE(sum(rate_usage.requests_used), 0)::bigint AS measured_requests
    FROM public.hl_ingestion_runs AS ingestion_run
    JOIN public.hl_ingestion_jobs AS ingestion_job ON ingestion_job.id = ingestion_run.job_id
    LEFT JOIN public.hl_rate_limit_usage AS rate_usage
      ON rate_usage.run_id = ingestion_run.id
     AND rate_usage.request_date = (now() AT TIME ZONE 'UTC')::date
    WHERE (ingestion_run.started_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
    GROUP BY ingestion_run.id, ingestion_job.shadow_scope, ingestion_run.http_status
  ),
  collector_totals AS (
    SELECT
      CASE WHEN shadow_scope LIKE 'phase8e-lifecycle-%' THEN 'lifecycle' ELSE 'window' END AS collector,
      sum(measured_requests)::bigint
        + count(*) FILTER (WHERE http_status IS NOT NULL AND measured_requests = 0)::bigint AS requests_today
    FROM run_requests
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_object_agg(collector, requests_today), '{}'::jsonb)
  INTO collector_usage
  FROM collector_totals;

  IF selected_kind = 'lifecycle' AND selected_scope IS NOT NULL THEN
    SELECT
      jsonb_build_object(
        'total', count(*)::integer,
        'pending', count(*) FILTER (WHERE status = 'pending')::integer,
        'running', count(*) FILTER (WHERE status = 'running')::integer,
        'retry', count(*) FILTER (WHERE status = 'retry')::integer,
        'succeeded', count(*) FILTER (WHERE status = 'succeeded')::integer,
        'dead', count(*) FILTER (WHERE status = 'dead')::integer
      ),
      CASE
        WHEN count(*) FILTER (WHERE status IN ('pending', 'running', 'retry')) > 0 THEN 'running'
        WHEN count(*) FILTER (WHERE status = 'dead') > 0 THEN 'completed_with_exceptions'
        ELSE 'passed'
      END,
      jsonb_build_object(
        'scope', selected_scope,
        'status', CASE
          WHEN count(*) FILTER (WHERE status IN ('pending', 'running', 'retry')) > 0 THEN 'running'
          WHEN count(*) FILTER (WHERE status = 'dead') > 0 THEN 'completed_with_exceptions'
          ELSE 'passed'
        END,
        'sports', array_agg(DISTINCT sport ORDER BY sport),
        'started_at', min(created_at),
        'ended_at', CASE WHEN count(*) FILTER (WHERE status IN ('pending', 'running', 'retry')) = 0
          THEN max(updated_at) END,
        'updated_at', max(updated_at),
        'collector', 'lifecycle'
      )
    INTO lifecycle_queue, lifecycle_status, lifecycle_window
    FROM public.hl_ingestion_jobs
    WHERE shadow_scope = selected_scope;

    SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.sport), '[]'::jsonb)
    INTO lifecycle_by_sport
    FROM (
      SELECT sport, count(*)::integer AS total,
        count(*) FILTER (WHERE status = 'pending')::integer AS pending,
        count(*) FILTER (WHERE status = 'running')::integer AS running,
        count(*) FILTER (WHERE status = 'retry')::integer AS retry,
        count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded,
        count(*) FILTER (WHERE status = 'dead')::integer AS dead,
        max(updated_at) AS latest_activity_at
      FROM public.hl_ingestion_jobs
      WHERE shadow_scope = selected_scope
      GROUP BY sport
    ) AS row_data;

    SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.sport, row_data.endpoint_key), '[]'::jsonb)
    INTO lifecycle_by_endpoint
    FROM (
      SELECT sport, endpoint_key, count(*)::integer AS total,
        count(*) FILTER (WHERE status IN ('pending', 'running'))::integer AS active,
        count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded,
        count(*) FILTER (WHERE status = 'retry')::integer AS retry,
        count(*) FILTER (WHERE status = 'dead')::integer AS dead,
        max(updated_at) AS latest_activity_at
      FROM public.hl_ingestion_jobs
      WHERE shadow_scope = selected_scope
      GROUP BY sport, endpoint_key
    ) AS row_data;

    SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.updated_at DESC), '[]'::jsonb)
    INTO lifecycle_errors
    FROM (
      SELECT id, sport, endpoint_key, status, attempts, max_attempts,
        last_error AS error, updated_at
      FROM public.hl_ingestion_jobs
      WHERE shadow_scope = selected_scope AND status IN ('retry', 'dead')
      ORDER BY updated_at DESC
      LIMIT 20
    ) AS row_data;

    base_report := base_report || jsonb_build_object(
      'queue', lifecycle_queue,
      'window', lifecycle_window,
      'by_sport', lifecycle_by_sport,
      'by_endpoint', lifecycle_by_endpoint,
      'recent_errors', lifecycle_errors,
      'health', jsonb_build_object('gate_status', lifecycle_status)
    );
  END IF;

  RETURN base_report || jsonb_build_object(
    'scope', selected_scope,
    'scope_kind', selected_kind,
    'scopes', scope_rows,
    'collector_usage', collector_usage
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_collection_monitor_v2(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_collection_monitor_v2(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_collection_monitor_v2(text) IS
  'Unified admin monitor for future, historical and Phase 8E lifecycle scopes with per-collector quota usage.';

NOTIFY pgrst, 'reload schema';