-- Repair the Basketball detail contract and normalize WNBA presentation in read models.
-- Raw provider payloads and provider mappings remain unchanged for auditability.

ALTER TABLE public.sports_highlights
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

UPDATE public.sports_highlights
SET
  thumbnail_url = COALESCE(thumbnail_url, preview_url),
  published_at = COALESCE(published_at, created_at)
WHERE thumbnail_url IS NULL
   OR published_at IS NULL;

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
  CASE
    WHEN upper(COALESCE(competition.short_name, '')) = 'WNBA'
      OR lower(COALESCE(competition.name, '')) IN ('nba women', 'wnba')
    THEN 'WNBA'
    ELSE competition.name
  END AS competition_name,
  CASE
    WHEN upper(COALESCE(competition.short_name, '')) = 'WNBA'
      OR lower(COALESCE(competition.name, '')) IN ('nba women', 'wnba')
    THEN 'WNBA'
    ELSE competition.short_name
  END AS competition_short_name,
  season.id AS season_id,
  season.label AS season_label,
  home_team.id AS home_team_id,
  CASE
    WHEN home_team.id IS NULL THEN NULL
    WHEN upper(COALESCE(competition.short_name, '')) = 'WNBA'
      OR lower(COALESCE(competition.name, '')) IN ('nba women', 'wnba')
    THEN CASE lower(btrim(regexp_replace(
      COALESCE(home_team.display_name, home_team.name), '\s+(women|woman|w)$', '', 'i'
    )))
      WHEN 'atlanta' THEN 'Atlanta Dream W'
      WHEN 'chicago' THEN 'Chicago Sky W'
      WHEN 'connecticut' THEN 'Connecticut Sun W'
      WHEN 'dallas' THEN 'Dallas Wings W'
      WHEN 'golden state' THEN 'Golden State Valkyries W'
      WHEN 'indiana' THEN 'Indiana Fever W'
      WHEN 'las vegas' THEN 'Las Vegas Aces W'
      WHEN 'los angeles' THEN 'Los Angeles Sparks W'
      WHEN 'minnesota' THEN 'Minnesota Lynx W'
      WHEN 'new york' THEN 'New York Liberty W'
      WHEN 'phoenix' THEN 'Phoenix Mercury W'
      WHEN 'portland' THEN 'Portland Fire W'
      WHEN 'seattle' THEN 'Seattle Storm W'
      WHEN 'toronto' THEN 'Toronto Tempo W'
      WHEN 'washington' THEN 'Washington Mystics W'
      ELSE btrim(regexp_replace(
        COALESCE(home_team.display_name, home_team.name), '\s+(women|woman|w)$', '', 'i'
      )) || ' W'
    END
    ELSE COALESCE(home_team.display_name, home_team.name)
  END AS home_team_name,
  home_team.logo_url AS home_team_logo_url,
  home_participant.score_data AS home_score_data,
  away_team.id AS away_team_id,
  CASE
    WHEN away_team.id IS NULL THEN NULL
    WHEN upper(COALESCE(competition.short_name, '')) = 'WNBA'
      OR lower(COALESCE(competition.name, '')) IN ('nba women', 'wnba')
    THEN CASE lower(btrim(regexp_replace(
      COALESCE(away_team.display_name, away_team.name), '\s+(women|woman|w)$', '', 'i'
    )))
      WHEN 'atlanta' THEN 'Atlanta Dream W'
      WHEN 'chicago' THEN 'Chicago Sky W'
      WHEN 'connecticut' THEN 'Connecticut Sun W'
      WHEN 'dallas' THEN 'Dallas Wings W'
      WHEN 'golden state' THEN 'Golden State Valkyries W'
      WHEN 'indiana' THEN 'Indiana Fever W'
      WHEN 'las vegas' THEN 'Las Vegas Aces W'
      WHEN 'los angeles' THEN 'Los Angeles Sparks W'
      WHEN 'minnesota' THEN 'Minnesota Lynx W'
      WHEN 'new york' THEN 'New York Liberty W'
      WHEN 'phoenix' THEN 'Phoenix Mercury W'
      WHEN 'portland' THEN 'Portland Fire W'
      WHEN 'seattle' THEN 'Seattle Storm W'
      WHEN 'toronto' THEN 'Toronto Tempo W'
      WHEN 'washington' THEN 'Washington Mystics W'
      ELSE btrim(regexp_replace(
        COALESCE(away_team.display_name, away_team.name), '\s+(women|woman|w)$', '', 'i'
      )) || ' W'
    END
    ELSE COALESCE(away_team.display_name, away_team.name)
  END AS away_team_name,
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

NOTIFY pgrst, 'reload schema';
