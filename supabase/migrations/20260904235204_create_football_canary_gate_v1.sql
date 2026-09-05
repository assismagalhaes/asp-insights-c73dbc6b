CREATE OR REPLACE FUNCTION public.get_highlightly_football_canary_gate_v1(
  p_days integer DEFAULT 14,
  p_match_coverage_sla numeric DEFAULT 95,
  p_odds_coverage_sla numeric DEFAULT 90,
  p_freshness_sla_seconds integer DEFAULT 3600,
  p_min_league_matches integer DEFAULT 5
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
    RAISE EXCEPTION 'canary days must be between 1 and 30'
      USING ERRCODE = '22023';
  END IF;
  IF p_match_coverage_sla < 0 OR p_match_coverage_sla > 100
     OR p_odds_coverage_sla < 0 OR p_odds_coverage_sla > 100 THEN
    RAISE EXCEPTION 'coverage SLAs must be between 0 and 100'
      USING ERRCODE = '22023';
  END IF;
  IF p_freshness_sla_seconds < 1 OR p_min_league_matches < 1 THEN
    RAISE EXCEPTION 'freshness SLA and minimum league sample must be positive'
      USING ERRCODE = '22023';
  END IF;

  WITH latest_daily_observation AS (
    SELECT DISTINCT ON (observation.observed_on)
      observation.observed_on,
      observation.jobs_dead,
      observation.open_critical_issues,
      observation.matches_expected,
      observation.matches_seen,
      observation.matches_with_odds,
      observation.freshness_p95_seconds
    FROM public.hl_shadow_observations AS observation
    JOIN public.hl_shadow_windows AS window_row
      ON window_row.id = observation.window_id
    WHERE observation.sport = 'football'
      AND COALESCE(window_row.config ->> 'window_kind', 'future') = 'future'
      AND observation.observed_on >= current_date - (p_days - 1)
    ORDER BY observation.observed_on, observation.updated_at DESC
  ),
  overall AS (
    SELECT
      count(*)::integer AS observed_days,
      COALESCE(sum(jobs_dead), 0)::integer AS dead_jobs,
      COALESCE(sum(open_critical_issues), 0)::integer AS open_critical_issues,
      COALESCE(sum(matches_expected), 0)::integer AS matches_expected,
      COALESCE(sum(matches_seen), 0)::integer AS matches_seen,
      COALESCE(sum(matches_with_odds), 0)::integer AS matches_with_odds,
      max(freshness_p95_seconds)::integer AS freshness_p95_seconds
    FROM latest_daily_observation
  ),
  overall_scored AS (
    SELECT
      overall.*,
      round(100.0 * matches_seen / NULLIF(matches_expected, 0), 2)
        AS match_coverage_pct,
      round(100.0 * matches_with_odds / NULLIF(matches_seen, 0), 2)
        AS odds_coverage_pct
    FROM overall
  ),
  league_coverage AS (
    SELECT
      daily.competition_id,
      country.name AS country_name,
      competition.name AS competition_name,
      count(DISTINCT daily.observed_on)::integer AS observed_days,
      sum(daily.matches_due)::integer AS matches_due,
      sum(daily.matches_available)::integer AS matches_available,
      sum(daily.matches_provider_empty)::integer AS matches_provider_empty,
      sum(daily.matches_other_unavailable)::integer AS matches_other_unavailable,
      max(daily.refreshed_at) AS refreshed_at
    FROM public.hl_odds_league_coverage_daily AS daily
    JOIN public.sports AS sport ON sport.id = daily.sport_id
    JOIN public.sports_competitions AS competition
      ON competition.id = daily.competition_id
    LEFT JOIN public.sports_countries AS country ON country.id = daily.country_id
    WHERE sport.code = 'football'
      AND daily.observed_on >= current_date - (p_days - 1)
    GROUP BY daily.competition_id, country.name, competition.name
  ),
  league_scored AS (
    SELECT
      league_coverage.*,
      round(100.0 * matches_available / NULLIF(matches_due, 0), 2)
        AS raw_availability_pct,
      round(
        100.0 * matches_available
          / NULLIF(matches_due - matches_provider_empty, 0),
        2
      ) AS eligible_availability_pct
    FROM league_coverage
  ),
  league_gates AS (
    SELECT
      league_scored.*,
      CASE
        WHEN observed_days < p_days OR matches_due < p_min_league_matches
          THEN 'collecting'
        WHEN eligible_availability_pct IS NULL THEN 'provider_unavailable'
        WHEN eligible_availability_pct < p_odds_coverage_sla THEN 'below_sla'
        ELSE 'ready'
      END AS gate_status
    FROM league_scored
  )
  SELECT jsonb_build_object(
    'generated_at', statement_timestamp(),
    'sport', 'football',
    'window_kind', 'future',
    'required_days', p_days,
    'observed_days', overall_scored.observed_days,
    'remaining_days', greatest(p_days - overall_scored.observed_days, 0),
    'matches_expected', overall_scored.matches_expected,
    'matches_seen', overall_scored.matches_seen,
    'matches_with_odds', overall_scored.matches_with_odds,
    'match_coverage_pct', overall_scored.match_coverage_pct,
    'odds_coverage_pct', overall_scored.odds_coverage_pct,
    'freshness_p95_seconds', overall_scored.freshness_p95_seconds,
    'dead_jobs', overall_scored.dead_jobs,
    'open_critical_issues', overall_scored.open_critical_issues,
    'gate_status', CASE
      WHEN overall_scored.dead_jobs > 0
        OR overall_scored.open_critical_issues > 0 THEN 'blocked'
      WHEN overall_scored.observed_days < p_days
        OR overall_scored.matches_seen = 0 THEN 'collecting'
      WHEN overall_scored.match_coverage_pct < p_match_coverage_sla
        OR overall_scored.odds_coverage_pct < p_odds_coverage_sla
        OR overall_scored.freshness_p95_seconds > p_freshness_sla_seconds
        THEN 'below_sla'
      ELSE 'ready'
    END,
    'thresholds', jsonb_build_object(
      'match_coverage_pct', p_match_coverage_sla,
      'odds_coverage_pct', p_odds_coverage_sla,
      'freshness_p95_seconds', p_freshness_sla_seconds,
      'minimum_league_matches', p_min_league_matches
    ),
    'league_gate_status', CASE
      WHEN NOT EXISTS (SELECT 1 FROM league_gates) THEN 'collecting'
      WHEN EXISTS (
        SELECT 1 FROM league_gates WHERE gate_status = 'below_sla'
      ) THEN 'below_sla'
      WHEN EXISTS (
        SELECT 1 FROM league_gates WHERE gate_status = 'collecting'
      ) THEN 'collecting'
      ELSE 'ready'
    END,
    'leagues', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(league_gates)
          ORDER BY matches_due DESC, country_name, competition_name
        )
        FROM league_gates
      ),
      '[]'::jsonb
    ),
    'market_gate_status', 'pending_daily_rollup',
    'market_gate_note',
      'Market-level certification remains separate until a daily persisted rollup exists.'
  )
  INTO result
  FROM overall_scored;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_football_canary_gate_v1(
  integer,
  numeric,
  numeric,
  integer,
  integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_football_canary_gate_v1(
  integer,
  numeric,
  numeric,
  integer,
  integer
) TO service_role;

COMMENT ON FUNCTION public.get_highlightly_football_canary_gate_v1(
  integer,
  numeric,
  numeric,
  integer,
  integer
) IS
  'Lightweight football-only future-window canary gate based on 14 persisted daily observations and per-league odds rollups.';

NOTIFY pgrst, 'reload schema';
