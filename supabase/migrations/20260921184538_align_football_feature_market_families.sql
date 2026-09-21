-- Align the provider-normalized odds vocabulary with the public football
-- feature contract. Stored market definitions remain unchanged; the builder
-- translates them at its boundary so historical rows do not need rewriting.
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
    SELECT history.match_id, history.bookmaker_id,
      history.market_definition_id, history.selection_key,
      history.selection_name, history.line_key, history.line_value,
      history.decimal_odds, history.quote_status, history.is_live,
      history.captured_at AS observed_at, history.source_raw_object_id
    FROM public.sports_odds_history AS history
    WHERE history.match_id = p_match_id
      AND NOT history.is_live
      AND history.captured_at <= p_cutoff_at
    UNION ALL
    SELECT current_quote.match_id, current_quote.bookmaker_id,
      current_quote.market_definition_id, current_quote.selection_key,
      current_quote.selection_name, current_quote.line_key,
      current_quote.line_value, current_quote.decimal_odds,
      current_quote.quote_status, current_quote.is_live,
      current_quote.updated_at AS observed_at,
      current_quote.source_raw_object_id
    FROM public.sports_odds_current AS current_quote
    WHERE current_quote.match_id = p_match_id
      AND NOT current_quote.is_live
      AND current_quote.updated_at <= p_cutoff_at
  ),
  latest_by_bookmaker AS (
    SELECT DISTINCT ON (
      observation.bookmaker_id, observation.market_definition_id,
      observation.selection_key, observation.line_key
    )
      observation.*,
      CASE market.canonical_family
        WHEN 'moneyline' THEN 'full_time_result'
        WHEN 'total' THEN 'total_goals'
        WHEN 'handicap' THEN 'asian_handicap'
        ELSE market.canonical_family
      END AS canonical_family,
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
        'moneyline', 'full_time_result',
        'total', 'total_goals',
        'both_teams_to_score', 'double_chance',
        'handicap', 'asian_handicap'
      )
      AND (
        market.canonical_family NOT IN (
          'total', 'total_goals', 'handicap', 'asian_handicap'
        )
        OR (
          market.canonical_family IN ('total', 'total_goals')
          AND observation.line_value IN (1.5, 2.5, 3.5, 4.5, 5.5)
        )
        OR (
          market.canonical_family IN ('handicap', 'asian_handicap')
          AND observation.line_value BETWEEN -5.5 AND 5.5
          AND mod(abs(observation.line_value) * 2, 2) = 1
        )
      )
    ORDER BY observation.bookmaker_id, observation.market_definition_id,
      observation.selection_key, observation.line_key,
      observation.observed_at DESC, observation.decimal_odds DESC
  ),
  latest_consensus AS (
    SELECT DISTINCT ON (
      consensus.market_definition_id, consensus.selection_key,
      consensus.line_key
    )
      consensus.*,
      CASE market.canonical_family
        WHEN 'moneyline' THEN 'full_time_result'
        WHEN 'total' THEN 'total_goals'
        WHEN 'handicap' THEN 'asian_handicap'
        ELSE market.canonical_family
      END AS canonical_family
    FROM public.sports_odds_consensus AS consensus
    JOIN public.sports_market_definitions AS market
      ON market.id = consensus.market_definition_id
     AND market.odds_type = 'prematch'
    WHERE consensus.match_id = p_match_id
      AND NOT consensus.is_live
      AND consensus.snapshot_at <= p_cutoff_at
      AND market.canonical_family IN (
        'moneyline', 'full_time_result',
        'total', 'total_goals',
        'both_teams_to_score', 'double_chance',
        'handicap', 'asian_handicap'
      )
      AND (
        market.canonical_family NOT IN (
          'total', 'total_goals', 'handicap', 'asian_handicap'
        )
        OR (
          market.canonical_family IN ('total', 'total_goals')
          AND consensus.line_value IN (1.5, 2.5, 3.5, 4.5, 5.5)
        )
        OR (
          market.canonical_family IN ('handicap', 'asian_handicap')
          AND consensus.line_value BETWEEN -5.5 AND 5.5
          AND mod(abs(consensus.line_value) * 2, 2) = 1
        )
      )
    ORDER BY consensus.market_definition_id, consensus.selection_key,
      consensus.line_key, consensus.snapshot_at DESC, consensus.id
  )
  SELECT jsonb_build_object(
    'match_id', p_match_id,
    'quotes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bookmaker_id', bookmaker_id, 'bookmaker_key', bookmaker_key,
        'market_definition_id', market_definition_id,
        'market_family', canonical_family, 'selection_key', selection_key,
        'selection_name', selection_name, 'line_key', line_key,
        'line_value', line_value, 'decimal_odds', decimal_odds,
        'observed_at', observed_at,
        'source_raw_object_id', source_raw_object_id
      ) ORDER BY canonical_family, line_value NULLS FIRST,
        selection_key, bookmaker_key, bookmaker_id)
      FROM latest_by_bookmaker
    ), '[]'::jsonb),
    'consensus', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'market_definition_id', market_definition_id,
        'market_family', canonical_family, 'selection_key', selection_key,
        'selection_name', selection_name, 'line_key', line_key,
        'line_value', line_value, 'median_odds', median_odds,
        'best_odds', best_odds, 'minimum_odds', minimum_odds,
        'iqr', iqr, 'bookmaker_count', bookmaker_count,
        'bookmaker_ids', bookmaker_ids, 'snapshot_at', snapshot_at
      ) ORDER BY canonical_family, line_value NULLS FIRST, selection_key)
      FROM latest_consensus
    ), '[]'::jsonb),
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

COMMENT ON FUNCTION public.build_football_odds_asof_v2(uuid, timestamptz) IS
  'Reconstructs prematch football odds as of cutoff and translates provider families moneyline/total/handicap to the feature contract vocabulary.';
