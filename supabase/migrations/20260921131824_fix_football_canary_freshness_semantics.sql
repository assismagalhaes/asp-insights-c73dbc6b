-- Separate monitor heartbeat freshness from actionable odds freshness.
-- When no target fixture is due in the next 24 hours, odds freshness is
-- explicitly not applicable instead of ageing an old league rollup forever.

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
        NULLIF(sum(matches_due) - sum(matches_provider_empty), 0), 2) AS eligible_odds_coverage_pct
    FROM league_coverage
  ), market_state AS (
    SELECT count(DISTINCT observed_on)::integer AS observed_days
    FROM public.hl_football_market_coverage_daily
    WHERE observed_on >= current_date - (p_days - 1)
  ), monitor_state AS (
    SELECT max(daily.refreshed_at) AS refreshed_at,
      extract(epoch FROM statement_timestamp() - max(daily.refreshed_at))::integer
        AS freshness_seconds
    FROM public.hl_football_market_coverage_daily daily
    JOIN target_competitions target ON target.competition_id = daily.competition_id
    WHERE daily.observed_on = current_date
  ), due_matches AS MATERIALIZED (
    SELECT match_row.id
    FROM public.sports_matches match_row
    JOIN target_competitions target ON target.competition_id = match_row.competition_id
    JOIN public.sports sport ON sport.id = match_row.sport_id AND sport.code = 'football'
    WHERE match_row.status = 'scheduled'
      AND match_row.kickoff_at >= statement_timestamp()
      AND match_row.kickoff_at < statement_timestamp() + interval '24 hours'
  ), due_quote_state AS (
    SELECT due.id AS match_id, max(quote.last_seen_at) AS last_seen_at
    FROM due_matches due
    LEFT JOIN public.sports_odds_current quote ON quote.match_id = due.id
      AND quote.quote_status = 'open' AND NOT quote.is_live
    GROUP BY due.id
  ), actionable_state AS (
    SELECT count(*)::integer AS matches_due_next_24h,
      count(last_seen_at)::integer AS matches_with_current_odds,
      (percentile_disc(0.95) WITHIN GROUP (
        ORDER BY extract(epoch FROM statement_timestamp() - last_seen_at)::integer
      ) FILTER (WHERE last_seen_at IS NOT NULL))::integer AS odds_freshness_p95_seconds
    FROM due_quote_state
  ), freshness AS (
    SELECT monitor_state.refreshed_at AS monitor_refreshed_at,
      monitor_state.freshness_seconds AS monitor_freshness_seconds,
      actionable_state.matches_due_next_24h,
      actionable_state.matches_with_current_odds,
      actionable_state.odds_freshness_p95_seconds,
      CASE
        WHEN monitor_state.freshness_seconds IS NULL THEN 'monitor_missing'
        WHEN monitor_state.freshness_seconds > p_freshness_sla_seconds THEN 'monitor_stale'
        WHEN actionable_state.matches_due_next_24h = 0 THEN 'not_applicable_no_due_matches'
        WHEN actionable_state.matches_with_current_odds < actionable_state.matches_due_next_24h
          THEN 'odds_missing'
        WHEN actionable_state.odds_freshness_p95_seconds > p_freshness_sla_seconds
          THEN 'odds_stale'
        ELSE 'ready'
      END AS status
    FROM monitor_state CROSS JOIN actionable_state
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
    'freshness_p95_seconds', CASE
      WHEN freshness.matches_due_next_24h = 0 THEN freshness.monitor_freshness_seconds
      ELSE greatest(freshness.monitor_freshness_seconds, freshness.odds_freshness_p95_seconds)
    END,
    'freshness_metric', 'monitor_heartbeat_and_due_match_odds_p95',
    'freshness_status', freshness.status,
    'monitor_refreshed_at', freshness.monitor_refreshed_at,
    'monitor_freshness_seconds', freshness.monitor_freshness_seconds,
    'matches_due_next_24h', freshness.matches_due_next_24h,
    'matches_with_current_odds', freshness.matches_with_current_odds,
    'odds_freshness_p95_seconds', freshness.odds_freshness_p95_seconds,
    'dead_jobs', health.dead_jobs, 'open_critical_issues', health.open_critical_issues,
    'gate_status', CASE
      WHEN health.dead_jobs > 0 OR health.open_critical_issues > 0 THEN 'blocked'
      WHEN health.observed_days < p_days OR totals.matches_due = 0 THEN 'collecting'
      WHEN totals.eligible_odds_coverage_pct < p_odds_coverage_sla
        OR freshness.status NOT IN ('ready', 'not_applicable_no_due_matches') THEN 'below_sla'
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
  ) INTO result FROM health CROSS JOIN totals CROSS JOIN market_state CROSS JOIN freshness;
  RETURN result;
END $function$;

REVOKE ALL ON FUNCTION public.get_highlightly_football_canary_gate_v1(
  integer, numeric, numeric, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_football_canary_gate_v1(
  integer, numeric, numeric, integer, integer
) TO service_role;

COMMENT ON FUNCTION public.get_highlightly_football_canary_gate_v1(
  integer, numeric, numeric, integer, integer
) IS 'Football canary gate with separate monitor-heartbeat and due-match odds freshness; no due fixtures makes odds freshness explicitly not applicable.';

NOTIFY pgrst, 'reload schema';
