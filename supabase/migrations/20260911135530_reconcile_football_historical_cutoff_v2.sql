-- Fase 3: reconcile historical football rows with the point-in-time contract.
-- Finished matches may lack ended_at in the current canonical store. In that
-- case updated_at is the conservative observation time: it must be <= cutoff.

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
    SELECT
      season.id,
      season.competition_id,
      season.label,
      season.start_date
    FROM public.sports_seasons AS season
    WHERE season.id = p_current_season_id
      AND season.competition_id = p_competition_id
  ),
  candidates AS (
    SELECT
      candidate.id,
      candidate.label,
      candidate.start_date,
      candidate.end_date,
      CASE
        WHEN current_season.start_date IS NOT NULL
         AND COALESCE(candidate.end_date, candidate.start_date)
               < current_season.start_date
          THEN 1
        WHEN current_season.label ~ '^[0-9]{4}$'
         AND candidate.label ~ '^[0-9]{4}$'
         AND candidate.label::integer < current_season.label::integer
          THEN 2
        ELSE NULL
      END AS resolution_rank
    FROM current_season
    JOIN public.sports_seasons AS candidate
      ON candidate.competition_id = current_season.competition_id
     AND candidate.id <> current_season.id
  )
  SELECT candidate.id
  FROM candidates AS candidate
  WHERE candidate.resolution_rank IS NOT NULL
  ORDER BY
    candidate.resolution_rank,
    COALESCE(candidate.end_date, candidate.start_date) DESC NULLS LAST,
    CASE
      WHEN candidate.label ~ '^[0-9]{4}$' THEN candidate.label::integer
    END DESC NULLS LAST,
    candidate.id
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.resolve_previous_competition_season_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_previous_competition_season_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.resolve_previous_competition_season_v1(uuid, uuid) IS
  'Returns the preceding season by canonical dates, with a deterministic four-digit label fallback when dates are absent.';

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
      AND COALESCE(match_row.ended_at, match_row.updated_at) <= p_cutoff_at
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
    'matches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'match_id', match_id,
        'competition_id', competition_id,
        'season_id', season_id,
        'kickoff_at', kickoff_at,
        'role', role,
        'opponent_team_id', opponent_team_id,
        'goals_for', goals_for,
        'goals_against', goals_against
      ) ORDER BY kickoff_at DESC, match_id)
      FROM ordered
    ), '[]'::jsonb),
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
      AND COALESCE(match_row.ended_at, match_row.updated_at) <= p_cutoff_at
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
    'matches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'match_id', match_id,
        'competition_id', competition_id,
        'season_id', season_id,
        'kickoff_at', kickoff_at,
        'historical_home_team_id', historical_home_team_id,
        'historical_away_team_id', historical_away_team_id,
        'home_goals', home_goals,
        'away_goals', away_goals
      ) ORDER BY kickoff_at DESC, match_id)
      FROM eligible
    ), '[]'::jsonb),
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
      AND COALESCE(match_row.ended_at, match_row.updated_at) <= p_cutoff_at
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

COMMENT ON FUNCTION public.build_football_match_window_v2(
  uuid, timestamptz, integer, uuid, text
) IS 'Builds a deterministic football result window. For finished rows without ended_at, updated_at is the conservative observation time and must be at or before cutoff.';
COMMENT ON FUNCTION public.build_football_h2h_window_v2(
  uuid, uuid, uuid, timestamptz, integer
) IS 'Builds prior H2H across competitions, excluding the target match and enforcing observation time at or before cutoff.';
COMMENT ON FUNCTION public.build_football_league_prior_v2(
  uuid, uuid, timestamptz
) IS 'Builds deterministic pre-cutoff league scoring priors, using updated_at when a finished row has no ended_at.';
