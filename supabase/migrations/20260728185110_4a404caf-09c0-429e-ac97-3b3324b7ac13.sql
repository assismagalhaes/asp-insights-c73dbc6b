CREATE TABLE IF NOT EXISTS public.hl_odds_league_coverage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_on date NOT NULL,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  country_id uuid REFERENCES public.sports_countries(id) ON DELETE SET NULL,
  competition_id uuid NOT NULL REFERENCES public.sports_competitions(id) ON DELETE CASCADE,
  matches_due integer NOT NULL DEFAULT 0 CHECK (matches_due >= 0),
  matches_available integer NOT NULL DEFAULT 0 CHECK (matches_available >= 0),
  matches_provider_empty integer NOT NULL DEFAULT 0 CHECK (matches_provider_empty >= 0),
  matches_other_unavailable integer NOT NULL DEFAULT 0
    CHECK (matches_other_unavailable >= 0),
  raw_availability_pct numeric(7, 2),
  eligible_availability_pct numeric(7, 2),
  provider_empty_pct numeric(7, 2),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_odds_league_coverage_daily_unique
    UNIQUE (observed_on, sport_id, competition_id),
  CONSTRAINT hl_odds_league_coverage_daily_counts_check CHECK (
    matches_available + matches_provider_empty + matches_other_unavailable
      <= matches_due
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_odds_league_coverage_daily_report
  ON public.hl_odds_league_coverage_daily (
    observed_on DESC,
    sport_id,
    competition_id
  );

ALTER TABLE public.hl_odds_league_coverage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hl_odds_league_coverage_daily
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hl_odds_league_coverage_daily TO authenticated;
GRANT ALL ON TABLE public.hl_odds_league_coverage_daily TO service_role;

DROP POLICY IF EXISTS admin_read_hl_odds_league_coverage_daily
  ON public.hl_odds_league_coverage_daily;
CREATE POLICY admin_read_hl_odds_league_coverage_daily
  ON public.hl_odds_league_coverage_daily
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  );

DROP TRIGGER IF EXISTS trg_hl_odds_league_coverage_daily_touch_updated_at
  ON public.hl_odds_league_coverage_daily;
CREATE TRIGGER trg_hl_odds_league_coverage_daily_touch_updated_at
  BEFORE UPDATE ON public.hl_odds_league_coverage_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.refresh_highlightly_odds_league_coverage(
  p_observed_on date DEFAULT current_date,
  p_from timestamptz DEFAULT now(),
  p_to timestamptz DEFAULT now() + interval '24 hours'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  affected integer := 0;
BEGIN
  IF p_observed_on IS NULL
     OR p_from IS NULL
     OR p_to IS NULL
     OR p_to <= p_from
     OR p_to > p_from + interval '24 hours' THEN
    RAISE EXCEPTION
      'league coverage interval must be greater than zero and at most 24 hours'
      USING ERRCODE = '22023';
  END IF;

  WITH provider AS (
    SELECT sports_provider.id
    FROM public.sports_providers AS sports_provider
    WHERE sports_provider.code = 'highlightly'
    LIMIT 1
  ),
  matches_in_window AS (
    SELECT
      match_row.id AS match_id,
      match_row.sport_id,
      match_row.competition_id,
      competition.country_id,
      sport.code AS sport,
      provider_entity.external_id AS external_match_id
    FROM public.sports_matches AS match_row
    JOIN public.sports AS sport
      ON sport.id = match_row.sport_id
    JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    JOIN provider ON true
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.provider_id = provider.id
     AND provider_entity.sport_id = match_row.sport_id
     AND provider_entity.entity_type = 'match'
     AND provider_entity.canonical_id = match_row.id
    WHERE sport.code IN ('football', 'baseball', 'basketball')
      AND match_row.status = 'scheduled'
      AND match_row.kickoff_at >= p_from
      AND match_row.kickoff_at < p_to
  ),
  classified AS (
    SELECT
      match_row.*,
      CASE
        WHEN odds.open_quotes > 0 THEN 'available'
        WHEN 'ODDS_PROVIDER_EMPTY' = ANY(
          COALESCE(issues.issue_codes, ARRAY[]::text[])
        ) THEN 'provider_empty'
        WHEN 'ODDS_QUOTE_UNAVAILABLE' = ANY(
          COALESCE(issues.issue_codes, ARRAY[]::text[])
        ) THEN 'provider_empty'
        WHEN latest_run.id IS NOT NULL
          AND COALESCE(latest_run.records_received, 0) = 0
          THEN 'provider_empty'
        ELSE 'other_unavailable'
      END AS coverage_status
    FROM matches_in_window AS match_row
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (
        WHERE quote.quote_status = 'open' AND NOT quote.is_live
      ) AS open_quotes
      FROM public.sports_odds_current AS quote
      WHERE quote.match_id = match_row.match_id
    ) AS odds ON true
    LEFT JOIN LATERAL (
      SELECT ingestion_job.id
      FROM public.hl_ingestion_jobs AS ingestion_job
      WHERE ingestion_job.sport = match_row.sport
        AND ingestion_job.request_params ->> 'matchId'
          = match_row.external_match_id
        AND ingestion_job.endpoint_key = CASE match_row.sport
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
        ingestion_run.records_received
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
  ),
  aggregated AS (
    SELECT
      p_observed_on AS observed_on,
      classified.sport_id,
      classified.country_id,
      classified.competition_id,
      count(*)::integer AS matches_due,
      count(*) FILTER (
        WHERE classified.coverage_status = 'available'
      )::integer AS matches_available,
      count(*) FILTER (
        WHERE classified.coverage_status = 'provider_empty'
      )::integer AS matches_provider_empty,
      count(*) FILTER (
        WHERE classified.coverage_status = 'other_unavailable'
      )::integer AS matches_other_unavailable
    FROM classified
    GROUP BY
      classified.sport_id,
      classified.country_id,
      classified.competition_id
  ),
  upserted AS (
    INSERT INTO public.hl_odds_league_coverage_daily (
      observed_on,
      sport_id,
      country_id,
      competition_id,
      matches_due,
      matches_available,
      matches_provider_empty,
      matches_other_unavailable,
      raw_availability_pct,
      eligible_availability_pct,
      provider_empty_pct,
      refreshed_at
    )
    SELECT
      aggregated.observed_on,
      aggregated.sport_id,
      aggregated.country_id,
      aggregated.competition_id,
      aggregated.matches_due,
      aggregated.matches_available,
      aggregated.matches_provider_empty,
      aggregated.matches_other_unavailable,
      round(
        100.0 * aggregated.matches_available
          / NULLIF(aggregated.matches_due, 0),
        2
      ),
      round(
        100.0 * aggregated.matches_available
          / NULLIF(
            aggregated.matches_due - aggregated.matches_provider_empty,
            0
          ),
        2
      ),
      round(
        100.0 * aggregated.matches_provider_empty
          / NULLIF(aggregated.matches_due, 0),
        2
      ),
      statement_timestamp()
    FROM aggregated
    ON CONFLICT (observed_on, sport_id, competition_id)
    DO UPDATE SET
      country_id = EXCLUDED.country_id,
      matches_due = EXCLUDED.matches_due,
      matches_available = EXCLUDED.matches_available,
      matches_provider_empty = EXCLUDED.matches_provider_empty,
      matches_other_unavailable = EXCLUDED.matches_other_unavailable,
      raw_availability_pct = EXCLUDED.raw_availability_pct,
      eligible_availability_pct = EXCLUDED.eligible_availability_pct,
      provider_empty_pct = EXCLUDED.provider_empty_pct,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING 1
  )
  SELECT count(*)::integer INTO affected FROM upserted;

  RETURN affected;
END
$function$;

REVOKE ALL ON FUNCTION public.refresh_highlightly_odds_league_coverage(
  date,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_highlightly_odds_league_coverage(
  date,
  timestamptz,
  timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_odds_league_coverage_report(
  p_days integer DEFAULT 7,
  p_min_matches integer DEFAULT 20
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
  IF p_days < 1 OR p_days > 30 THEN
    RAISE EXCEPTION 'coverage report days must be between 1 and 30'
      USING ERRCODE = '22023';
  END IF;
  IF p_min_matches < 1 OR p_min_matches > 1000 THEN
    RAISE EXCEPTION 'coverage report minimum sample must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'Highlightly league coverage report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH coverage AS (
    SELECT
      sport.code AS sport,
      country.name AS country_name,
      competition.name AS competition_name,
      daily.competition_id,
      count(DISTINCT daily.observed_on)::integer AS observed_days,
      sum(daily.matches_due)::integer AS matches_due,
      sum(daily.matches_available)::integer AS matches_available,
      sum(daily.matches_provider_empty)::integer AS matches_provider_empty,
      sum(daily.matches_other_unavailable)::integer
        AS matches_other_unavailable,
      max(daily.refreshed_at) AS refreshed_at
    FROM public.hl_odds_league_coverage_daily AS daily
    JOIN public.sports AS sport ON sport.id = daily.sport_id
    JOIN public.sports_competitions AS competition
      ON competition.id = daily.competition_id
    LEFT JOIN public.sports_countries AS country
      ON country.id = daily.country_id
    WHERE daily.observed_on >= current_date - (p_days - 1)
    GROUP BY
      sport.code,
      country.name,
      competition.name,
      daily.competition_id
  ),
  scored AS (
    SELECT
      coverage.*,
      round(
        100.0 * coverage.matches_available
          / NULLIF(coverage.matches_due, 0),
        2
      ) AS raw_availability_pct,
      round(
        100.0 * coverage.matches_available
          / NULLIF(
            coverage.matches_due - coverage.matches_provider_empty,
            0
          ),
        2
      ) AS eligible_availability_pct,
      round(
        100.0 * coverage.matches_provider_empty
          / NULLIF(coverage.matches_due, 0),
        2
      ) AS provider_empty_pct
    FROM coverage
  ),
  recommendations AS (
    SELECT
      scored.*,
      CASE
        WHEN scored.matches_due < p_min_matches THEN 'insufficient_sample'
        WHEN scored.provider_empty_pct >= 80 THEN 'candidate_t60m_only'
        WHEN scored.provider_empty_pct >= 50 THEN 'monitor_provider_coverage'
        ELSE 'keep_full_cadence'
      END AS recommendation
    FROM scored
  )
  SELECT jsonb_build_object(
    'generated_at', statement_timestamp(),
    'window_days', p_days,
    'minimum_sample', p_min_matches,
    'automatic_exclusions', false,
    'leagues', COALESCE(
      jsonb_agg(
        to_jsonb(recommendations)
        ORDER BY
          recommendations.matches_due DESC,
          recommendations.sport,
          recommendations.country_name,
          recommendations.competition_name
      ),
      '[]'::jsonb
    )
  )
  INTO result
  FROM recommendations;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_odds_league_coverage_report(
  integer,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_odds_league_coverage_report(
  integer,
  integer
) TO authenticated, service_role;

COMMENT ON TABLE public.hl_odds_league_coverage_daily IS
  'Daily Phase 8D.2 Highlightly odds coverage snapshots by sport, country and competition.';
COMMENT ON FUNCTION public.refresh_highlightly_odds_league_coverage(
  date,
  timestamptz,
  timestamptz
) IS
  'Service-role refresh of the current 24-hour odds coverage snapshot by league.';
COMMENT ON FUNCTION public.get_highlightly_odds_league_coverage_report(
  integer,
  integer
) IS
  'Admin report with seven-day league coverage recommendations; never excludes automatically.';

NOTIFY pgrst, 'reload schema';