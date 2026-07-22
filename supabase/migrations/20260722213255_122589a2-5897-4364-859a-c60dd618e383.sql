ALTER TABLE public.hl_shadow_observations
  ADD COLUMN IF NOT EXISTS matches_odds_eligible integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matches_eligible_with_odds integer NOT NULL DEFAULT 0;

ALTER TABLE public.hl_shadow_observations
  DROP CONSTRAINT IF EXISTS hl_shadow_observations_counts_check;

ALTER TABLE public.hl_shadow_observations
  ADD CONSTRAINT hl_shadow_observations_counts_check CHECK (
    jobs_total >= 0
    AND jobs_succeeded >= 0
    AND jobs_partial >= 0
    AND jobs_retry >= 0
    AND jobs_dead >= 0
    AND jobs_pending >= 0
    AND requests_used >= 0
    AND matches_expected >= 0
    AND matches_seen >= 0
    AND matches_with_odds >= 0
    AND matches_with_odds <= matches_seen
    AND matches_odds_eligible >= 0
    AND matches_eligible_with_odds >= 0
    AND matches_eligible_with_odds <= matches_odds_eligible
    AND open_warning_issues >= 0
    AND open_error_issues >= 0
    AND open_critical_issues >= 0
  );

ALTER TABLE public.hl_shadow_observations
  ADD COLUMN IF NOT EXISTS odds_availability_pct numeric(7, 4)
  GENERATED ALWAYS AS (
    CASE
      WHEN matches_odds_eligible = 0 THEN NULL
      ELSE LEAST(
        100::numeric,
        matches_eligible_with_odds::numeric * 100 / matches_odds_eligible
      )
    END
  ) STORED;

ALTER TABLE public.hl_shadow_windows
  DROP CONSTRAINT IF EXISTS hl_shadow_windows_status_check;

ALTER TABLE public.hl_shadow_windows
  ADD CONSTRAINT hl_shadow_windows_status_check CHECK (
    status IN (
      'planned',
      'running',
      'passed',
      'failed',
      'completed_with_exceptions',
      'cancelled'
    )
  );

UPDATE public.hl_shadow_windows AS window_row
SET
  config = jsonb_set(
    window_row.config,
    '{window_kind}',
    to_jsonb(
      CASE
        WHEN window_row.scope LIKE 'future-%' THEN 'future'
        WHEN window_row.scope LIKE 'phase7-%' THEN 'historical'
        ELSE 'shadow'
      END::text
    ),
    true
  ),
  updated_at = now()
WHERE NOT (window_row.config ? 'window_kind');

CREATE OR REPLACE FUNCTION public.refresh_highlightly_shadow_observation(
  p_window_id uuid,
  p_observed_on date,
  p_sport text,
  p_scope text,
  p_matches_expected integer DEFAULT 0
)
RETURNS public.hl_shadow_observations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  result public.hl_shadow_observations;
BEGIN
  IF p_sport NOT IN ('football', 'baseball', 'basketball') THEN
    RAISE EXCEPTION 'invalid sport: %', p_sport;
  END IF;
  IF p_scope IS NULL OR btrim(p_scope) = '' OR length(p_scope) > 160 THEN
    RAISE EXCEPTION 'scope must contain between 1 and 160 characters';
  END IF;
  IF p_matches_expected < 0 THEN
    RAISE EXCEPTION 'matches_expected must be zero or greater';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.hl_shadow_windows AS window_row
    WHERE window_row.id = p_window_id
      AND window_row.scope = p_scope
  ) THEN
    RAISE EXCEPTION 'shadow window % was not found for scope %', p_window_id, p_scope;
  END IF;

  WITH scoped_jobs AS MATERIALIZED (
    SELECT job.id, job.status, job.endpoint_key, job.request_params
    FROM public.hl_ingestion_jobs AS job
    WHERE job.sport = p_sport
      AND job.shadow_scope = p_scope
  ),
  job_rollup AS (
    SELECT
      count(*)::integer AS jobs_total,
      count(*) FILTER (WHERE status = 'succeeded')::integer AS jobs_succeeded,
      count(*) FILTER (WHERE status = 'retry')::integer AS jobs_retry,
      count(*) FILTER (WHERE status = 'dead')::integer AS jobs_dead,
      count(*) FILTER (WHERE status IN ('pending', 'running'))::integer AS jobs_pending
    FROM scoped_jobs
  ),
  run_rollup AS (
    SELECT
      count(DISTINCT run.job_id) FILTER (WHERE run.status = 'partial')::integer AS jobs_partial,
      (
        percentile_cont(0.50) WITHIN GROUP (ORDER BY run.duration_ms)
          FILTER (WHERE run.duration_ms IS NOT NULL)
      )::integer AS latency_p50_ms,
      (
        percentile_cont(0.95) WITHIN GROUP (ORDER BY run.duration_ms)
          FILTER (WHERE run.duration_ms IS NOT NULL)
      )::integer AS latency_p95_ms
    FROM public.hl_ingestion_runs AS run
    JOIN scoped_jobs AS job ON job.id = run.job_id
  ),
  usage_rollup AS (
    SELECT COALESCE(sum(usage.requests_used), 0)::integer AS requests_used
    FROM public.hl_rate_limit_usage AS usage
    JOIN public.hl_ingestion_runs AS run ON run.id = usage.run_id
    JOIN scoped_jobs AS job ON job.id = run.job_id
    WHERE usage.request_date = p_observed_on
  ),
  issue_rollup AS (
    SELECT
      count(*) FILTER (
        WHERE issue.severity = 'warning' AND issue.resolution_status = 'open'
      )::integer AS open_warning_issues,
      count(*) FILTER (
        WHERE issue.severity = 'error' AND issue.resolution_status = 'open'
      )::integer AS open_error_issues,
      count(*) FILTER (
        WHERE issue.severity = 'critical' AND issue.resolution_status = 'open'
      )::integer AS open_critical_issues
    FROM public.hl_data_quality_issues AS issue
    JOIN public.hl_ingestion_runs AS run ON run.id = issue.run_id
    JOIN scoped_jobs AS job ON job.id = run.job_id
  ),
  match_scope AS MATERIALIZED (
    SELECT
      mapping.canonical_id AS match_id,
      max(mapping.last_seen_at) AS last_seen_at
    FROM public.hl_shadow_windows AS window_row
    JOIN public.sports_provider_entities AS mapping
      ON mapping.provider_id = window_row.provider_id
     AND mapping.entity_type = 'match'
    JOIN public.sports AS sport_row
      ON sport_row.id = mapping.sport_id
     AND sport_row.code = p_sport
    WHERE window_row.id = p_window_id
      AND mapping.last_seen_at >= p_observed_on::timestamptz
      AND mapping.last_seen_at < (p_observed_on + 1)::timestamptz
    GROUP BY mapping.canonical_id
  ),
  match_rollup AS (
    SELECT
      count(*)::integer AS matches_seen,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM public.sports_odds_current AS quote
          WHERE quote.match_id = match_scope.match_id
        )
      )::integer AS matches_with_odds,
      (
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY GREATEST(0, extract(epoch FROM (now() - match_scope.last_seen_at)))
        )
      )::integer AS freshness_p95_seconds
    FROM match_scope
  ),
  eligible_external_matches AS MATERIALIZED (
    SELECT DISTINCT job.request_params ->> 'matchId' AS external_match_id
    FROM scoped_jobs AS job
    WHERE job.endpoint_key = CASE p_sport
      WHEN 'football' THEN 'football.FootballOddsController_getOddsV2'
      WHEN 'baseball' THEN 'baseball.BaseballOddsController_getOddsV2'
      WHEN 'basketball' THEN 'basketball.BasketballOddsController_getOddsV2'
    END
      AND NULLIF(job.request_params ->> 'matchId', '') IS NOT NULL
  ),
  eligible_odds_rollup AS (
    SELECT
      count(*)::integer AS matches_odds_eligible,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM public.hl_shadow_windows AS window_row
          JOIN public.sports AS sport_row ON sport_row.code = p_sport
          JOIN public.sports_provider_entities AS mapping
            ON mapping.provider_id = window_row.provider_id
           AND mapping.sport_id = sport_row.id
           AND mapping.entity_type = 'match'
           AND mapping.external_id = eligible.external_match_id
          JOIN public.sports_odds_current AS quote
            ON quote.match_id = mapping.canonical_id
          WHERE window_row.id = p_window_id
        )
      )::integer AS matches_eligible_with_odds
    FROM eligible_external_matches AS eligible
  )
  INSERT INTO public.hl_shadow_observations (
    window_id,
    observed_on,
    sport,
    jobs_total,
    jobs_succeeded,
    jobs_partial,
    jobs_retry,
    jobs_dead,
    jobs_pending,
    requests_used,
    matches_expected,
    matches_seen,
    matches_with_odds,
    matches_odds_eligible,
    matches_eligible_with_odds,
    freshness_p95_seconds,
    latency_p50_ms,
    latency_p95_ms,
    open_warning_issues,
    open_error_issues,
    open_critical_issues,
    source_metadata
  )
  SELECT
    p_window_id,
    p_observed_on,
    p_sport,
    job_rollup.jobs_total,
    job_rollup.jobs_succeeded,
    run_rollup.jobs_partial,
    job_rollup.jobs_retry,
    job_rollup.jobs_dead,
    job_rollup.jobs_pending,
    usage_rollup.requests_used,
    p_matches_expected,
    match_rollup.matches_seen,
    match_rollup.matches_with_odds,
    eligible_odds_rollup.matches_odds_eligible,
    eligible_odds_rollup.matches_eligible_with_odds,
    match_rollup.freshness_p95_seconds,
    run_rollup.latency_p50_ms,
    run_rollup.latency_p95_ms,
    issue_rollup.open_warning_issues,
    issue_rollup.open_error_issues,
    issue_rollup.open_critical_issues,
    jsonb_build_object(
      'scope', p_scope,
      'refreshed_at', now(),
      'oddsCoverageDenominator', 'eligible_odds_jobs'
    )
  FROM job_rollup
  CROSS JOIN run_rollup
  CROSS JOIN usage_rollup
  CROSS JOIN issue_rollup
  CROSS JOIN match_rollup
  CROSS JOIN eligible_odds_rollup
  ON CONFLICT (window_id, observed_on, sport) DO UPDATE SET
    jobs_total = EXCLUDED.jobs_total,
    jobs_succeeded = EXCLUDED.jobs_succeeded,
    jobs_partial = EXCLUDED.jobs_partial,
    jobs_retry = EXCLUDED.jobs_retry,
    jobs_dead = EXCLUDED.jobs_dead,
    jobs_pending = EXCLUDED.jobs_pending,
    requests_used = EXCLUDED.requests_used,
    matches_expected = EXCLUDED.matches_expected,
    matches_seen = EXCLUDED.matches_seen,
    matches_with_odds = EXCLUDED.matches_with_odds,
    matches_odds_eligible = EXCLUDED.matches_odds_eligible,
    matches_eligible_with_odds = EXCLUDED.matches_eligible_with_odds,
    freshness_p95_seconds = EXCLUDED.freshness_p95_seconds,
    latency_p50_ms = EXCLUDED.latency_p50_ms,
    latency_p95_ms = EXCLUDED.latency_p95_ms,
    open_warning_issues = EXCLUDED.open_warning_issues,
    open_error_issues = EXCLUDED.open_error_issues,
    open_critical_issues = EXCLUDED.open_critical_issues,
    source_metadata = EXCLUDED.source_metadata,
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END
$function$;

CREATE OR REPLACE VIEW public.hl_phase7_window_health_v
WITH (security_invoker = true)
AS
WITH latest_observation AS (
  SELECT DISTINCT ON (observation.window_id, observation.sport)
    observation.*
  FROM public.hl_shadow_observations AS observation
  ORDER BY
    observation.window_id,
    observation.sport,
    observation.observed_on DESC,
    observation.updated_at DESC
),
observation_rollup AS (
  SELECT
    observation.window_id,
    count(DISTINCT observation.observed_on)::integer AS observed_days,
    count(observation.id)::integer AS observation_count,
    count(observation.match_coverage_pct)::integer AS match_coverage_count,
    count(COALESCE(observation.odds_availability_pct, observation.odds_coverage_pct))::integer
      AS odds_coverage_count,
    count(observation.freshness_p95_seconds)::integer AS freshness_count,
    COALESCE(sum(observation.requests_used), 0)::bigint AS requests_used,
    min(observation.match_coverage_pct) AS minimum_match_coverage_pct,
    min(COALESCE(observation.odds_availability_pct, observation.odds_coverage_pct))
      AS minimum_eligible_odds_coverage_pct,
    min(observation.odds_coverage_pct) AS minimum_raw_odds_coverage_pct,
    max(observation.freshness_p95_seconds) AS maximum_freshness_p95_seconds,
    max(observation.latency_p95_ms) AS maximum_latency_p95_ms
  FROM public.hl_shadow_observations AS observation
  GROUP BY observation.window_id
),
current_state AS (
  SELECT
    observation.window_id,
    COALESCE(sum(observation.jobs_dead), 0)::bigint AS unrecovered_jobs,
    COALESCE(sum(observation.open_critical_issues), 0)::bigint AS open_critical_issues
  FROM latest_observation AS observation
  GROUP BY observation.window_id
)
SELECT
  window_row.id AS window_id,
  window_row.scope,
  window_row.status,
  window_row.sports,
  window_row.started_at,
  window_row.planned_end_at,
  window_row.ended_at,
  window_row.daily_request_budget,
  window_row.reserve_requests,
  window_row.match_coverage_sla,
  window_row.odds_coverage_sla,
  window_row.freshness_sla_seconds,
  COALESCE(rollup.observed_days, 0)::integer AS observed_days,
  COALESCE(rollup.requests_used, 0)::bigint AS requests_used,
  COALESCE(state.unrecovered_jobs, 0)::bigint AS unrecovered_jobs,
  COALESCE(state.open_critical_issues, 0)::bigint AS open_critical_issues,
  rollup.minimum_match_coverage_pct,
  rollup.minimum_eligible_odds_coverage_pct AS minimum_odds_coverage_pct,
  rollup.maximum_freshness_p95_seconds,
  rollup.maximum_latency_p95_ms,
  CASE
    WHEN COALESCE(window_row.config ->> 'window_kind', 'shadow') = 'historical'
      AND window_row.status = 'completed_with_exceptions'
      THEN 'historical_complete_with_exceptions'
    WHEN COALESCE(window_row.config ->> 'window_kind', 'shadow') = 'historical'
      AND window_row.status = 'passed'
      THEN 'historical_complete'
    WHEN COALESCE(window_row.config ->> 'window_kind', 'shadow') = 'future'
      AND window_row.status = 'completed_with_exceptions'
      THEN 'future_slice_complete_with_exceptions'
    WHEN COALESCE(window_row.config ->> 'window_kind', 'shadow') = 'future'
      AND window_row.status = 'passed'
      THEN 'future_slice_complete'
    WHEN COALESCE(state.unrecovered_jobs, 0) > 0
      OR COALESCE(state.open_critical_issues, 0) > 0 THEN 'blocked'
    WHEN COALESCE(rollup.observed_days, 0) < 7
      OR COALESCE(rollup.observation_count, 0) < 7 * cardinality(window_row.sports)
      OR COALESCE(rollup.match_coverage_count, 0) < 7 * cardinality(window_row.sports)
      OR COALESCE(rollup.odds_coverage_count, 0) < 7 * cardinality(window_row.sports)
      OR COALESCE(rollup.freshness_count, 0) < 7 * cardinality(window_row.sports)
      THEN 'collecting'
    WHEN rollup.minimum_match_coverage_pct < window_row.match_coverage_sla
      OR rollup.minimum_eligible_odds_coverage_pct < window_row.odds_coverage_sla
      OR rollup.maximum_freshness_p95_seconds > window_row.freshness_sla_seconds
      THEN 'below_sla'
    ELSE 'ready'
  END AS gate_status,
  COALESCE(window_row.config ->> 'window_kind', 'shadow') AS window_kind,
  rollup.minimum_raw_odds_coverage_pct,
  rollup.minimum_eligible_odds_coverage_pct
FROM public.hl_shadow_windows AS window_row
LEFT JOIN observation_rollup AS rollup ON rollup.window_id = window_row.id
LEFT JOIN current_state AS state ON state.window_id = window_row.id;

REVOKE ALL ON TABLE public.hl_phase7_window_health_v FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.hl_phase7_window_health_v TO authenticated, service_role;

CREATE OR REPLACE VIEW public.hl_highlightly_future_gate_v
WITH (security_invoker = true)
AS
WITH future_observations AS MATERIALIZED (
  SELECT observation.*, window_row.provider_id
  FROM public.hl_shadow_observations AS observation
  JOIN public.hl_shadow_windows AS window_row ON window_row.id = observation.window_id
  WHERE COALESCE(window_row.config ->> 'window_kind', 'shadow') = 'future'
    AND observation.observed_on >= (now() AT TIME ZONE 'UTC')::date - 6
),
future_windows AS MATERIALIZED (
  SELECT window_row.id, window_row.provider_id, window_row.scope
  FROM public.hl_shadow_windows AS window_row
  WHERE COALESCE(window_row.config ->> 'window_kind', 'shadow') = 'future'
    AND window_row.started_at >= ((now() AT TIME ZONE 'UTC')::date - 6)::timestamptz
),
job_state AS (
  SELECT
    window_row.provider_id,
    count(*) FILTER (WHERE job.status = 'dead')::bigint AS unrecovered_jobs
  FROM future_windows AS window_row
  JOIN public.hl_ingestion_jobs AS job
    ON job.shadow_scope = window_row.scope
  GROUP BY window_row.provider_id
),
issue_state AS (
  SELECT
    window_row.provider_id,
    count(*) FILTER (
      WHERE issue.severity = 'critical' AND issue.resolution_status = 'open'
    )::bigint AS open_critical_issues
  FROM future_windows AS window_row
  JOIN public.hl_ingestion_jobs AS job ON job.shadow_scope = window_row.scope
  JOIN public.hl_ingestion_runs AS run_row ON run_row.job_id = job.id
  JOIN public.hl_data_quality_issues AS issue ON issue.run_id = run_row.id
  GROUP BY window_row.provider_id
),
rollup AS (
  SELECT
    observation.provider_id,
    count(DISTINCT observation.observed_on)::integer AS observed_days,
    count(DISTINCT (observation.observed_on, observation.sport))::integer AS observed_sport_days,
    sum(observation.matches_expected)::bigint AS matches_expected,
    sum(observation.matches_seen)::bigint AS matches_seen,
    sum(observation.matches_odds_eligible)::bigint AS matches_odds_eligible,
    sum(observation.matches_eligible_with_odds)::bigint AS matches_eligible_with_odds,
    max(observation.freshness_p95_seconds)::integer AS maximum_freshness_p95_seconds
  FROM future_observations AS observation
  GROUP BY observation.provider_id
)
SELECT
  provider.id AS provider_id,
  COALESCE(rollup.observed_days, 0) AS observed_days,
  COALESCE(rollup.observed_sport_days, 0) AS observed_sport_days,
  COALESCE(job_state.unrecovered_jobs, 0) AS unrecovered_jobs,
  COALESCE(issue_state.open_critical_issues, 0) AS open_critical_issues,
  CASE
    WHEN COALESCE(rollup.matches_expected, 0) = 0 THEN NULL
    ELSE LEAST(100::numeric, rollup.matches_seen::numeric * 100 / rollup.matches_expected)
  END::numeric(7, 4) AS match_coverage_pct,
  CASE
    WHEN COALESCE(rollup.matches_odds_eligible, 0) = 0 THEN NULL
    ELSE LEAST(
      100::numeric,
      rollup.matches_eligible_with_odds::numeric * 100 / rollup.matches_odds_eligible
    )
  END::numeric(7, 4) AS odds_availability_pct,
  rollup.maximum_freshness_p95_seconds,
  CASE
    WHEN COALESCE(job_state.unrecovered_jobs, 0) > 0
      OR COALESCE(issue_state.open_critical_issues, 0) > 0 THEN 'blocked'
    WHEN COALESCE(rollup.observed_days, 0) < 7
      OR COALESCE(rollup.observed_sport_days, 0) < 21
      OR COALESCE(rollup.matches_odds_eligible, 0) = 0 THEN 'collecting'
    WHEN rollup.matches_expected > 0
      AND LEAST(100::numeric, rollup.matches_seen::numeric * 100 / rollup.matches_expected) < 95
      THEN 'below_sla'
    WHEN LEAST(
      100::numeric,
      rollup.matches_eligible_with_odds::numeric * 100 / rollup.matches_odds_eligible
    ) < 90 THEN 'below_sla'
    WHEN rollup.maximum_freshness_p95_seconds > 2160 THEN 'below_sla'
    ELSE 'ready'
  END AS gate_status,
  statement_timestamp() AS generated_at
FROM public.sports_providers AS provider
LEFT JOIN rollup ON rollup.provider_id = provider.id
LEFT JOIN job_state ON job_state.provider_id = provider.id
LEFT JOIN issue_state ON issue_state.provider_id = provider.id
WHERE provider.code = 'highlightly';

REVOKE ALL ON TABLE public.hl_highlightly_future_gate_v FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.hl_highlightly_future_gate_v TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_highlightly_quarantined_wnba_standings_issues(
  p_scope text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  accepted_count integer;
BEGIN
  IF p_scope IS NULL OR btrim(p_scope) = '' OR length(p_scope) > 160 THEN
    RAISE EXCEPTION 'scope must contain between 1 and 160 characters';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT issue.id
    FROM public.hl_data_quality_issues AS issue
    JOIN public.hl_ingestion_runs AS run_row ON run_row.id = issue.run_id
    JOIN public.hl_ingestion_jobs AS job ON job.id = run_row.job_id
    WHERE job.shadow_scope = btrim(p_scope)
      AND issue.sport = 'basketball'
      AND issue.endpoint_key = 'basketball.BasketballStandingsController_getStandings'
      AND issue.issue_code = 'BASKETBALL_STANDINGS_CORRUPTED'
      AND issue.severity = 'critical'
      AND issue.resolution_status = 'open'
      AND issue.details #>> '{context,leagueId}' = '11847'
      AND issue.details #>> '{context,rows}' = '30'
      AND issue.details #>> '{context,distinctTeams}' = '1'
      AND issue.details #>> '{context,duplicateWithinGroup}' = 'true'
  ),
  updated AS (
    UPDATE public.hl_data_quality_issues AS issue
    SET
      resolution_status = 'accepted',
      resolved_at = now(),
      updated_at = now(),
      details = issue.details || jsonb_build_object(
        'resolution', 'provider_quarantined',
        'resolutionReason', 'recurrent_identity_corruption',
        'resolutionScope', btrim(p_scope),
        'resolvedAt', now()
      )
    FROM candidates
    WHERE issue.id = candidates.id
    RETURNING issue.id
  )
  SELECT count(*)::integer INTO accepted_count FROM updated;

  RETURN accepted_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.requeue_highlightly_dead_521_jobs(
  p_scope text,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.hl_ingestion_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_scope IS NULL OR btrim(p_scope) = '' OR length(p_scope) > 160 THEN
    RAISE EXCEPTION 'scope must contain between 1 and 160 characters';
  END IF;
  IF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'limit must be between 1 and 200';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly' AND provider.enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must be disabled before requeue';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.hl_ingestion_jobs AS job
    WHERE job.status IN ('pending', 'retry', 'running')
  ) THEN
    RAISE EXCEPTION 'active ingestion queue must be empty before requeue';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.hl_ingestion_jobs AS job
    WHERE job.shadow_scope = btrim(p_scope)
      AND job.sport = 'football'
      AND job.endpoint_key = 'football.FootballStatisticsController_getStatistics'
      AND job.status = 'dead'
      AND job.last_error = 'Highlightly returned HTTP 521'
    ORDER BY job.updated_at ASC, job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.hl_ingestion_jobs AS job
  SET
    status = 'retry',
    priority = 0,
    scheduled_at = now(),
    attempts = 0,
    max_attempts = 1,
    worker_id = NULL,
    locked_at = NULL,
    lock_expires_at = NULL,
    started_at = NULL,
    finished_at = NULL,
    cursor_data = job.cursor_data || jsonb_build_object(
      '_dead_521_requeued_at', now(),
      '_dead_521_prior_attempts', job.attempts
    ),
    updated_at = now()
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING job.*;
END
$function$;

CREATE OR REPLACE FUNCTION public.finalize_highlightly_shadow_window(
  p_scope text
)
RETURNS public.hl_shadow_windows
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  window_result public.hl_shadow_windows;
  dead_count integer := 0;
  critical_count integer := 0;
BEGIN
  IF p_scope IS NULL OR btrim(p_scope) = '' OR length(p_scope) > 160 THEN
    RAISE EXCEPTION 'scope must contain between 1 and 160 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly' AND provider.enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must be disabled before finalization';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.hl_ingestion_jobs AS job
    WHERE job.shadow_scope = btrim(p_scope)
      AND job.status IN ('pending', 'retry', 'running')
  ) THEN
    RAISE EXCEPTION 'scope still contains active ingestion jobs';
  END IF;

  SELECT count(*)::integer
  INTO dead_count
  FROM public.hl_ingestion_jobs AS job
  WHERE job.shadow_scope = btrim(p_scope)
    AND job.status = 'dead';

  SELECT count(*)::integer
  INTO critical_count
  FROM public.hl_data_quality_issues AS issue
  JOIN public.hl_ingestion_runs AS run_row ON run_row.job_id = job.id
  JOIN public.hl_ingestion_jobs AS job ON job.id = run_row.job_id
  WHERE job.shadow_scope = btrim(p_scope)
    AND issue.severity = 'critical'
    AND issue.resolution_status = 'open';

  UPDATE public.hl_shadow_windows AS window_row
  SET
    status = CASE
      WHEN dead_count > 0 OR critical_count > 0 THEN 'completed_with_exceptions'
      ELSE 'passed'
    END,
    ended_at = COALESCE(window_row.ended_at, now()),
    config = jsonb_set(
      jsonb_set(
        jsonb_set(
          window_row.config,
          '{window_kind}',
          to_jsonb(
            COALESCE(
              NULLIF(window_row.config ->> 'window_kind', ''),
              CASE
                WHEN window_row.scope LIKE 'future-%' THEN 'future'
                WHEN window_row.scope LIKE 'phase7-%' THEN 'historical'
                ELSE 'shadow'
              END
            )
          ),
          true
        ),
        '{current_slice,status}',
        '"completed"'::jsonb,
        true
      ),
      '{completion}',
      jsonb_build_object(
        'completedAt', now(),
        'deadJobs', dead_count,
        'openCriticalIssues', critical_count
      ),
      true
    ),
    updated_at = now()
  WHERE window_row.scope = btrim(p_scope)
  RETURNING * INTO window_result;

  IF window_result.id IS NULL THEN
    RAISE EXCEPTION 'unknown Highlightly shadow scope: %', btrim(p_scope);
  END IF;

  RETURN window_result;
END
$function$;

REVOKE ALL ON FUNCTION public.accept_highlightly_quarantined_wnba_standings_issues(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_highlightly_dead_521_jobs(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_highlightly_shadow_window(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accept_highlightly_quarantined_wnba_standings_issues(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_highlightly_dead_521_jobs(text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_highlightly_shadow_window(text)
  TO service_role;

NOTIFY pgrst, 'reload schema';