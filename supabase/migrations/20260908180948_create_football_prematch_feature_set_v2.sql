-- Phase 3: register the football MVP feature contract without enabling it.
-- This migration does not materialize snapshots, train models, or call providers.

INSERT INTO public.hl_feature_sets (
  sport_id,
  code,
  version,
  status,
  is_enabled,
  cutoff_policy,
  feature_spec
)
SELECT
  sport.id,
  'highlightly_football_prematch',
  '2.0.0',
  'draft',
  false,
  'Every source timestamp must be <= cutoff_at and cutoff_at must be < kickoff_at.',
  jsonb_build_object(
    'schema', 'highlightly_football_prematch@2.0.0',
    'input_contract', 'football_model_input@1.0.0',
    'quality_contract', 'football_input_quality@1.0.0',
    'horizons', jsonb_build_array('t24h', 't6h', 't60m'),
    'scope', jsonb_build_object(
      'sport', 'football',
      'provider', 'highlightly',
      'competition_external_ids', jsonb_build_array('33973', '119924', '84182')
    ),
    'team_components', jsonb_build_array(
      'current_season',
      'previous_season',
      'recent_overall_5',
      'recent_venue_5',
      'standings',
      'season_metrics'
    ),
    'match_components', jsonb_build_array(
      'identity',
      'h2h_prior',
      'league_prior',
      'prematch_odds_by_bookmaker',
      'prematch_odds_consensus'
    ),
    'market_scope', jsonb_build_object(
      'families', jsonb_build_array(
        'full_time_result',
        'total_goals',
        'both_teams_to_score',
        'double_chance',
        'asian_handicap'
      ),
      'total_lines', jsonb_build_array(1.5, 2.5, 3.5, 4.5, 5.5),
      'asian_handicap_half_lines_only', true,
      'asian_handicap_min', -5.5,
      'asian_handicap_max', 5.5,
      'missing_market_blocks_match', false,
      'synthetic_double_chance_price', false
    ),
    'history_policy', jsonb_build_object(
      'minimum_prior_matches_per_team', 5,
      'recent_windows_include_match_ids', true,
      'h2h_competition_agnostic', true,
      'previous_season_degradable', true
    ),
    'lineage_policy', jsonb_build_object(
      'component_source_max_at_required', true,
      'global_source_max_at_required', true,
      'target_match_forbidden', true,
      'canonical_order_before_fingerprint', true
    ),
    'odds_as_of_policy', jsonb_build_object(
      'history_timestamp', 'sports_odds_history.captured_at',
      'current_fallback_timestamp', 'sports_odds_current.updated_at',
      'consensus_timestamp', 'sports_odds_consensus.snapshot_at',
      'live_forbidden', true,
      'bookmaker_quotes_preserved', true
    ),
    'automatic_training', false,
    'automatic_predictions', false,
    'provider_calls', false
  )
FROM public.sports AS sport
WHERE sport.code = 'football'
ON CONFLICT (sport_id, code, version) DO UPDATE SET
  cutoff_policy = EXCLUDED.cutoff_policy,
  feature_spec = EXCLUDED.feature_spec,
  status = 'draft',
  is_enabled = false,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.resolve_previous_competition_season_v1(
  p_competition_id uuid,
  p_current_season_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH current_season AS (
    SELECT season.id, season.competition_id, season.start_date, season.end_date
    FROM public.sports_seasons AS season
    WHERE season.id = p_current_season_id
      AND season.competition_id = p_competition_id
  )
  SELECT candidate.id
  FROM current_season
  JOIN public.sports_seasons AS candidate
    ON candidate.competition_id = current_season.competition_id
   AND candidate.id <> current_season.id
  WHERE current_season.start_date IS NOT NULL
    AND COALESCE(candidate.end_date, candidate.start_date)
      < current_season.start_date
  ORDER BY
    COALESCE(candidate.end_date, candidate.start_date) DESC NULLS LAST,
    candidate.id
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.resolve_previous_competition_season_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_previous_competition_season_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.resolve_previous_competition_season_v1(uuid, uuid) IS
  'Returns the immediately preceding season of the same competition by canonical IDs and dates; returns null when dates or a predecessor are unavailable.';

CREATE OR REPLACE FUNCTION public.build_football_match_window_v2(
  p_team_id uuid,
  p_cutoff_at timestamptz,
  p_limit integer DEFAULT 5,
  p_season_id uuid DEFAULT NULL,
  p_venue_role text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH eligible AS (
    SELECT
      match_row.id AS match_id,
      match_row.competition_id,
      match_row.season_id,
      match_row.kickoff_at,
      participant.role,
      opponent.team_id AS opponent_team_id,
      CASE
        WHEN participant.role = 'home' THEN score_parts.parts[1]::integer
        ELSE score_parts.parts[2]::integer
      END AS goals_for,
      CASE
        WHEN participant.role = 'home' THEN score_parts.parts[2]::integer
        ELSE score_parts.parts[1]::integer
      END AS goals_against,
      match_row.updated_at AS source_max_at
    FROM public.sports_match_participants AS participant
    JOIN public.sports_matches AS match_row
      ON match_row.id = participant.match_id
    JOIN public.sports_match_participants AS opponent
      ON opponent.match_id = match_row.id
     AND opponent.team_id <> participant.team_id
    CROSS JOIN LATERAL (
      SELECT regexp_match(
        COALESCE(match_row.score_data ->> 'current', ''),
        '^[[:space:]]*([0-9]+)[[:space:]]*-[[:space:]]*([0-9]+)[[:space:]]*$'
      ) AS parts
    ) AS score_parts
    WHERE participant.team_id = p_team_id
      AND match_row.status = 'finished'
      AND match_row.kickoff_at < p_cutoff_at
      AND match_row.ended_at IS NOT NULL
      AND match_row.ended_at <= p_cutoff_at
      AND match_row.updated_at <= p_cutoff_at
      AND score_parts.parts IS NOT NULL
      AND (p_season_id IS NULL OR match_row.season_id = p_season_id)
      AND (p_venue_role IS NULL OR participant.role = p_venue_role)
    ORDER BY match_row.kickoff_at DESC, match_row.id
    LIMIT greatest(1, least(COALESCE(p_limit, 5), 500))
  ),
  ordered AS (
    SELECT * FROM eligible ORDER BY kickoff_at DESC, match_id
  )
  SELECT jsonb_build_object(
    'team_id', p_team_id,
    'season_id', p_season_id,
    'venue_role', p_venue_role,
    'match_ids', COALESCE(
      (SELECT jsonb_agg(match_id ORDER BY kickoff_at DESC, match_id) FROM ordered),
      '[]'::jsonb
    ),
    'matches', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'match_id', match_id,
            'competition_id', competition_id,
            'season_id', season_id,
            'kickoff_at', kickoff_at,
            'role', role,
            'opponent_team_id', opponent_team_id,
            'goals_for', goals_for,
            'goals_against', goals_against
          )
          ORDER BY kickoff_at DESC, match_id
        )
        FROM ordered
      ),
      '[]'::jsonb
    ),
    'sample', (SELECT count(*) FROM ordered),
    'first_match_at', (SELECT min(kickoff_at) FROM ordered),
    'last_match_at', (SELECT max(kickoff_at) FROM ordered),
    'goals_for', jsonb_build_object(
      'sum', COALESCE((SELECT sum(goals_for) FROM ordered), 0),
      'mean', (SELECT round(avg(goals_for), 4) FROM ordered),
      'variance', (SELECT round(var_samp(goals_for), 4) FROM ordered)
    ),
    'goals_against', jsonb_build_object(
      'sum', COALESCE((SELECT sum(goals_against) FROM ordered), 0),
      'mean', (SELECT round(avg(goals_against), 4) FROM ordered),
      'variance', (SELECT round(var_samp(goals_against), 4) FROM ordered)
    ),
    'wins', (SELECT count(*) FROM ordered WHERE goals_for > goals_against),
    'draws', (SELECT count(*) FROM ordered WHERE goals_for = goals_against),
    'losses', (SELECT count(*) FROM ordered WHERE goals_for < goals_against),
    'btts_yes', (SELECT count(*) FROM ordered WHERE goals_for > 0 AND goals_against > 0),
    'totals', jsonb_build_object(
      '1.5', jsonb_build_object('over', (SELECT count(*) FROM ordered WHERE goals_for + goals_against > 1.5), 'under', (SELECT count(*) FROM ordered WHERE goals_for + goals_against < 1.5)),
      '2.5', jsonb_build_object('over', (SELECT count(*) FROM ordered WHERE goals_for + goals_against > 2.5), 'under', (SELECT count(*) FROM ordered WHERE goals_for + goals_against < 2.5)),
      '3.5', jsonb_build_object('over', (SELECT count(*) FROM ordered WHERE goals_for + goals_against > 3.5), 'under', (SELECT count(*) FROM ordered WHERE goals_for + goals_against < 3.5)),
      '4.5', jsonb_build_object('over', (SELECT count(*) FROM ordered WHERE goals_for + goals_against > 4.5), 'under', (SELECT count(*) FROM ordered WHERE goals_for + goals_against < 4.5)),
      '5.5', jsonb_build_object('over', (SELECT count(*) FROM ordered WHERE goals_for + goals_against > 5.5), 'under', (SELECT count(*) FROM ordered WHERE goals_for + goals_against < 5.5))
    ),
    'source_max_at', (SELECT max(source_max_at) FROM ordered)
  )
$function$;

REVOKE ALL ON FUNCTION public.build_football_match_window_v2(
  uuid, timestamptz, integer, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_football_match_window_v2(
  uuid, timestamptz, integer, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.build_football_h2h_window_v2(
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_target_match_id uuid,
  p_cutoff_at timestamptz,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH eligible AS (
    SELECT
      match_row.id AS match_id,
      match_row.competition_id,
      match_row.season_id,
      match_row.kickoff_at,
      home.team_id AS historical_home_team_id,
      away.team_id AS historical_away_team_id,
      score_parts.parts[1]::integer AS home_goals,
      score_parts.parts[2]::integer AS away_goals,
      match_row.updated_at AS source_max_at
    FROM public.sports_matches AS match_row
    JOIN public.sports_match_participants AS home
      ON home.match_id = match_row.id AND home.role = 'home'
    JOIN public.sports_match_participants AS away
      ON away.match_id = match_row.id AND away.role = 'away'
    CROSS JOIN LATERAL (
      SELECT regexp_match(
        COALESCE(match_row.score_data ->> 'current', ''),
        '^[[:space:]]*([0-9]+)[[:space:]]*-[[:space:]]*([0-9]+)[[:space:]]*$'
      ) AS parts
    ) AS score_parts
    WHERE match_row.id <> p_target_match_id
      AND match_row.status = 'finished'
      AND match_row.kickoff_at < p_cutoff_at
      AND match_row.ended_at IS NOT NULL
      AND match_row.ended_at <= p_cutoff_at
      AND match_row.updated_at <= p_cutoff_at
      AND score_parts.parts IS NOT NULL
      AND (
        (home.team_id = p_home_team_id AND away.team_id = p_away_team_id)
        OR (home.team_id = p_away_team_id AND away.team_id = p_home_team_id)
      )
    ORDER BY match_row.kickoff_at DESC, match_row.id
    LIMIT greatest(1, least(COALESCE(p_limit, 20), 100))
  )
  SELECT jsonb_build_object(
    'home_team_id', p_home_team_id,
    'away_team_id', p_away_team_id,
    'match_ids', COALESCE(
      (SELECT jsonb_agg(match_id ORDER BY kickoff_at DESC, match_id) FROM eligible),
      '[]'::jsonb
    ),
    'matches', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'match_id', match_id,
            'competition_id', competition_id,
            'season_id', season_id,
            'kickoff_at', kickoff_at,
            'historical_home_team_id', historical_home_team_id,
            'historical_away_team_id', historical_away_team_id,
            'home_goals', home_goals,
            'away_goals', away_goals
          ) ORDER BY kickoff_at DESC, match_id
        ) FROM eligible
      ), '[]'::jsonb
    ),
    'sample', (SELECT count(*) FROM eligible),
    'source_max_at', (SELECT max(source_max_at) FROM eligible)
  )
$function$;

REVOKE ALL ON FUNCTION public.build_football_h2h_window_v2(
  uuid, uuid, uuid, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_football_h2h_window_v2(
  uuid, uuid, uuid, timestamptz, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.build_football_odds_asof_v2(
  p_match_id uuid,
  p_cutoff_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH observations AS (
    SELECT
      history.match_id,
      history.bookmaker_id,
      history.market_definition_id,
      history.selection_key,
      history.selection_name,
      history.line_key,
      history.line_value,
      history.decimal_odds,
      history.quote_status,
      history.is_live,
      history.captured_at AS observed_at,
      history.source_raw_object_id
    FROM public.sports_odds_history AS history
    WHERE history.match_id = p_match_id
      AND NOT history.is_live
      AND history.captured_at <= p_cutoff_at
    UNION ALL
    SELECT
      current_quote.match_id,
      current_quote.bookmaker_id,
      current_quote.market_definition_id,
      current_quote.selection_key,
      current_quote.selection_name,
      current_quote.line_key,
      current_quote.line_value,
      current_quote.decimal_odds,
      current_quote.quote_status,
      current_quote.is_live,
      current_quote.updated_at AS observed_at,
      current_quote.source_raw_object_id
    FROM public.sports_odds_current AS current_quote
    WHERE current_quote.match_id = p_match_id
      AND NOT current_quote.is_live
      AND current_quote.updated_at <= p_cutoff_at
  ),
  latest_by_bookmaker AS (
    SELECT DISTINCT ON (
      observation.bookmaker_id,
      observation.market_definition_id,
      observation.selection_key,
      observation.line_key
    )
      observation.*,
      market.canonical_family,
      bookmaker.normalized_name AS bookmaker_key
    FROM observations AS observation
    JOIN public.sports_market_definitions AS market
      ON market.id = observation.market_definition_id
     AND market.odds_type = 'prematch'
    JOIN public.sports_bookmakers AS bookmaker
      ON bookmaker.id = observation.bookmaker_id
    WHERE observation.decimal_odds > 1
      AND observation.quote_status = 'open'
      AND market.canonical_family IN (
        'full_time_result',
        'total_goals',
        'both_teams_to_score',
        'double_chance',
        'asian_handicap'
      )
      AND (
        market.canonical_family NOT IN ('total_goals', 'asian_handicap')
        OR (
          market.canonical_family = 'total_goals'
          AND observation.line_value IN (1.5, 2.5, 3.5, 4.5, 5.5)
        )
        OR (
          market.canonical_family = 'asian_handicap'
          AND observation.line_value BETWEEN -5.5 AND 5.5
          AND mod(abs(observation.line_value) * 2, 2) = 1
        )
      )
    ORDER BY
      observation.bookmaker_id,
      observation.market_definition_id,
      observation.selection_key,
      observation.line_key,
      observation.observed_at DESC,
      observation.decimal_odds DESC
  ),
  latest_consensus AS (
    SELECT DISTINCT ON (
      consensus.market_definition_id,
      consensus.selection_key,
      consensus.line_key
    )
      consensus.*,
      market.canonical_family
    FROM public.sports_odds_consensus AS consensus
    JOIN public.sports_market_definitions AS market
      ON market.id = consensus.market_definition_id
     AND market.odds_type = 'prematch'
    WHERE consensus.match_id = p_match_id
      AND NOT consensus.is_live
      AND consensus.snapshot_at <= p_cutoff_at
      AND market.canonical_family IN (
        'full_time_result', 'total_goals', 'both_teams_to_score',
        'double_chance', 'asian_handicap'
      )
    ORDER BY consensus.market_definition_id, consensus.selection_key,
      consensus.line_key, consensus.snapshot_at DESC, consensus.id
  )
  SELECT jsonb_build_object(
    'match_id', p_match_id,
    'quotes', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'bookmaker_id', bookmaker_id,
            'bookmaker_key', bookmaker_key,
            'market_definition_id', market_definition_id,
            'market_family', canonical_family,
            'selection_key', selection_key,
            'selection_name', selection_name,
            'line_key', line_key,
            'line_value', line_value,
            'decimal_odds', decimal_odds,
            'observed_at', observed_at,
            'source_raw_object_id', source_raw_object_id
          ) ORDER BY canonical_family, line_value NULLS FIRST,
            selection_key, bookmaker_key, bookmaker_id
        ) FROM latest_by_bookmaker
      ), '[]'::jsonb
    ),
    'consensus', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'market_definition_id', market_definition_id,
            'market_family', canonical_family,
            'selection_key', selection_key,
            'selection_name', selection_name,
            'line_key', line_key,
            'line_value', line_value,
            'median_odds', median_odds,
            'best_odds', best_odds,
            'minimum_odds', minimum_odds,
            'iqr', iqr,
            'bookmaker_count', bookmaker_count,
            'bookmaker_ids', bookmaker_ids,
            'snapshot_at', snapshot_at
          ) ORDER BY canonical_family, line_value NULLS FIRST, selection_key
        ) FROM latest_consensus
      ), '[]'::jsonb
    ),
    'quote_count', (SELECT count(*) FROM latest_by_bookmaker),
    'consensus_count', (SELECT count(*) FROM latest_consensus),
    'source_max_at', GREATEST(
      (SELECT max(observed_at) FROM latest_by_bookmaker),
      (SELECT max(snapshot_at) FROM latest_consensus)
    )
  )
$function$;

REVOKE ALL ON FUNCTION public.build_football_odds_asof_v2(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_football_odds_asof_v2(uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.build_football_match_window_v2(
  uuid, timestamptz, integer, uuid, text
) IS 'Builds a deterministic, point-in-time football result window with explicit match IDs.';
COMMENT ON FUNCTION public.build_football_h2h_window_v2(
  uuid, uuid, uuid, timestamptz, integer
) IS 'Builds prior H2H across competitions, excluding the target match.';
COMMENT ON FUNCTION public.build_football_odds_asof_v2(uuid, timestamptz) IS
  'Reconstructs prematch bookmaker quotes and consensus proven to exist by cutoff.';

CREATE OR REPLACE FUNCTION public.build_football_league_prior_v2(
  p_competition_id uuid,
  p_season_id uuid,
  p_cutoff_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH eligible AS (
    SELECT
      match_row.id AS match_id,
      match_row.kickoff_at,
      score_parts.parts[1]::integer AS home_goals,
      score_parts.parts[2]::integer AS away_goals,
      match_row.updated_at AS source_max_at
    FROM public.sports_matches AS match_row
    CROSS JOIN LATERAL (
      SELECT regexp_match(
        COALESCE(match_row.score_data ->> 'current', ''),
        '^[[:space:]]*([0-9]+)[[:space:]]*-[[:space:]]*([0-9]+)[[:space:]]*$'
      ) AS parts
    ) AS score_parts
    WHERE match_row.competition_id = p_competition_id
      AND match_row.season_id = p_season_id
      AND match_row.status = 'finished'
      AND match_row.kickoff_at < p_cutoff_at
      AND match_row.ended_at IS NOT NULL
      AND match_row.ended_at <= p_cutoff_at
      AND match_row.updated_at <= p_cutoff_at
      AND score_parts.parts IS NOT NULL
  )
  SELECT jsonb_build_object(
    'competition_id', p_competition_id,
    'season_id', p_season_id,
    'match_ids', COALESCE(
      (SELECT jsonb_agg(match_id ORDER BY kickoff_at, match_id) FROM eligible),
      '[]'::jsonb
    ),
    'sample', (SELECT count(*) FROM eligible),
    'average_home_goals', (SELECT round(avg(home_goals), 4) FROM eligible),
    'average_away_goals', (SELECT round(avg(away_goals), 4) FROM eligible),
    'average_total_goals', (
      SELECT round(avg(home_goals + away_goals), 4) FROM eligible
    ),
    'source_max_at', (SELECT max(source_max_at) FROM eligible)
  )
$function$;

REVOKE ALL ON FUNCTION public.build_football_league_prior_v2(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_football_league_prior_v2(
  uuid, uuid, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.preview_football_prematch_features_v2(
  p_match_id uuid,
  p_horizon_key text DEFAULT 't24h'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  horizon_interval interval;
  target record;
  previous_season_id uuid;
  home_current jsonb;
  away_current jsonb;
  home_previous jsonb;
  away_previous jsonb;
  home_recent jsonb;
  away_recent jsonb;
  home_venue jsonb;
  away_venue jsonb;
  home_enrichment jsonb;
  away_enrichment jsonb;
  h2h jsonb;
  league_prior jsonb;
  odds jsonb;
  cutoff_at timestamptz;
  source_max_at timestamptz;
  quality_codes jsonb := '[]'::jsonb;
  match_state text := 'READY';
  payload jsonb;
  fingerprint text;
BEGIN
  horizon_interval := CASE p_horizon_key
    WHEN 't24h' THEN interval '24 hours'
    WHEN 't6h' THEN interval '6 hours'
    WHEN 't60m' THEN interval '60 minutes'
    ELSE NULL
  END;
  IF horizon_interval IS NULL THEN
    RAISE EXCEPTION 'unsupported feature horizon: %', p_horizon_key
      USING ERRCODE = '22023';
  END IF;

  SELECT
    match_row.id AS match_id,
    match_row.sport_id,
    match_row.competition_id,
    match_row.season_id,
    match_row.kickoff_at,
    match_row.round_name,
    home.team_id AS home_team_id,
    away.team_id AS away_team_id,
    competition_entity.external_id AS competition_external_id
  INTO target
  FROM public.sports_matches AS match_row
  JOIN public.sports AS sport
    ON sport.id = match_row.sport_id
   AND sport.code = 'football'
  JOIN public.sports_match_participants AS home
    ON home.match_id = match_row.id AND home.role = 'home'
  JOIN public.sports_match_participants AS away
    ON away.match_id = match_row.id AND away.role = 'away'
  JOIN public.sports_provider_entities AS competition_entity
    ON competition_entity.entity_type = 'competition'
   AND competition_entity.canonical_id = match_row.competition_id
  JOIN public.sports_providers AS provider
    ON provider.id = competition_entity.provider_id
   AND provider.code = 'highlightly'
  WHERE match_row.id = p_match_id
    AND competition_entity.external_id IN ('33973', '119924', '84182')
  ORDER BY competition_entity.last_seen_at DESC
  LIMIT 1;

  IF target.match_id IS NULL THEN
    RAISE EXCEPTION 'football MVP match not found: %', p_match_id
      USING ERRCODE = 'P0002';
  END IF;
  IF target.kickoff_at IS NULL OR target.competition_id IS NULL
     OR target.season_id IS NULL THEN
    RAISE EXCEPTION 'match identity, season and kickoff are required'
      USING ERRCODE = '22023';
  END IF;
  IF target.home_team_id = target.away_team_id THEN
    RAISE EXCEPTION 'home and away team IDs must be distinct'
      USING ERRCODE = '22023';
  END IF;

  cutoff_at := target.kickoff_at - horizon_interval;
  previous_season_id := public.resolve_previous_competition_season_v1(
    target.competition_id,
    target.season_id
  );

  home_current := public.build_football_match_window_v2(
    target.home_team_id, cutoff_at, 500, target.season_id, NULL
  );
  away_current := public.build_football_match_window_v2(
    target.away_team_id, cutoff_at, 500, target.season_id, NULL
  );
  home_previous := public.build_football_match_window_v2(
    target.home_team_id, cutoff_at, 500, previous_season_id, NULL
  );
  away_previous := public.build_football_match_window_v2(
    target.away_team_id, cutoff_at, 500, previous_season_id, NULL
  );
  home_recent := public.build_football_match_window_v2(
    target.home_team_id, cutoff_at, 5, NULL, NULL
  );
  away_recent := public.build_football_match_window_v2(
    target.away_team_id, cutoff_at, 5, NULL, NULL
  );
  home_venue := public.build_football_match_window_v2(
    target.home_team_id, cutoff_at, 5, NULL, 'home'
  );
  away_venue := public.build_football_match_window_v2(
    target.away_team_id, cutoff_at, 5, NULL, 'away'
  );
  home_enrichment := public.build_highlightly_football_team_features(
    target.home_team_id, target.competition_id, target.season_id, cutoff_at
  );
  away_enrichment := public.build_highlightly_football_team_features(
    target.away_team_id, target.competition_id, target.season_id, cutoff_at
  );
  h2h := public.build_football_h2h_window_v2(
    target.home_team_id, target.away_team_id, target.match_id, cutoff_at, 20
  );
  league_prior := public.build_football_league_prior_v2(
    target.competition_id, target.season_id, cutoff_at
  );
  odds := public.build_football_odds_asof_v2(target.match_id, cutoff_at);

  IF (home_recent ->> 'sample')::integer < 5 THEN
    quality_codes := quality_codes || '"HISTORY_LT_5_HOME"'::jsonb;
    match_state := 'MATCH_BLOCKED';
  END IF;
  IF (away_recent ->> 'sample')::integer < 5 THEN
    quality_codes := quality_codes || '"HISTORY_LT_5_AWAY"'::jsonb;
    match_state := 'MATCH_BLOCKED';
  END IF;
  IF previous_season_id IS NULL
     OR (home_previous ->> 'sample')::integer = 0 THEN
    quality_codes := quality_codes || '"PREVIOUS_SEASON_MISSING_HOME"'::jsonb;
    IF match_state = 'READY' THEN match_state := 'DEGRADED'; END IF;
  END IF;
  IF previous_season_id IS NULL
     OR (away_previous ->> 'sample')::integer = 0 THEN
    quality_codes := quality_codes || '"PREVIOUS_SEASON_MISSING_AWAY"'::jsonb;
    IF match_state = 'READY' THEN match_state := 'DEGRADED'; END IF;
  END IF;
  IF (home_venue ->> 'sample')::integer < 5 THEN
    quality_codes := quality_codes || '"VENUE_HISTORY_INSUFFICIENT_HOME"'::jsonb;
    IF match_state = 'READY' THEN match_state := 'DEGRADED'; END IF;
  END IF;
  IF (away_venue ->> 'sample')::integer < 5 THEN
    quality_codes := quality_codes || '"VENUE_HISTORY_INSUFFICIENT_AWAY"'::jsonb;
    IF match_state = 'READY' THEN match_state := 'DEGRADED'; END IF;
  END IF;
  IF (h2h ->> 'sample')::integer = 0 THEN
    quality_codes := quality_codes || '"H2H_MISSING"'::jsonb;
  END IF;
  IF home_enrichment -> 'standings' IS NULL
     OR home_enrichment -> 'standings' = 'null'::jsonb
     OR away_enrichment -> 'standings' IS NULL
     OR away_enrichment -> 'standings' = 'null'::jsonb THEN
    quality_codes := quality_codes || '"STANDINGS_MISSING"'::jsonb;
  END IF;
  IF (odds ->> 'quote_count')::integer = 0 THEN
    quality_codes := quality_codes || '"MARKET_NOT_OFFERED"'::jsonb;
  END IF;

  SELECT max(source_time)
  INTO source_max_at
  FROM unnest(ARRAY[
    NULLIF(home_current ->> 'source_max_at', '')::timestamptz,
    NULLIF(away_current ->> 'source_max_at', '')::timestamptz,
    NULLIF(home_previous ->> 'source_max_at', '')::timestamptz,
    NULLIF(away_previous ->> 'source_max_at', '')::timestamptz,
    NULLIF(home_recent ->> 'source_max_at', '')::timestamptz,
    NULLIF(away_recent ->> 'source_max_at', '')::timestamptz,
    NULLIF(home_venue ->> 'source_max_at', '')::timestamptz,
    NULLIF(away_venue ->> 'source_max_at', '')::timestamptz,
    NULLIF(home_enrichment ->> 'source_max_at', '')::timestamptz,
    NULLIF(away_enrichment ->> 'source_max_at', '')::timestamptz,
    NULLIF(h2h ->> 'source_max_at', '')::timestamptz,
    NULLIF(league_prior ->> 'source_max_at', '')::timestamptz,
    NULLIF(odds ->> 'source_max_at', '')::timestamptz
  ]) AS source_values(source_time);

  IF source_max_at > cutoff_at THEN
    quality_codes := quality_codes || '"SOURCE_AFTER_CUTOFF"'::jsonb;
    match_state := 'MATCH_BLOCKED';
  END IF;

  payload := jsonb_build_object(
    'schema_version', 'highlightly_football_prematch@2.0.0',
    'match', jsonb_build_object(
      'match_id', target.match_id,
      'sport_id', target.sport_id,
      'competition_id', target.competition_id,
      'competition_external_id', target.competition_external_id,
      'season_id', target.season_id,
      'previous_season_id', previous_season_id,
      'home_team_id', target.home_team_id,
      'away_team_id', target.away_team_id,
      'kickoff_at', target.kickoff_at,
      'round_name', target.round_name
    ),
    'cutoff', jsonb_build_object(
      'horizon_key', p_horizon_key,
      'cutoff_at', cutoff_at,
      'source_max_at', source_max_at
    ),
    'home', jsonb_build_object(
      'team_id', target.home_team_id,
      'current_season', home_current,
      'previous_season', home_previous,
      'recent_overall', home_recent,
      'recent_venue', home_venue,
      'season_metrics', home_enrichment -> 'season_numeric_features',
      'standings', home_enrichment -> 'standings'
    ),
    'away', jsonb_build_object(
      'team_id', target.away_team_id,
      'current_season', away_current,
      'previous_season', away_previous,
      'recent_overall', away_recent,
      'recent_venue', away_venue,
      'season_metrics', away_enrichment -> 'season_numeric_features',
      'standings', away_enrichment -> 'standings'
    ),
    'h2h', h2h,
    'league_prior', league_prior,
    'markets', odds,
    'quality', jsonb_build_object(
      'contract_version', 'football_input_quality@1.0.0',
      'match_state', match_state,
      'codes', quality_codes,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'lineage', jsonb_build_object(
      'provider', 'highlightly',
      'provider_calls', false,
      'source_max_at', source_max_at,
      'target_match_forbidden', true
    )
  );

  fingerprint := encode(
    extensions.digest(pg_catalog.convert_to(payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
  RETURN payload || jsonb_build_object('fingerprint', fingerprint);
END
$function$;

REVOKE ALL ON FUNCTION public.preview_football_prematch_features_v2(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_football_prematch_features_v2(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.build_football_league_prior_v2(
  uuid, uuid, timestamptz
) IS 'Builds deterministic pre-cutoff league scoring priors for the target season.';
COMMENT ON FUNCTION public.preview_football_prematch_features_v2(uuid, text) IS
  'Builds but does not persist the complete Football feature snapshot v2, including quality, lineage, and fingerprint.';
