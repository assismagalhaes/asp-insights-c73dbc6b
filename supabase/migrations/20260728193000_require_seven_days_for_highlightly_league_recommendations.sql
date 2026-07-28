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
        WHEN scored.observed_days < p_days
          OR scored.matches_due < p_min_matches
          THEN 'insufficient_sample'
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
    'minimum_observed_days', p_days,
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

COMMENT ON FUNCTION public.get_highlightly_odds_league_coverage_report(
  integer,
  integer
) IS
  'Admin league coverage report that requires the full observation window and minimum sample before recommendations.';

NOTIFY pgrst, 'reload schema';
