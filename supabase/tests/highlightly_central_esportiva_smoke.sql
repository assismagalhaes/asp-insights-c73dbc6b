-- Transactional smoke for the Central Esportiva contract repair. Always rolls back.

BEGIN;

DO $structure$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sports_highlights'
      AND column_name = 'thumbnail_url'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sports_highlights'
      AND column_name = 'duration_seconds'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sports_highlights'
      AND column_name = 'published_at'
  ) THEN
    RAISE EXCEPTION 'Basketball highlight contract columns are incomplete';
  END IF;

  IF has_function_privilege('anon', 'public.get_basketball_match_detail(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role can execute Basketball detail read model';
  END IF;
END
$structure$;

DO $wnba_normalization$
DECLARE
  v_sport_id uuid;
  v_competition_id uuid := gen_random_uuid();
  v_match_id uuid := gen_random_uuid();
  v_home_id uuid := gen_random_uuid();
  v_away_id uuid := gen_random_uuid();
  v_league text;
  v_home text;
  v_away text;
BEGIN
  SELECT id INTO v_sport_id FROM public.sports WHERE code = 'basketball';
  IF v_sport_id IS NULL THEN
    RAISE EXCEPTION 'Basketball sport seed is missing';
  END IF;

  INSERT INTO public.sports_competitions (id, sport_id, name, short_name)
  VALUES (v_competition_id, v_sport_id, 'NBA Women', 'WNBA');

  INSERT INTO public.sports_teams (id, sport_id, name)
  VALUES
    (v_home_id, v_sport_id, 'Washington Mystics Women'),
    (v_away_id, v_sport_id, 'Portland Women');

  INSERT INTO public.sports_matches (id, sport_id, competition_id, kickoff_at)
  VALUES (v_match_id, v_sport_id, v_competition_id, '2026-07-16 22:00:00+00');

  INSERT INTO public.sports_match_participants (match_id, team_id, role)
  VALUES
    (v_match_id, v_home_id, 'home'),
    (v_match_id, v_away_id, 'away');

  SELECT competition_name, home_team_name, away_team_name
  INTO v_league, v_home, v_away
  FROM public.sports_basketball_match_summary_v
  WHERE match_id = v_match_id;

  IF v_league <> 'WNBA'
     OR v_home <> 'Washington Mystics W'
     OR v_away <> 'Portland Fire W' THEN
    RAISE EXCEPTION 'WNBA normalization failed: league %, home %, away %', v_league, v_home, v_away;
  END IF;
END
$wnba_normalization$;

ROLLBACK;
