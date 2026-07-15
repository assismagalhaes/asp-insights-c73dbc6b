-- Highlightly Phase 4: admin-only WNBA daily list and analytical match detail.

CREATE OR REPLACE VIEW public.sports_basketball_match_summary_v
WITH (security_invoker = true)
AS
SELECT
  match_row.id AS match_id,
  match_row.kickoff_at,
  match_row.status,
  match_row.provider_status,
  match_row.round_name,
  match_row.score_data,
  match_row.state_data,
  competition.id AS competition_id,
  competition.name AS competition_name,
  competition.short_name AS competition_short_name,
  season.id AS season_id,
  season.label AS season_label,
  home_team.id AS home_team_id,
  COALESCE(home_team.display_name, home_team.name) AS home_team_name,
  home_team.logo_url AS home_team_logo_url,
  home_participant.score_data AS home_score_data,
  away_team.id AS away_team_id,
  COALESCE(away_team.display_name, away_team.name) AS away_team_name,
  away_team.logo_url AS away_team_logo_url,
  away_participant.score_data AS away_score_data,
  match_row.updated_at
FROM public.sports_matches AS match_row
JOIN public.sports AS sport ON sport.id = match_row.sport_id AND sport.code = 'basketball'
LEFT JOIN public.sports_competitions AS competition ON competition.id = match_row.competition_id
LEFT JOIN public.sports_seasons AS season ON season.id = match_row.season_id
LEFT JOIN public.sports_match_participants AS home_participant
  ON home_participant.match_id = match_row.id AND home_participant.role = 'home'
LEFT JOIN public.sports_teams AS home_team ON home_team.id = home_participant.team_id
LEFT JOIN public.sports_match_participants AS away_participant
  ON away_participant.match_id = match_row.id AND away_participant.role = 'away'
LEFT JOIN public.sports_teams AS away_team ON away_team.id = away_participant.team_id;

REVOKE ALL ON public.sports_basketball_match_summary_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sports_basketball_match_summary_v TO authenticated;

CREATE OR REPLACE FUNCTION public.get_basketball_daily_matches(
  p_from timestamptz,
  p_to timestamptz,
  p_cursor_kickoff timestamptz DEFAULT NULL,
  p_cursor_match_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS SETOF public.sports_basketball_match_summary_v
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'invalid half-open date range [p_from, p_to)';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 200';
  END IF;
  IF (p_cursor_kickoff IS NULL) <> (p_cursor_match_id IS NULL) THEN
    RAISE EXCEPTION 'cursor kickoff and match id must be supplied together';
  END IF;

  RETURN QUERY
  SELECT summary.*
  FROM public.sports_basketball_match_summary_v AS summary
  WHERE summary.kickoff_at >= p_from
    AND summary.kickoff_at < p_to
    AND (
      p_cursor_kickoff IS NULL
      OR (summary.kickoff_at, summary.match_id) > (p_cursor_kickoff, p_cursor_match_id)
    )
  ORDER BY summary.kickoff_at, summary.match_id
  LIMIT p_limit;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_basketball_match_detail(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  summary public.sports_basketball_match_summary_v;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO summary
  FROM public.sports_basketball_match_summary_v
  WHERE match_id = p_match_id;

  IF summary.match_id IS NULL THEN
    RAISE EXCEPTION 'basketball match not found: %', p_match_id USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'match', to_jsonb(summary),
    'periodScores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'teamId', period.team_id,
        'periodKey', period.period_key,
        'periodOrder', period.period_order,
        'score', period.score,
        'metadata', period.metadata
      ) ORDER BY period.period_order, period.team_id)
      FROM public.sports_match_period_scores AS period
      WHERE period.match_id = p_match_id
    ), '[]'::jsonb),
    'teamStatistics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'teamId', fact.team_id,
        'preset', CASE WHEN metric.resource = 'match_statistics_derived' THEN 'efficiency' ELSE 'raw' END,
        'metricKey', metric.canonical_key,
        'providerMetricKey', metric.provider_key,
        'displayName', metric.display_name,
        'group', metric.group_name,
        'valueType', metric.value_type,
        'unit', metric.unit,
        'numericValue', fact.numeric_value,
        'textValue', fact.text_value,
        'booleanValue', fact.boolean_value,
        'jsonValue', fact.json_value,
        'collectedAt', fact.collected_at
      ) ORDER BY fact.team_id, metric.resource, metric.group_name, metric.display_name)
      FROM public.sports_match_team_stats AS fact
      JOIN public.hl_metric_definitions AS metric ON metric.id = fact.metric_definition_id
      WHERE fact.match_id = p_match_id
    ), '[]'::jsonb),
    'teamFormStatistics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'teamId', fact.team_id,
        'scopeKey', fact.scope_key,
        'splitKey', fact.split_key,
        'metricKey', metric.canonical_key,
        'displayName', metric.display_name,
        'group', metric.group_name,
        'numericValue', fact.numeric_value,
        'textValue', fact.text_value,
        'booleanValue', fact.boolean_value,
        'jsonValue', fact.json_value,
        'windowFrom', fact.window_from,
        'windowTo', fact.window_to,
        'collectedAt', fact.collected_at
      ) ORDER BY fact.team_id, fact.scope_key, fact.split_key, metric.display_name)
      FROM public.sports_team_season_stats AS fact
      JOIN public.hl_metric_definitions AS metric ON metric.id = fact.metric_definition_id
      WHERE fact.team_id IN (summary.home_team_id, summary.away_team_id)
        AND (fact.season_id = summary.season_id OR fact.season_id IS NULL)
    ), '[]'::jsonb),
    'odds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bookmakerId', bookmaker.id,
        'bookmaker', bookmaker.name,
        'preferred', bookmaker.is_preferred,
        'marketId', market.id,
        'marketFamily', market.canonical_family,
        'market', market.display_name,
        'oddsType', market.odds_type,
        'selectionKey', quote.selection_key,
        'selection', quote.selection_name,
        'lineKey', quote.line_key,
        'lineValue', quote.line_value,
        'decimalOdds', quote.decimal_odds,
        'status', quote.quote_status,
        'isLive', quote.is_live,
        'firstSeenAt', quote.first_seen_at,
        'lastSeenAt', quote.last_seen_at
      ) ORDER BY market.display_name, quote.line_value NULLS FIRST, quote.selection_name, bookmaker.name)
      FROM public.sports_odds_current AS quote
      JOIN public.sports_bookmakers AS bookmaker ON bookmaker.id = quote.bookmaker_id
      JOIN public.sports_market_definitions AS market ON market.id = quote.market_definition_id
      WHERE quote.match_id = p_match_id
    ), '[]'::jsonb),
    'oddsConsensus', COALESCE((
      SELECT jsonb_agg(to_jsonb(latest_consensus) ORDER BY latest_consensus.market_definition_id, latest_consensus.selection_key)
      FROM (
        SELECT DISTINCT ON (
          consensus.market_definition_id, consensus.selection_key,
          consensus.line_key, consensus.is_live
        ) consensus.*
        FROM public.sports_odds_consensus AS consensus
        WHERE consensus.match_id = p_match_id
        ORDER BY
          consensus.market_definition_id, consensus.selection_key,
          consensus.line_key, consensus.is_live, consensus.snapshot_at DESC
      ) AS latest_consensus
    ), '[]'::jsonb),
    'oddsMovement', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'marketId', history.market_definition_id,
        'marketFamily', market.canonical_family,
        'market', market.display_name,
        'bookmakerId', history.bookmaker_id,
        'selectionKey', history.selection_key,
        'selection', history.selection_name,
        'lineKey', history.line_key,
        'lineValue', history.line_value,
        'decimalOdds', history.decimal_odds,
        'previousDecimalOdds', history.previous_decimal_odds,
        'changeKind', history.change_kind,
        'isLive', history.is_live,
        'capturedAt', history.captured_at
      ) ORDER BY history.captured_at, history.id)
      FROM public.sports_odds_history AS history
      JOIN public.sports_market_definitions AS market ON market.id = history.market_definition_id
      WHERE history.match_id = p_match_id
    ), '[]'::jsonb),
    'standings', COALESCE((
      SELECT jsonb_agg(to_jsonb(standing) ORDER BY standing.group_key, standing.rank)
      FROM public.sports_standings_snapshots AS standing
      WHERE standing.competition_id = summary.competition_id
        AND standing.season_id = summary.season_id
        AND standing.quality_status = 'valid'
        AND standing.snapshot_at = (
          SELECT max(latest.snapshot_at)
          FROM public.sports_standings_snapshots AS latest
          WHERE latest.competition_id = summary.competition_id
            AND latest.season_id = summary.season_id
            AND latest.quality_status = 'valid'
        )
    ), '[]'::jsonb),
    'highlights', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', highlight.id,
        'type', highlight.highlight_type,
        'title', highlight.title,
        'description', highlight.description,
        'source', highlight.source_name,
        'channel', highlight.channel_name,
        'category', highlight.category,
        'previewUrl', highlight.preview_url,
        'contentUrl', highlight.content_url,
        'embedUrl', highlight.embed_url,
        'geoRestrictions', highlight.geo_restrictions,
        'metadata', highlight.metadata
      ) ORDER BY highlight.created_at DESC)
      FROM public.sports_highlights AS highlight
      WHERE highlight.match_id = p_match_id
    ), '[]'::jsonb),
    'analyticsPresets', jsonb_build_object(
      'raw', jsonb_build_array(
        'field_goals', 'three_pointers', 'free_throws', 'assists', 'rebounds',
        'steals', 'blocks', 'turnovers', 'fast_break', 'paint', 'fouls'
      ),
      'efficiency', jsonb_build_array(
        'pace', 'offensive_rating', 'defensive_rating',
        'effective_field_goal_percentage', 'true_shooting_percentage', 'net_rating'
      ),
      'splits', jsonb_build_array('total', 'home', 'away'),
      'markets', jsonb_build_array('moneyline', 'total', 'spread'),
      'odds', jsonb_build_array('median', 'best', 'movement')
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_basketball_daily_matches(
  timestamptz, timestamptz, timestamptz, uuid, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_basketball_daily_matches(
  timestamptz, timestamptz, timestamptz, uuid, integer
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_basketball_match_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_basketball_match_detail(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
