-- Reconcile the football canary with its approved competition scope and add
-- a persisted daily market rollup. This migration makes no provider calls.

CREATE TABLE public.hl_football_market_coverage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_on date NOT NULL,
  competition_id uuid NOT NULL REFERENCES public.sports_competitions(id) ON DELETE CASCADE,
  market_family text NOT NULL,
  line_value numeric,
  matches_due integer NOT NULL DEFAULT 0 CHECK (matches_due >= 0),
  matches_available integer NOT NULL DEFAULT 0 CHECK (matches_available >= 0),
  bookmaker_count integer NOT NULL DEFAULT 0 CHECK (bookmaker_count >= 0),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  line_key text GENERATED ALWAYS AS (COALESCE(line_value::text, '')) STORED,
  availability_pct numeric(7, 2) GENERATED ALWAYS AS (
    round(100.0 * matches_available / NULLIF(matches_due, 0), 2)
  ) STORED,
  UNIQUE (observed_on, competition_id, market_family, line_key),
  CHECK (matches_available <= matches_due),
  CHECK (market_family IN ('moneyline', 'total', 'both_teams_to_score', 'double_chance', 'handicap')),
  CHECK (
    (market_family IN ('moneyline', 'both_teams_to_score', 'double_chance') AND line_value IS NULL)
    OR (market_family = 'total' AND line_value IN (1.5, 2.5, 3.5, 4.5, 5.5))
    OR (market_family = 'handicap' AND line_value IN (0.5, 1.5, 2.5, 3.5, 4.5, 5.5))
  )
);

CREATE INDEX idx_hl_football_market_coverage_daily_report
  ON public.hl_football_market_coverage_daily
  (observed_on DESC, competition_id, market_family, line_value);
ALTER TABLE public.hl_football_market_coverage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hl_football_market_coverage_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.hl_football_market_coverage_daily TO service_role;
CREATE TRIGGER trg_hl_football_market_coverage_daily_touch_updated_at
  BEFORE UPDATE ON public.hl_football_market_coverage_daily
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE FUNCTION public.refresh_highlightly_football_market_coverage(
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
  ), due_matches AS MATERIALIZED (
    SELECT match_row.id, match_row.competition_id
    FROM public.sports_matches match_row
    JOIN target_competitions target ON target.competition_id = match_row.competition_id
    JOIN public.sports sport ON sport.id = match_row.sport_id
    WHERE sport.code = 'football' AND match_row.status = 'scheduled'
      AND match_row.kickoff_at >= p_from AND match_row.kickoff_at < p_to
  ), grid AS (
    SELECT target.competition_id, spec.market_family, spec.line_value
    FROM target_competitions target CROSS JOIN market_specs spec
  ), quote_matches AS (
    SELECT DISTINCT
      due.id AS match_id, due.competition_id, definition.canonical_family,
      CASE WHEN definition.canonical_family = 'handicap' THEN abs(quote.line_value)
           ELSE quote.line_value END AS line_value,
      quote.bookmaker_id
    FROM due_matches due
    JOIN public.sports_odds_current quote ON quote.match_id = due.id
      AND quote.quote_status = 'open' AND NOT quote.is_live
    JOIN public.sports_market_definitions definition
      ON definition.id = quote.market_definition_id AND definition.is_active
  ), assessed AS (
    SELECT grid.competition_id, grid.market_family, grid.line_value,
      count(DISTINCT due.id)::integer AS matches_due,
      count(DISTINCT quote_matches.match_id)::integer AS matches_available,
      count(DISTINCT quote_matches.bookmaker_id)::integer AS bookmaker_count
    FROM grid
    LEFT JOIN due_matches due ON due.competition_id = grid.competition_id
    LEFT JOIN quote_matches ON quote_matches.match_id = due.id
      AND quote_matches.canonical_family = grid.market_family
      AND quote_matches.line_value IS NOT DISTINCT FROM grid.line_value
    GROUP BY grid.competition_id, grid.market_family, grid.line_value
  ), upserted AS (
    INSERT INTO public.hl_football_market_coverage_daily
      (observed_on, competition_id, market_family, line_value,
       matches_due, matches_available, bookmaker_count, refreshed_at)
    SELECT p_observed_on, competition_id, market_family, line_value,
      matches_due, matches_available, bookmaker_count, statement_timestamp()
    FROM assessed
    ON CONFLICT (observed_on, competition_id, market_family, line_key) DO UPDATE SET
      matches_due = EXCLUDED.matches_due,
      matches_available = EXCLUDED.matches_available,
      bookmaker_count = EXCLUDED.bookmaker_count,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING 1
  ) SELECT count(*)::integer INTO affected FROM upserted;
  RETURN affected;
END $function$;

REVOKE ALL ON FUNCTION public.refresh_highlightly_football_market_coverage(date, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_highlightly_football_market_coverage(date, timestamptz, timestamptz)
  TO service_role;

CREATE FUNCTION public.get_highlightly_football_market_coverage_report(
  p_days integer DEFAULT 14, p_coverage_sla numeric DEFAULT 90
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF p_days < 1 OR p_days > 30 OR p_coverage_sla < 0 OR p_coverage_sla > 100 THEN
    RAISE EXCEPTION 'invalid market coverage parameters' USING ERRCODE = '22023';
  END IF;
  WITH summarized AS (
    SELECT daily.competition_id, country.name AS country_name,
      competition.name AS competition_name, daily.market_family, daily.line_value,
      count(DISTINCT daily.observed_on)::integer AS observed_days,
      sum(daily.matches_due)::integer AS matches_due,
      sum(daily.matches_available)::integer AS matches_available,
      max(daily.bookmaker_count)::integer AS bookmaker_count,
      max(daily.refreshed_at) AS refreshed_at
    FROM public.hl_football_market_coverage_daily daily
    JOIN public.sports_competitions competition ON competition.id = daily.competition_id
    LEFT JOIN public.sports_countries country ON country.id = competition.country_id
    WHERE daily.observed_on >= current_date - (p_days - 1)
    GROUP BY daily.competition_id, country.name, competition.name,
      daily.market_family, daily.line_value
  ), scored AS (
    SELECT summarized.*,
      round(100.0 * matches_available / NULLIF(matches_due, 0), 2) AS coverage_pct,
      CASE WHEN observed_days < p_days THEN 'collecting'
           WHEN matches_due = 0 THEN 'no_fixtures'
           WHEN matches_available = 0 THEN 'unavailable'
           WHEN 100.0 * matches_available / NULLIF(matches_due, 0) < p_coverage_sla THEN 'below_sla'
           ELSE 'ready' END AS status
    FROM summarized
  ) SELECT jsonb_build_object(
      'generated_at', statement_timestamp(), 'required_days', p_days,
      'coverage_sla', p_coverage_sla, 'automatic_exclusions', false,
      'note', 'Each league and market is certified independently; an absent market does not invalidate a league or match.',
      'markets', COALESCE((SELECT jsonb_agg(to_jsonb(scored)
        ORDER BY country_name, competition_name, market_family, line_value NULLS FIRST) FROM scored), '[]'::jsonb)
    ) INTO result;
  RETURN result;
END $function$;

REVOKE ALL ON FUNCTION public.get_highlightly_football_market_coverage_report(integer, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_football_market_coverage_report(integer, numeric)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_football_canary_gate_v1(
  p_days integer DEFAULT 14,
  p_match_coverage_sla numeric DEFAULT 95,
  p_odds_coverage_sla numeric DEFAULT 90,
  p_freshness_sla_seconds integer DEFAULT 3600,
  p_min_league_matches integer DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF p_days < 1 OR p_days > 30 OR p_match_coverage_sla < 0 OR p_match_coverage_sla > 100
     OR p_odds_coverage_sla < 0 OR p_odds_coverage_sla > 100
     OR p_freshness_sla_seconds < 1 OR p_min_league_matches < 1 THEN
    RAISE EXCEPTION 'invalid canary gate parameters' USING ERRCODE = '22023';
  END IF;
  WITH target_competitions(competition_id) AS (VALUES
    ('9247cd02-df38-519b-8791-512a016a9a38'::uuid),
    ('1839d176-a7b8-5f92-adaa-40475560a5d8'::uuid),
    ('1eaaa858-ec27-5162-ac9e-3f63a529a294'::uuid)
  ), latest_daily_health AS (
    SELECT DISTINCT ON (observation.observed_on) observation.observed_on,
      observation.jobs_dead, observation.open_critical_issues
    FROM public.hl_shadow_observations observation
    JOIN public.hl_shadow_windows window_row ON window_row.id = observation.window_id
    WHERE observation.sport = 'football'
      AND COALESCE(window_row.config ->> 'window_kind', 'future') = 'future'
      AND observation.observed_on >= current_date - (p_days - 1)
    ORDER BY observation.observed_on, observation.updated_at DESC
  ), health AS (
    SELECT count(*)::integer AS observed_days,
      COALESCE(sum(jobs_dead), 0)::integer AS dead_jobs,
      COALESCE(sum(open_critical_issues), 0)::integer AS open_critical_issues
    FROM latest_daily_health
  ), league_coverage AS (
    SELECT daily.competition_id, country.name AS country_name,
      competition.name AS competition_name,
      count(DISTINCT daily.observed_on)::integer AS observed_days,
      sum(daily.matches_due)::integer AS matches_due,
      sum(daily.matches_available)::integer AS matches_available,
      sum(daily.matches_provider_empty)::integer AS matches_provider_empty,
      sum(daily.matches_other_unavailable)::integer AS matches_other_unavailable,
      max(daily.refreshed_at) AS refreshed_at
    FROM public.hl_odds_league_coverage_daily daily
    JOIN target_competitions target ON target.competition_id = daily.competition_id
    JOIN public.sports_competitions competition ON competition.id = daily.competition_id
    LEFT JOIN public.sports_countries country ON country.id = daily.country_id
    WHERE daily.observed_on >= current_date - (p_days - 1)
    GROUP BY daily.competition_id, country.name, competition.name
  ), league_scored AS (
    SELECT league_coverage.*,
      round(100.0 * matches_available / NULLIF(matches_due, 0), 2) AS raw_availability_pct,
      round(100.0 * matches_available / NULLIF(matches_due - matches_provider_empty, 0), 2)
        AS eligible_availability_pct,
      CASE WHEN observed_days < p_days OR matches_due < p_min_league_matches THEN 'collecting'
           WHEN matches_due - matches_provider_empty = 0 THEN 'provider_unavailable'
           WHEN 100.0 * matches_available / NULLIF(matches_due - matches_provider_empty, 0)
             < p_odds_coverage_sla THEN 'below_sla'
           ELSE 'ready' END AS gate_status
    FROM league_coverage
  ), totals AS (
    SELECT COALESCE(sum(matches_due), 0)::integer AS matches_due,
      COALESCE(sum(matches_available), 0)::integer AS matches_available,
      COALESCE(sum(matches_provider_empty), 0)::integer AS matches_provider_empty,
      COALESCE(sum(matches_other_unavailable), 0)::integer AS matches_other_unavailable,
      round(100.0 * sum(matches_available) / NULLIF(sum(matches_due), 0), 2) AS raw_odds_coverage_pct,
      round(100.0 * sum(matches_available) /
        NULLIF(sum(matches_due) - sum(matches_provider_empty), 0), 2) AS eligible_odds_coverage_pct,
      extract(epoch FROM statement_timestamp() - max(refreshed_at))::integer AS freshness_seconds
    FROM league_coverage
  ), market_state AS (
    SELECT count(DISTINCT observed_on)::integer AS observed_days
    FROM public.hl_football_market_coverage_daily
    WHERE observed_on >= current_date - (p_days - 1)
  ) SELECT jsonb_build_object(
    'generated_at', statement_timestamp(), 'sport', 'football', 'window_kind', 'future',
    'scope', 'premier_league_la_liga_j1_league', 'required_days', p_days,
    'observed_days', health.observed_days,
    'remaining_days', greatest(p_days - health.observed_days, 0),
    'matches_expected', totals.matches_due, 'matches_seen', totals.matches_due,
    'matches_with_odds', totals.matches_available,
    'matches_provider_empty', totals.matches_provider_empty,
    'matches_other_unavailable', totals.matches_other_unavailable,
    'matches_expected_source', 'canonical_due_schedule',
    'discovery_gate_status', 'not_independently_measurable', 'match_coverage_pct', NULL,
    'odds_coverage_pct', totals.eligible_odds_coverage_pct,
    'raw_odds_coverage_pct', totals.raw_odds_coverage_pct,
    'freshness_p95_seconds', totals.freshness_seconds,
    'freshness_metric', 'age_of_latest_target_league_rollup',
    'dead_jobs', health.dead_jobs, 'open_critical_issues', health.open_critical_issues,
    'gate_status', CASE
      WHEN health.dead_jobs > 0 OR health.open_critical_issues > 0 THEN 'blocked'
      WHEN health.observed_days < p_days OR totals.matches_due = 0 THEN 'collecting'
      WHEN totals.eligible_odds_coverage_pct < p_odds_coverage_sla
        OR totals.freshness_seconds > p_freshness_sla_seconds THEN 'below_sla'
      ELSE 'ready' END,
    'thresholds', jsonb_build_object('odds_coverage_pct', p_odds_coverage_sla,
      'freshness_seconds', p_freshness_sla_seconds, 'minimum_league_matches', p_min_league_matches),
    'league_gate_status', CASE
      WHEN NOT EXISTS (SELECT 1 FROM league_scored) THEN 'collecting'
      WHEN EXISTS (SELECT 1 FROM league_scored WHERE gate_status = 'below_sla') THEN 'below_sla'
      WHEN EXISTS (SELECT 1 FROM league_scored WHERE gate_status = 'collecting') THEN 'collecting'
      ELSE 'ready' END,
    'leagues', COALESCE((SELECT jsonb_agg(to_jsonb(league_scored)
      ORDER BY country_name, competition_name) FROM league_scored), '[]'::jsonb),
    'market_gate_status', CASE WHEN market_state.observed_days < p_days
      THEN 'collecting' ELSE 'reported_independently' END,
    'market_observed_days', market_state.observed_days,
    'market_gate_note', 'Markets are reported per league and line; absence never invalidates the league or match.'
  ) INTO result FROM health CROSS JOIN totals CROSS JOIN market_state;
  RETURN result;
END $function$;

REVOKE ALL ON FUNCTION public.get_highlightly_football_canary_gate_v1(integer, numeric, numeric, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_football_canary_gate_v1(integer, numeric, numeric, integer, integer)
  TO service_role;

COMMENT ON TABLE public.hl_football_market_coverage_daily IS
  'Daily non-blocking football market coverage for Premier League, La Liga and J1 League.';
COMMENT ON FUNCTION public.get_highlightly_football_canary_gate_v1(integer, numeric, numeric, integer, integer)
  IS 'Football-only 14-day canary scoped to Premier League, La Liga and J1 League.';
NOTIFY pgrst, 'reload schema';
