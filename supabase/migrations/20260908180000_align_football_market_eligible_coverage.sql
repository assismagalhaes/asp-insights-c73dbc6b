-- Align football market coverage with the canary's provider-empty eligibility rule.
-- Raw coverage remains available for audit; certification uses eligible coverage.

ALTER TABLE public.hl_football_market_coverage_daily
  ADD COLUMN matches_provider_empty integer NOT NULL DEFAULT 0
    CHECK (matches_provider_empty >= 0),
  ADD COLUMN eligible_availability_pct numeric(7, 2) GENERATED ALWAYS AS (
    round(
      100.0 * matches_available
        / NULLIF(matches_due - matches_provider_empty, 0),
      2
    )
  ) STORED;

ALTER TABLE public.hl_football_market_coverage_daily
  ADD CONSTRAINT hl_football_market_coverage_provider_empty_check
  CHECK (matches_available + matches_provider_empty <= matches_due);

COMMENT ON COLUMN public.hl_football_market_coverage_daily.availability_pct IS
  'Raw market coverage: matches_available divided by all matches_due.';
COMMENT ON COLUMN public.hl_football_market_coverage_daily.eligible_availability_pct IS
  'Eligible market coverage: explicitly provider-empty matches are excluded from matches_due.';

-- Existing daily snapshots can be reconciled without reconstructing provider calls because
-- the contemporaneous league rollup already persisted the same provider-empty classification.
UPDATE public.hl_football_market_coverage_daily AS market_daily
SET matches_provider_empty = LEAST(
  market_daily.matches_due,
  league_daily.matches_provider_empty
)
FROM public.hl_odds_league_coverage_daily AS league_daily
WHERE league_daily.observed_on = market_daily.observed_on
  AND league_daily.competition_id = market_daily.competition_id;

CREATE OR REPLACE FUNCTION public.refresh_highlightly_football_market_coverage(
  p_observed_on date DEFAULT current_date,
  p_from timestamptz DEFAULT now(),
  p_to timestamptz DEFAULT now() + interval '24 hours'
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE affected integer;
BEGIN
  IF p_observed_on IS NULL OR p_from IS NULL OR p_to IS NULL
     OR p_to <= p_from OR p_to > p_from + interval '24 hours' THEN
    RAISE EXCEPTION 'market coverage interval must be greater than zero and at most 24 hours'
      USING ERRCODE = '22023';
  END IF;

  WITH target_competitions(competition_id) AS (VALUES
    ('9247cd02-df38-519b-8791-512a016a9a38'::uuid), -- England Premier League
    ('1839d176-a7b8-5f92-adaa-40475560a5d8'::uuid), -- Spain La Liga
    ('1eaaa858-ec27-5162-ac9e-3f63a529a294'::uuid)  -- Japan J1 League
  ), market_specs(market_family, line_value) AS (VALUES
    ('moneyline'::text, NULL::numeric),
    ('total', 1.5), ('total', 2.5), ('total', 3.5), ('total', 4.5), ('total', 5.5),
    ('both_teams_to_score', NULL), ('double_chance', NULL),
    ('handicap', 0.5), ('handicap', 1.5), ('handicap', 2.5),
    ('handicap', 3.5), ('handicap', 4.5), ('handicap', 5.5)
  ), provider AS (
    SELECT sports_provider.id
    FROM public.sports_providers AS sports_provider
    WHERE sports_provider.code = 'highlightly'
    LIMIT 1
  ), due_matches AS MATERIALIZED (
    SELECT
      match_row.id,
      match_row.competition_id,
      provider_entity.external_id AS external_match_id
    FROM public.sports_matches AS match_row
    JOIN target_competitions AS target
      ON target.competition_id = match_row.competition_id
    JOIN public.sports AS sport ON sport.id = match_row.sport_id
    LEFT JOIN provider ON true
    LEFT JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.provider_id = provider.id
     AND provider_entity.sport_id = match_row.sport_id
     AND provider_entity.entity_type = 'match'
     AND provider_entity.canonical_id = match_row.id
    WHERE sport.code = 'football'
      AND match_row.status = 'scheduled'
      AND match_row.kickoff_at >= p_from
      AND match_row.kickoff_at < p_to
  ), classified_matches AS MATERIALIZED (
    SELECT
      due.*,
      CASE
        WHEN odds.open_quotes > 0 THEN false
        WHEN 'ODDS_PROVIDER_EMPTY' = ANY(
          COALESCE(issues.issue_codes, ARRAY[]::text[])
        ) THEN true
        WHEN 'ODDS_QUOTE_UNAVAILABLE' = ANY(
          COALESCE(issues.issue_codes, ARRAY[]::text[])
        ) THEN true
        WHEN latest_run.id IS NOT NULL
          AND COALESCE(latest_run.records_received, 0) = 0 THEN true
        ELSE false
      END AS is_provider_empty
    FROM due_matches AS due
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (
        WHERE quote.quote_status = 'open' AND NOT quote.is_live
      ) AS open_quotes
      FROM public.sports_odds_current AS quote
      WHERE quote.match_id = due.id
    ) AS odds ON true
    LEFT JOIN LATERAL (
      SELECT ingestion_job.id
      FROM public.hl_ingestion_jobs AS ingestion_job
      WHERE ingestion_job.sport = 'football'
        AND ingestion_job.request_params ->> 'matchId' = due.external_match_id
        AND ingestion_job.endpoint_key =
          'football.FootballOddsController_getOddsV2'
      ORDER BY ingestion_job.updated_at DESC
      LIMIT 1
    ) AS latest_job ON true
    LEFT JOIN LATERAL (
      SELECT ingestion_run.id, ingestion_run.records_received
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
  ), grid AS (
    SELECT target.competition_id, spec.market_family, spec.line_value
    FROM target_competitions AS target CROSS JOIN market_specs AS spec
  ), quote_matches AS (
    SELECT DISTINCT
      due.id AS match_id,
      due.competition_id,
      definition.canonical_family,
      CASE WHEN definition.canonical_family = 'handicap' THEN abs(quote.line_value)
           ELSE quote.line_value END AS line_value,
      quote.bookmaker_id
    FROM classified_matches AS due
    JOIN public.sports_odds_current AS quote
      ON quote.match_id = due.id
     AND quote.quote_status = 'open'
     AND NOT quote.is_live
    JOIN public.sports_market_definitions AS definition
      ON definition.id = quote.market_definition_id
     AND definition.is_active
  ), assessed AS (
    SELECT
      grid.competition_id,
      grid.market_family,
      grid.line_value,
      count(DISTINCT due.id)::integer AS matches_due,
      count(DISTINCT due.id) FILTER (WHERE due.is_provider_empty)::integer
        AS matches_provider_empty,
      count(DISTINCT quote_matches.match_id)::integer AS matches_available,
      count(DISTINCT quote_matches.bookmaker_id)::integer AS bookmaker_count
    FROM grid
    LEFT JOIN classified_matches AS due
      ON due.competition_id = grid.competition_id
    LEFT JOIN quote_matches
      ON quote_matches.match_id = due.id
     AND quote_matches.canonical_family = grid.market_family
     AND quote_matches.line_value IS NOT DISTINCT FROM grid.line_value
    GROUP BY grid.competition_id, grid.market_family, grid.line_value
  ), upserted AS (
    INSERT INTO public.hl_football_market_coverage_daily (
      observed_on,
      competition_id,
      market_family,
      line_value,
      matches_due,
      matches_available,
      matches_provider_empty,
      bookmaker_count,
      refreshed_at
    )
    SELECT
      p_observed_on,
      competition_id,
      market_family,
      line_value,
      matches_due,
      matches_available,
      matches_provider_empty,
      bookmaker_count,
      statement_timestamp()
    FROM assessed
    ON CONFLICT (observed_on, competition_id, market_family, line_key) DO UPDATE SET
      matches_due = EXCLUDED.matches_due,
      matches_available = EXCLUDED.matches_available,
      matches_provider_empty = EXCLUDED.matches_provider_empty,
      bookmaker_count = EXCLUDED.bookmaker_count,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING 1
  )
  SELECT count(*)::integer INTO affected FROM upserted;

  RETURN affected;
END $function$;

CREATE OR REPLACE FUNCTION public.get_highlightly_football_market_coverage_report(
  p_days integer DEFAULT 14,
  p_coverage_sla numeric DEFAULT 90
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF p_days < 1 OR p_days > 30 OR p_coverage_sla < 0 OR p_coverage_sla > 100 THEN
    RAISE EXCEPTION 'invalid market coverage parameters' USING ERRCODE = '22023';
  END IF;

  WITH summarized AS (
    SELECT
      daily.competition_id,
      country.name AS country_name,
      competition.name AS competition_name,
      daily.market_family,
      daily.line_value,
      count(DISTINCT daily.observed_on)::integer AS observed_days,
      sum(daily.matches_due)::integer AS matches_due,
      sum(daily.matches_available)::integer AS matches_available,
      sum(daily.matches_provider_empty)::integer AS matches_provider_empty,
      max(daily.bookmaker_count)::integer AS bookmaker_count,
      max(daily.refreshed_at) AS refreshed_at
    FROM public.hl_football_market_coverage_daily AS daily
    JOIN public.sports_competitions AS competition
      ON competition.id = daily.competition_id
    LEFT JOIN public.sports_countries AS country
      ON country.id = competition.country_id
    WHERE daily.observed_on >= current_date - (p_days - 1)
    GROUP BY
      daily.competition_id,
      country.name,
      competition.name,
      daily.market_family,
      daily.line_value
  ), scored AS (
    SELECT
      summarized.*,
      matches_due - matches_provider_empty AS eligible_matches_due,
      round(100.0 * matches_available / NULLIF(matches_due, 0), 2)
        AS raw_coverage_pct,
      round(
        100.0 * matches_available
          / NULLIF(matches_due - matches_provider_empty, 0),
        2
      ) AS eligible_coverage_pct,
      -- coverage_pct remains the compatibility field and now follows eligibility.
      round(
        100.0 * matches_available
          / NULLIF(matches_due - matches_provider_empty, 0),
        2
      ) AS coverage_pct,
      CASE
        WHEN observed_days < p_days THEN 'collecting'
        WHEN matches_due = 0 THEN 'no_fixtures'
        WHEN matches_due - matches_provider_empty = 0 THEN 'provider_unavailable'
        WHEN matches_available = 0 THEN 'unavailable'
        WHEN 100.0 * matches_available
          / NULLIF(matches_due - matches_provider_empty, 0) < p_coverage_sla
          THEN 'below_sla'
        ELSE 'ready'
      END AS status
    FROM summarized
  )
  SELECT jsonb_build_object(
    'generated_at', statement_timestamp(),
    'required_days', p_days,
    'coverage_sla', p_coverage_sla,
    'coverage_basis', 'eligible_matches_due',
    'automatic_exclusions', false,
    'note', 'Raw and eligible coverage are both retained. Only explicitly provider-empty matches leave the eligible denominator; an absent market remains an eligible miss and never invalidates the league or match.',
    'markets', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(scored)
          ORDER BY country_name, competition_name, market_family,
            line_value NULLS FIRST
        )
        FROM scored
      ),
      '[]'::jsonb
    )
  ) INTO result;

  RETURN result;
END $function$;

REVOKE ALL ON FUNCTION public.refresh_highlightly_football_market_coverage(
  date,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_highlightly_football_market_coverage(
  date,
  timestamptz,
  timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.get_highlightly_football_market_coverage_report(
  integer,
  numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_football_market_coverage_report(
  integer,
  numeric
) TO service_role;

COMMENT ON FUNCTION public.refresh_highlightly_football_market_coverage(
  date,
  timestamptz,
  timestamptz
) IS 'Refreshes football market coverage with raw and provider-empty-adjusted eligible denominators.';
COMMENT ON FUNCTION public.get_highlightly_football_market_coverage_report(
  integer,
  numeric
) IS 'Reports raw and eligible football market coverage; certification uses eligible coverage.';

NOTIFY pgrst, 'reload schema';
