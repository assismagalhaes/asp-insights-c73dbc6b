ALTER TABLE public.hl_ingestion_jobs
  ADD COLUMN IF NOT EXISTS shadow_scope text;

CREATE OR REPLACE FUNCTION public.set_highlightly_job_shadow_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.shadow_scope := COALESCE(
    NULLIF(NEW.request_params ->> '_shadow_scope', ''),
    NULLIF(NEW.request_params ->> '_fanout_scope', '')
  );
  IF NEW.shadow_scope IS NOT NULL AND length(NEW.shadow_scope) > 160 THEN
    RAISE EXCEPTION 'Highlightly shadow scope exceeds 160 characters';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_hl_ingestion_jobs_set_shadow_scope ON public.hl_ingestion_jobs;
CREATE TRIGGER trg_hl_ingestion_jobs_set_shadow_scope
  BEFORE INSERT OR UPDATE OF request_params
  ON public.hl_ingestion_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_highlightly_job_shadow_scope();

UPDATE public.hl_ingestion_jobs
SET shadow_scope = COALESCE(
  NULLIF(request_params ->> '_shadow_scope', ''),
  NULLIF(request_params ->> '_fanout_scope', '')
)
WHERE shadow_scope IS NULL
  AND (
    NULLIF(request_params ->> '_shadow_scope', '') IS NOT NULL
    OR NULLIF(request_params ->> '_fanout_scope', '') IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_hl_ingestion_jobs_shadow_scope
  ON public.hl_ingestion_jobs (shadow_scope, sport, status, created_at DESC)
  WHERE shadow_scope IS NOT NULL;

REVOKE ALL ON FUNCTION public.set_highlightly_job_shadow_scope() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.hl_shadow_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE RESTRICT,
  scope text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'planned',
  sports text[] NOT NULL DEFAULT ARRAY['football', 'baseball', 'basketball']::text[],
  started_at timestamptz NOT NULL,
  planned_end_at timestamptz NOT NULL,
  ended_at timestamptz,
  daily_request_budget integer NOT NULL DEFAULT 1500,
  reserve_requests integer NOT NULL DEFAULT 750,
  match_coverage_sla numeric(5, 2) NOT NULL DEFAULT 95,
  odds_coverage_sla numeric(5, 2) NOT NULL DEFAULT 90,
  freshness_sla_seconds integer NOT NULL DEFAULT 2160,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_shadow_windows_status_check CHECK (
    status IN ('planned', 'running', 'passed', 'failed', 'cancelled')
  ),
  CONSTRAINT hl_shadow_windows_sports_check CHECK (
    cardinality(sports) > 0
    AND sports <@ ARRAY['football', 'baseball', 'basketball']::text[]
  ),
  CONSTRAINT hl_shadow_windows_dates_check CHECK (
    planned_end_at > started_at AND (ended_at IS NULL OR ended_at >= started_at)
  ),
  CONSTRAINT hl_shadow_windows_budget_check CHECK (
    daily_request_budget BETWEEN 1 AND 6750
    AND reserve_requests BETWEEN 750 AND 7499
    AND daily_request_budget + reserve_requests <= 7500
  ),
  CONSTRAINT hl_shadow_windows_sla_check CHECK (
    match_coverage_sla BETWEEN 0 AND 100
    AND odds_coverage_sla BETWEEN 0 AND 100
    AND freshness_sla_seconds > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_shadow_windows_provider_status
  ON public.hl_shadow_windows (provider_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hl_shadow_windows_active
  ON public.hl_shadow_windows (started_at, planned_end_at)
  WHERE status IN ('planned', 'running');

CREATE TABLE IF NOT EXISTS public.hl_shadow_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id uuid NOT NULL REFERENCES public.hl_shadow_windows(id) ON DELETE CASCADE,
  observed_on date NOT NULL,
  sport text NOT NULL,
  jobs_total integer NOT NULL DEFAULT 0,
  jobs_succeeded integer NOT NULL DEFAULT 0,
  jobs_partial integer NOT NULL DEFAULT 0,
  jobs_retry integer NOT NULL DEFAULT 0,
  jobs_dead integer NOT NULL DEFAULT 0,
  jobs_pending integer NOT NULL DEFAULT 0,
  requests_used integer NOT NULL DEFAULT 0,
  matches_expected integer NOT NULL DEFAULT 0,
  matches_seen integer NOT NULL DEFAULT 0,
  matches_with_odds integer NOT NULL DEFAULT 0,
  freshness_p95_seconds integer,
  latency_p50_ms integer,
  latency_p95_ms integer,
  open_warning_issues integer NOT NULL DEFAULT 0,
  open_error_issues integer NOT NULL DEFAULT 0,
  open_critical_issues integer NOT NULL DEFAULT 0,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  match_coverage_pct numeric(7, 4) GENERATED ALWAYS AS (
    CASE
      WHEN matches_expected = 0 THEN NULL
      ELSE LEAST(100::numeric, matches_seen::numeric * 100 / matches_expected)
    END
  ) STORED,
  odds_coverage_pct numeric(7, 4) GENERATED ALWAYS AS (
    CASE
      WHEN matches_seen = 0 THEN NULL
      ELSE LEAST(100::numeric, matches_with_odds::numeric * 100 / matches_seen)
    END
  ) STORED,
  CONSTRAINT hl_shadow_observations_unique UNIQUE (window_id, observed_on, sport),
  CONSTRAINT hl_shadow_observations_sport_check CHECK (
    sport IN ('football', 'baseball', 'basketball')
  ),
  CONSTRAINT hl_shadow_observations_counts_check CHECK (
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
    AND open_warning_issues >= 0
    AND open_error_issues >= 0
    AND open_critical_issues >= 0
  ),
  CONSTRAINT hl_shadow_observations_timings_check CHECK (
    (freshness_p95_seconds IS NULL OR freshness_p95_seconds >= 0)
    AND (latency_p50_ms IS NULL OR latency_p50_ms >= 0)
    AND (latency_p95_ms IS NULL OR latency_p95_ms >= 0)
    AND (latency_p50_ms IS NULL OR latency_p95_ms IS NULL OR latency_p95_ms >= latency_p50_ms)
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_shadow_observations_window_date
  ON public.hl_shadow_observations (window_id, observed_on DESC, sport)
  INCLUDE (requests_used, jobs_dead, open_critical_issues);
CREATE INDEX IF NOT EXISTS idx_hl_shadow_observations_sport_date
  ON public.hl_shadow_observations (sport, observed_on DESC);

CREATE TABLE IF NOT EXISTS public.hl_source_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id uuid NOT NULL REFERENCES public.hl_shadow_windows(id) ON DELETE CASCADE,
  observed_on date NOT NULL,
  sport text NOT NULL,
  source_name text NOT NULL,
  competition_key text NOT NULL DEFAULT '',
  expected_matches integer NOT NULL DEFAULT 0,
  highlightly_matches integer NOT NULL DEFAULT 0,
  matched_matches integer NOT NULL DEFAULT 0,
  missing_in_highlightly integer NOT NULL DEFAULT 0,
  extra_in_highlightly integer NOT NULL DEFAULT 0,
  kickoff_divergences integer NOT NULL DEFAULT 0,
  score_divergences integer NOT NULL DEFAULT 0,
  odds_divergences integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  coverage_pct numeric(7, 4) GENERATED ALWAYS AS (
    CASE
      WHEN expected_matches = 0 THEN NULL
      ELSE LEAST(100::numeric, matched_matches::numeric * 100 / expected_matches)
    END
  ) STORED,
  CONSTRAINT hl_source_reconciliations_unique UNIQUE (
    window_id, observed_on, sport, source_name, competition_key
  ),
  CONSTRAINT hl_source_reconciliations_sport_check CHECK (
    sport IN ('football', 'baseball', 'basketball')
  ),
  CONSTRAINT hl_source_reconciliations_counts_check CHECK (
    expected_matches >= 0
    AND highlightly_matches >= 0
    AND matched_matches >= 0
    AND matched_matches <= expected_matches
    AND matched_matches <= highlightly_matches
    AND missing_in_highlightly >= 0
    AND extra_in_highlightly >= 0
    AND kickoff_divergences >= 0
    AND score_divergences >= 0
    AND odds_divergences >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_source_reconciliations_window_date
  ON public.hl_source_reconciliations (window_id, observed_on DESC, sport);
CREATE INDEX IF NOT EXISTS idx_hl_source_reconciliations_below_sla
  ON public.hl_source_reconciliations (window_id, coverage_pct, observed_on DESC)
  WHERE coverage_pct IS NOT NULL AND coverage_pct < 95;

DO $phase7_triggers$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'hl_shadow_windows',
    'hl_shadow_observations',
    'hl_source_reconciliations'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      'trg_' || table_name || '_touch_updated_at',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      'trg_' || table_name || '_touch_updated_at',
      table_name
    );
  END LOOP;
END
$phase7_triggers$;

DO $phase7_security$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'hl_shadow_windows',
    'hl_shadow_observations',
    'hl_source_reconciliations'
  ] LOOP
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
$phase7_security$;

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
    SELECT 1 FROM public.hl_shadow_windows WHERE id = p_window_id
  ) THEN
    RAISE EXCEPTION 'shadow window % was not found', p_window_id;
  END IF;

  WITH scoped_jobs AS MATERIALIZED (
    SELECT job.id, job.status
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
    SELECT DISTINCT mapping.canonical_id AS match_id
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
          ORDER BY GREATEST(0, extract(epoch FROM (now() - match_row.updated_at)))
        )
      )::integer AS freshness_p95_seconds
    FROM match_scope
    JOIN public.sports_matches AS match_row ON match_row.id = match_scope.match_id
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
    match_rollup.freshness_p95_seconds,
    run_rollup.latency_p50_ms,
    run_rollup.latency_p95_ms,
    issue_rollup.open_warning_issues,
    issue_rollup.open_error_issues,
    issue_rollup.open_critical_issues,
    jsonb_build_object('scope', p_scope, 'refreshed_at', now())
  FROM job_rollup
  CROSS JOIN run_rollup
  CROSS JOIN usage_rollup
  CROSS JOIN issue_rollup
  CROSS JOIN match_rollup
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

CREATE OR REPLACE FUNCTION public.refresh_highlightly_source_reconciliation(
  p_window_id uuid,
  p_observed_on date,
  p_sport text
)
RETURNS public.hl_source_reconciliations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  result public.hl_source_reconciliations;
BEGIN
  IF p_sport NOT IN ('football', 'baseball', 'basketball') THEN
    RAISE EXCEPTION 'invalid sport: %', p_sport;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hl_shadow_windows WHERE id = p_window_id
  ) THEN
    RAISE EXCEPTION 'shadow window % was not found', p_window_id;
  END IF;

  WITH source_fixtures AS MATERIALIZED (
    SELECT DISTINCT
      lower(regexp_replace(COALESCE(odd.mandante, ''), '[^a-zA-Z0-9]+', '', 'g')) AS home_key,
      lower(regexp_replace(COALESCE(odd.visitante, ''), '[^a-zA-Z0-9]+', '', 'g')) AS away_key,
      CASE
        WHEN odd.hora IS NULL THEN NULL
        ELSE (p_observed_on + odd.hora) AT TIME ZONE 'America/Sao_Paulo'
      END AS source_kickoff
    FROM public.odds_jogos AS odd
    WHERE odd.data = p_observed_on
      AND odd.mandante IS NOT NULL
      AND odd.visitante IS NOT NULL
      AND CASE p_sport
        WHEN 'football' THEN lower(COALESCE(odd.esporte, '')) IN ('football', 'futebol', 'soccer')
        WHEN 'baseball' THEN lower(COALESCE(odd.esporte, '')) IN ('baseball', 'mlb')
        WHEN 'basketball' THEN lower(COALESCE(odd.esporte, '')) IN ('basketball', 'basquete', 'wnba')
      END
  ),
  highlightly_fixtures AS MATERIALIZED (
    SELECT DISTINCT
      match_row.id AS match_id,
      lower(regexp_replace(home_team.name, '[^a-zA-Z0-9]+', '', 'g')) AS home_key,
      lower(regexp_replace(away_team.name, '[^a-zA-Z0-9]+', '', 'g')) AS away_key,
      match_row.kickoff_at
    FROM public.hl_shadow_windows AS window_row
    JOIN public.sports_provider_entities AS mapping
      ON mapping.provider_id = window_row.provider_id
     AND mapping.entity_type = 'match'
    JOIN public.sports AS sport_row
      ON sport_row.id = mapping.sport_id
     AND sport_row.code = p_sport
    JOIN public.sports_matches AS match_row ON match_row.id = mapping.canonical_id
    JOIN public.sports_match_participants AS home_participant
      ON home_participant.match_id = match_row.id AND home_participant.role = 'home'
    JOIN public.sports_teams AS home_team ON home_team.id = home_participant.team_id
    JOIN public.sports_match_participants AS away_participant
      ON away_participant.match_id = match_row.id AND away_participant.role = 'away'
    JOIN public.sports_teams AS away_team ON away_team.id = away_participant.team_id
    WHERE window_row.id = p_window_id
      AND (match_row.kickoff_at AT TIME ZONE 'America/Sao_Paulo')::date = p_observed_on
  ),
  compared AS (
    SELECT
      source.home_key,
      source.away_key,
      source.source_kickoff,
      highlightly.match_id,
      highlightly.kickoff_at
    FROM source_fixtures AS source
    LEFT JOIN highlightly_fixtures AS highlightly
      ON highlightly.home_key = source.home_key
     AND highlightly.away_key = source.away_key
  ),
  counts AS (
    SELECT
      (SELECT count(*) FROM source_fixtures)::integer AS expected_matches,
      (SELECT count(*) FROM highlightly_fixtures)::integer AS highlightly_matches,
      count(*) FILTER (WHERE match_id IS NOT NULL)::integer AS matched_matches,
      count(*) FILTER (WHERE match_id IS NULL)::integer AS missing_in_highlightly,
      count(*) FILTER (
        WHERE match_id IS NOT NULL
          AND source_kickoff IS NOT NULL
          AND kickoff_at IS NOT NULL
          AND abs(extract(epoch FROM (source_kickoff - kickoff_at))) > 900
      )::integer AS kickoff_divergences
    FROM compared
  )
  INSERT INTO public.hl_source_reconciliations (
    window_id,
    observed_on,
    sport,
    source_name,
    competition_key,
    expected_matches,
    highlightly_matches,
    matched_matches,
    missing_in_highlightly,
    extra_in_highlightly,
    kickoff_divergences,
    details
  )
  SELECT
    p_window_id,
    p_observed_on,
    p_sport,
    'odds_jogos',
    '',
    counts.expected_matches,
    counts.highlightly_matches,
    counts.matched_matches,
    counts.missing_in_highlightly,
    GREATEST(0, counts.highlightly_matches - counts.matched_matches),
    counts.kickoff_divergences,
    jsonb_build_object('matching', 'normalized_exact_home_away', 'kickoff_tolerance_seconds', 900)
  FROM counts
  ON CONFLICT (window_id, observed_on, sport, source_name, competition_key) DO UPDATE SET
    expected_matches = EXCLUDED.expected_matches,
    highlightly_matches = EXCLUDED.highlightly_matches,
    matched_matches = EXCLUDED.matched_matches,
    missing_in_highlightly = EXCLUDED.missing_in_highlightly,
    extra_in_highlightly = EXCLUDED.extra_in_highlightly,
    kickoff_divergences = EXCLUDED.kickoff_divergences,
    details = EXCLUDED.details,
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.refresh_highlightly_shadow_observation(uuid, date, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_highlightly_source_reconciliation(uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_highlightly_shadow_observation(uuid, date, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_highlightly_source_reconciliation(uuid, date, text)
  TO service_role;

CREATE OR REPLACE VIEW public.hl_phase7_window_health_v
WITH (security_invoker = true)
AS
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
  count(DISTINCT observation.observed_on)::integer AS observed_days,
  COALESCE(sum(observation.requests_used), 0)::bigint AS requests_used,
  COALESCE(sum(observation.jobs_dead), 0)::bigint AS unrecovered_jobs,
  COALESCE(sum(observation.open_critical_issues), 0)::bigint AS open_critical_issues,
  min(observation.match_coverage_pct) AS minimum_match_coverage_pct,
  min(observation.odds_coverage_pct) AS minimum_odds_coverage_pct,
  max(observation.freshness_p95_seconds) AS maximum_freshness_p95_seconds,
  max(observation.latency_p95_ms) AS maximum_latency_p95_ms,
  CASE
    WHEN COALESCE(sum(observation.jobs_dead), 0) > 0
      OR COALESCE(sum(observation.open_critical_issues), 0) > 0 THEN 'blocked'
    WHEN count(DISTINCT observation.observed_on) < 7
      OR count(observation.id) < 7 * cardinality(window_row.sports)
      OR count(observation.match_coverage_pct) < 7 * cardinality(window_row.sports)
      OR count(observation.odds_coverage_pct) < 7 * cardinality(window_row.sports)
      OR count(observation.freshness_p95_seconds) < 7 * cardinality(window_row.sports) THEN 'collecting'
    WHEN min(observation.match_coverage_pct) < window_row.match_coverage_sla
      OR min(observation.odds_coverage_pct) < window_row.odds_coverage_sla
      OR max(observation.freshness_p95_seconds) > window_row.freshness_sla_seconds THEN 'below_sla'
    ELSE 'ready'
  END AS gate_status
FROM public.hl_shadow_windows AS window_row
LEFT JOIN public.hl_shadow_observations AS observation
  ON observation.window_id = window_row.id
GROUP BY window_row.id;

REVOKE ALL ON TABLE public.hl_phase7_window_health_v FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.hl_phase7_window_health_v TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
