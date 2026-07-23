-- Highlightly Phase 8D: sport-specific odds SLAs, deterministic diagnostics,
-- and an idempotent T-24h/T-6h/T-60m refresh queue.

CREATE TABLE IF NOT EXISTS public.hl_odds_quality_targets (
  sport_id uuid PRIMARY KEY REFERENCES public.sports(id) ON DELETE CASCADE,
  minimum_availability_pct numeric(5, 2) NOT NULL,
  t24_freshness_seconds integer NOT NULL DEFAULT 86400,
  t6_freshness_seconds integer NOT NULL DEFAULT 21600,
  t60_freshness_seconds integer NOT NULL DEFAULT 3600,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_odds_quality_targets_availability_check CHECK (
    minimum_availability_pct BETWEEN 0 AND 100
  ),
  CONSTRAINT hl_odds_quality_targets_freshness_check CHECK (
    t24_freshness_seconds BETWEEN 3600 AND 172800
    AND t6_freshness_seconds BETWEEN 900 AND 43200
    AND t60_freshness_seconds BETWEEN 300 AND 7200
    AND t60_freshness_seconds <= t6_freshness_seconds
    AND t6_freshness_seconds <= t24_freshness_seconds
  )
);

INSERT INTO public.hl_odds_quality_targets (
  sport_id,
  minimum_availability_pct,
  t24_freshness_seconds,
  t6_freshness_seconds,
  t60_freshness_seconds,
  metadata
)
SELECT
  sport.id,
  CASE sport.code
    WHEN 'football' THEN 60.00
    WHEN 'baseball' THEN 20.00
    WHEN 'basketball' THEN 25.00
  END,
  86400,
  21600,
  3600,
  jsonb_build_object(
    'phase', '8D',
    'targetKind', 'progressive_provider_availability',
    'cadence', jsonb_build_array('T-24h', 'T-6h', 'T-60m')
  )
FROM public.sports AS sport
WHERE sport.code IN ('football', 'baseball', 'basketball')
ON CONFLICT (sport_id) DO UPDATE SET
  minimum_availability_pct = EXCLUDED.minimum_availability_pct,
  t24_freshness_seconds = EXCLUDED.t24_freshness_seconds,
  t6_freshness_seconds = EXCLUDED.t6_freshness_seconds,
  t60_freshness_seconds = EXCLUDED.t60_freshness_seconds,
  enabled = true,
  metadata = EXCLUDED.metadata,
  updated_at = now();

ALTER TABLE public.hl_odds_quality_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hl_odds_quality_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hl_odds_quality_targets TO authenticated;
GRANT ALL ON TABLE public.hl_odds_quality_targets TO service_role;

DROP POLICY IF EXISTS admin_read_hl_odds_quality_targets
  ON public.hl_odds_quality_targets;
CREATE POLICY admin_read_hl_odds_quality_targets
  ON public.hl_odds_quality_targets
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP TRIGGER IF EXISTS trg_hl_odds_quality_targets_touch_updated_at
  ON public.hl_odds_quality_targets;
CREATE TRIGGER trg_hl_odds_quality_targets_touch_updated_at
  BEFORE UPDATE ON public.hl_odds_quality_targets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_hl_ingestion_jobs_odds_match_lookup
  ON public.hl_ingestion_jobs (
    sport,
    (request_params ->> 'matchId'),
    updated_at DESC
  )
  WHERE endpoint_key IN (
    'football.FootballOddsController_getOddsV2',
    'baseball.BaseballOddsController_getOddsV2',
    'basketball.BasketballOddsController_getOddsV2'
  );

CREATE OR REPLACE FUNCTION public.get_highlightly_odds_refresh_candidates(
  p_at timestamptz DEFAULT now(),
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  match_id uuid,
  sport text,
  external_match_id text,
  kickoff_at timestamptz,
  refresh_horizon text,
  endpoint_key text,
  dedupe_key text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH provider AS (
    SELECT sports_provider.id
    FROM public.sports_providers AS sports_provider
    WHERE sports_provider.code = 'highlightly'
    LIMIT 1
  ),
  due AS (
    SELECT
      match_row.id AS match_id,
      sport.code AS sport,
      provider_entity.external_id AS external_match_id,
      match_row.kickoff_at,
      CASE
        WHEN match_row.kickoff_at <= p_at + interval '60 minutes' THEN 't60m'
        WHEN match_row.kickoff_at <= p_at + interval '6 hours' THEN 't6h'
        ELSE 't24h'
      END AS refresh_horizon,
      CASE sport.code
        WHEN 'football' THEN 'football.FootballOddsController_getOddsV2'
        WHEN 'baseball' THEN 'baseball.BaseballOddsController_getOddsV2'
        WHEN 'basketball' THEN 'basketball.BasketballOddsController_getOddsV2'
      END AS endpoint_key
    FROM public.sports_matches AS match_row
    JOIN public.sports AS sport
      ON sport.id = match_row.sport_id
    JOIN provider
      ON true
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.provider_id = provider.id
     AND provider_entity.sport_id = match_row.sport_id
     AND provider_entity.entity_type = 'match'
     AND provider_entity.canonical_id = match_row.id
    WHERE sport.code IN ('football', 'baseball', 'basketball')
      AND match_row.status = 'scheduled'
      AND match_row.kickoff_at > p_at
      AND match_row.kickoff_at <= p_at + interval '24 hours'
  ),
  identified AS (
    SELECT
      due.*,
      format(
        'phase8d:odds:%s:%s:%s:%s',
        due.sport,
        due.external_match_id,
        extract(epoch FROM due.kickoff_at)::bigint,
        due.refresh_horizon
      ) AS dedupe_key
    FROM due
  )
  SELECT
    identified.match_id,
    identified.sport,
    identified.external_match_id,
    identified.kickoff_at,
    identified.refresh_horizon,
    identified.endpoint_key,
    identified.dedupe_key
  FROM identified
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.hl_ingestion_jobs AS ingestion_job
    WHERE ingestion_job.dedupe_key = identified.dedupe_key
  )
  ORDER BY identified.kickoff_at, identified.sport, identified.external_match_id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000));
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_odds_refresh_candidates(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_odds_refresh_candidates(timestamptz, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_odds_quality_report(
  p_from timestamptz DEFAULT now(),
  p_to timestamptz DEFAULT now() + interval '5 days'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  generated_at timestamptz := statement_timestamp();
  result jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to > p_from + interval '7 days' THEN
    RAISE EXCEPTION 'odds quality interval must be greater than zero and at most seven days'
      USING ERRCODE = '22023';
  END IF;

  IF current_user NOT IN ('postgres', 'service_role')
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Highlightly odds quality report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH provider AS (
    SELECT sports_provider.id
    FROM public.sports_providers AS sports_provider
    WHERE sports_provider.code = 'highlightly'
    LIMIT 1
  ),
  base AS (
    SELECT
      match_row.id AS match_id,
      sport.id AS sport_id,
      sport.code AS sport,
      provider_entity.external_id AS external_match_id,
      match_row.kickoff_at,
      match_row.status,
      country.name AS country_name,
      competition.name AS competition_name,
      participants.home_team_name,
      participants.away_team_name,
      COALESCE(target.minimum_availability_pct, 0) AS minimum_availability_pct,
      CASE
        WHEN match_row.kickoff_at <= generated_at + interval '60 minutes'
          THEN COALESCE(target.t60_freshness_seconds, 3600)
        WHEN match_row.kickoff_at <= generated_at + interval '6 hours'
          THEN COALESCE(target.t6_freshness_seconds, 21600)
        ELSE COALESCE(target.t24_freshness_seconds, 86400)
      END AS freshness_target_seconds,
      match_row.kickoff_at <= generated_at + interval '24 hours' AS odds_due,
      COALESCE(odds.open_quotes, 0) AS open_quotes,
      COALESCE(odds.bookmaker_count, 0) AS bookmaker_count,
      COALESCE(odds.market_count, 0) AS market_count,
      odds.last_quote_at,
      CASE
        WHEN odds.last_quote_at IS NULL THEN NULL
        ELSE GREATEST(
          0,
          extract(epoch FROM generated_at - odds.last_quote_at)::bigint
        )
      END AS freshness_seconds,
      latest_job.id AS latest_job_id,
      latest_job.status AS latest_job_status,
      latest_job.updated_at AS latest_job_at,
      latest_run.id AS latest_run_id,
      latest_run.records_received,
      latest_run.records_normalized,
      latest_run.records_rejected,
      COALESCE(issues.issue_codes, ARRAY[]::text[]) AS issue_codes
    FROM public.sports_matches AS match_row
    JOIN public.sports AS sport
      ON sport.id = match_row.sport_id
    JOIN provider
      ON true
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.provider_id = provider.id
     AND provider_entity.sport_id = match_row.sport_id
     AND provider_entity.entity_type = 'match'
     AND provider_entity.canonical_id = match_row.id
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN public.sports_countries AS country
      ON country.id = competition.country_id
    LEFT JOIN public.hl_odds_quality_targets AS target
      ON target.sport_id = match_row.sport_id
     AND target.enabled
    LEFT JOIN LATERAL (
      SELECT
        max(CASE WHEN participant.role = 'home'
          THEN COALESCE(team.display_name, team.name) END) AS home_team_name,
        max(CASE WHEN participant.role = 'away'
          THEN COALESCE(team.display_name, team.name) END) AS away_team_name
      FROM public.sports_match_participants AS participant
      JOIN public.sports_teams AS team
        ON team.id = participant.team_id
      WHERE participant.match_id = match_row.id
    ) AS participants ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE quote.quote_status = 'open' AND NOT quote.is_live) AS open_quotes,
        count(DISTINCT quote.bookmaker_id)
          FILTER (WHERE quote.quote_status = 'open' AND NOT quote.is_live) AS bookmaker_count,
        count(DISTINCT quote.market_definition_id)
          FILTER (WHERE quote.quote_status = 'open' AND NOT quote.is_live) AS market_count,
        max(quote.updated_at)
          FILTER (WHERE quote.quote_status = 'open' AND NOT quote.is_live) AS last_quote_at
      FROM public.sports_odds_current AS quote
      WHERE quote.match_id = match_row.id
    ) AS odds ON true
    LEFT JOIN LATERAL (
      SELECT
        ingestion_job.id,
        ingestion_job.status,
        ingestion_job.updated_at
      FROM public.hl_ingestion_jobs AS ingestion_job
      WHERE ingestion_job.sport = sport.code
        AND ingestion_job.request_params ->> 'matchId' = provider_entity.external_id
        AND ingestion_job.endpoint_key = CASE sport.code
          WHEN 'football' THEN 'football.FootballOddsController_getOddsV2'
          WHEN 'baseball' THEN 'baseball.BaseballOddsController_getOddsV2'
          WHEN 'basketball' THEN 'basketball.BasketballOddsController_getOddsV2'
        END
      ORDER BY ingestion_job.updated_at DESC
      LIMIT 1
    ) AS latest_job ON true
    LEFT JOIN LATERAL (
      SELECT
        ingestion_run.id,
        ingestion_run.records_received,
        ingestion_run.records_normalized,
        ingestion_run.records_rejected
      FROM public.hl_ingestion_runs AS ingestion_run
      WHERE ingestion_run.job_id = latest_job.id
      ORDER BY ingestion_run.started_at DESC
      LIMIT 1
    ) AS latest_run ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT quality_issue.issue_code) AS issue_codes
      FROM public.hl_data_quality_issues AS quality_issue
      WHERE quality_issue.run_id = latest_run.id
        AND quality_issue.resolution_status IN ('open', 'accepted')
    ) AS issues ON true
    WHERE sport.code IN ('football', 'baseball', 'basketball')
      AND match_row.status = 'scheduled'
      AND match_row.kickoff_at >= p_from
      AND match_row.kickoff_at < p_to
  ),
  classified AS (
    SELECT
      base.*,
      CASE
        WHEN NOT base.odds_due THEN 'not_yet_due'
        WHEN base.open_quotes > 0
          AND base.freshness_seconds <= base.freshness_target_seconds THEN 'available'
        WHEN base.open_quotes > 0 THEN 'stale'
        WHEN base.latest_job_id IS NULL THEN 'not_collected'
        WHEN base.latest_job_status IN ('pending', 'running', 'retry') THEN 'collection_pending'
        WHEN base.latest_job_status = 'dead' THEN 'collection_failed'
        WHEN 'ODDS_PROVIDER_EMPTY' = ANY(base.issue_codes) THEN 'provider_empty'
        WHEN 'ODDS_QUOTE_UNAVAILABLE' = ANY(base.issue_codes) THEN 'provider_unavailable'
        WHEN 'ODDS_BOOKMAKER_MISSING' = ANY(base.issue_codes) THEN 'bookmaker_missing'
        WHEN 'ODDS_MARKET_MISSING' = ANY(base.issue_codes) THEN 'market_missing'
        WHEN 'ODDS_QUOTE_INVALID' = ANY(base.issue_codes) THEN 'quality_rejected'
        WHEN COALESCE(base.records_received, 0) = 0 THEN 'provider_empty'
        WHEN COALESCE(base.records_normalized, 0) = 0
          AND COALESCE(base.records_rejected, 0) > 0 THEN 'quality_rejected'
        ELSE 'no_supported_quote'
      END AS cause
    FROM base
  )
  SELECT jsonb_build_object(
    'generated_at', generated_at,
    'from', p_from,
    'to', p_to,
    'cadence', jsonb_build_array('T-24h', 'T-6h', 'T-60m'),
    'by_sport', COALESCE((
      SELECT jsonb_agg(to_jsonb(sport_summary) ORDER BY sport_summary.sport)
      FROM (
        SELECT
          classified.sport,
          count(*) AS matches_discovered,
          count(*) FILTER (WHERE classified.odds_due) AS matches_due,
          count(*) FILTER (WHERE classified.odds_due AND classified.cause = 'available')
            AS matches_available,
          count(*) FILTER (WHERE classified.odds_due AND classified.cause = 'stale')
            AS matches_stale,
          round(
            100.0 * count(*) FILTER (
              WHERE classified.odds_due AND classified.cause = 'available'
            ) / NULLIF(count(*) FILTER (WHERE classified.odds_due), 0),
            2
          ) AS availability_pct,
          max(classified.minimum_availability_pct) AS target_availability_pct,
          CASE
            WHEN count(*) FILTER (WHERE classified.odds_due) = 0 THEN 'no_due_matches'
            WHEN 100.0 * count(*) FILTER (
              WHERE classified.odds_due AND classified.cause = 'available'
            ) / NULLIF(count(*) FILTER (WHERE classified.odds_due), 0)
              >= max(classified.minimum_availability_pct) THEN 'ready'
            ELSE 'below_target'
          END AS gate_status,
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY classified.freshness_seconds
          ) FILTER (
            WHERE classified.odds_due AND classified.open_quotes > 0
          )::bigint AS freshness_p95_seconds
        FROM classified
        GROUP BY classified.sport
      ) AS sport_summary
    ), '[]'::jsonb),
    'by_cause', COALESCE((
      SELECT jsonb_agg(to_jsonb(cause_summary) ORDER BY cause_summary.sport, cause_summary.cause)
      FROM (
        SELECT classified.sport, classified.cause, count(*) AS matches
        FROM classified
        GROUP BY classified.sport, classified.cause
      ) AS cause_summary
    ), '[]'::jsonb),
    'matches', COALESCE((
      SELECT jsonb_agg(to_jsonb(match_summary) ORDER BY match_summary.kickoff_at)
      FROM (
        SELECT
          classified.match_id,
          classified.sport,
          classified.external_match_id,
          classified.kickoff_at,
          classified.country_name,
          classified.competition_name,
          classified.home_team_name,
          classified.away_team_name,
          classified.odds_due,
          classified.cause,
          classified.open_quotes,
          classified.bookmaker_count,
          classified.market_count,
          classified.last_quote_at,
          classified.freshness_seconds,
          classified.freshness_target_seconds,
          classified.latest_job_status,
          classified.issue_codes
        FROM classified
        WHERE classified.cause <> 'available'
        ORDER BY classified.odds_due DESC, classified.kickoff_at
        LIMIT 200
      ) AS match_summary
    ), '[]'::jsonb)
  )
  INTO result;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_odds_quality_report(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_odds_quality_report(timestamptz, timestamptz)
  TO authenticated, service_role;

COMMENT ON TABLE public.hl_odds_quality_targets IS
  'Phase 8D sport-specific Highlightly odds availability and freshness targets.';
COMMENT ON FUNCTION public.get_highlightly_odds_refresh_candidates(timestamptz, integer) IS
  'Service-role-only idempotent odds refresh candidates at T-24h, T-6h and T-60m.';
COMMENT ON FUNCTION public.get_highlightly_odds_quality_report(timestamptz, timestamptz) IS
  'Admin-gated Phase 8D odds availability, freshness and deterministic cause report.';

NOTIFY pgrst, 'reload schema';
