CREATE OR REPLACE FUNCTION public.get_football_model_input_candidates_v1(p_target_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH target_matches AS (
  SELECT
    match.id AS match_id,
    match.kickoff_at,
    match.competition_id
  FROM public.sports_matches AS match
  JOIN public.sports AS sport ON sport.id = match.sport_id AND sport.code = 'football'
  WHERE match.kickoff_at IS NOT NULL
    AND match.status IN ('scheduled', 'live', 'paused')
    AND (match.kickoff_at AT TIME ZONE 'America/Sao_Paulo')::date = p_target_date
),
participants AS (
  SELECT
    participant.match_id,
    max(team.name) FILTER (WHERE participant.role = 'home') AS home,
    max(team.name) FILTER (WHERE participant.role = 'away') AS away
  FROM public.sports_match_participants AS participant
  JOIN public.sports_teams AS team ON team.id = participant.team_id
  WHERE participant.match_id IN (SELECT match_id FROM target_matches)
  GROUP BY participant.match_id
),
latest_consensus AS (
  SELECT DISTINCT ON (
    consensus.match_id, consensus.market_definition_id,
    consensus.selection_key, consensus.line_key
  )
    consensus.*
  FROM public.sports_odds_consensus AS consensus
  WHERE NOT consensus.is_live
    AND consensus.match_id IN (SELECT match_id FROM target_matches)
  ORDER BY consensus.match_id, consensus.market_definition_id,
    consensus.selection_key, consensus.line_key, consensus.snapshot_at DESC
),
candidates AS (
  SELECT
    match.match_id AS match_id,
    (match.kickoff_at AT TIME ZONE 'America/Sao_Paulo')::date AS match_date,
    to_char(match.kickoff_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS match_time,
    country.name AS country,
    competition.name AS league,
    participants.home,
    participants.away,
    definition.id AS market_definition_id,
    definition.canonical_family AS market_family,
    consensus.selection_key,
    consensus.selection_name,
    consensus.line_key,
    consensus.line_value,
    consensus.median_odds,
    consensus.best_odds,
    consensus.bookmaker_count,
    consensus.snapshot_at,
    best_bookmaker.name AS best_bookmaker
  FROM target_matches AS match
  JOIN participants ON participants.match_id = match.match_id
  LEFT JOIN public.sports_competitions AS competition ON competition.id = match.competition_id
  LEFT JOIN public.sports_countries AS country ON country.id = competition.country_id
  JOIN latest_consensus AS consensus ON consensus.match_id = match.match_id
  JOIN public.sports_market_definitions AS definition
    ON definition.id = consensus.market_definition_id
   AND definition.odds_type = 'prematch'
   AND definition.is_active
   AND definition.canonical_family IN ('moneyline', 'total', 'both_teams_to_score', 'handicap')
  LEFT JOIN LATERAL (
    SELECT bookmaker.name
    FROM public.sports_odds_current AS quote
    JOIN public.sports_bookmakers AS bookmaker ON bookmaker.id = quote.bookmaker_id
    WHERE quote.match_id = consensus.match_id
      AND quote.market_definition_id = consensus.market_definition_id
      AND quote.selection_key = consensus.selection_key
      AND quote.line_key = consensus.line_key
      AND NOT quote.is_live
      AND quote.quote_status = 'open'
      AND quote.decimal_odds = consensus.best_odds
    ORDER BY bookmaker.is_preferred DESC, bookmaker.name
    LIMIT 1
  ) AS best_bookmaker ON true
  WHERE consensus.bookmaker_count >= 2
)
SELECT jsonb_build_object(
  'target_date', p_target_date,
  'mode', 'shadow',
  'automatic_publication', false,
  'candidates', COALESCE(jsonb_agg(to_jsonb(candidates) ORDER BY match_time, match_id, market_family, selection_key, line_key), '[]'::jsonb)
)
FROM candidates;
$function$;