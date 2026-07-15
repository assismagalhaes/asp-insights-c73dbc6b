-- Transactional smoke for Highlightly Phase 4 (WNBA). Always finishes with ROLLBACK.
BEGIN;

DO $structure$
BEGIN
  IF to_regclass('public.sports_basketball_match_summary_v') IS NULL THEN
    RAISE EXCEPTION 'Missing Basketball summary read model';
  END IF;
  IF to_regprocedure('public.get_basketball_daily_matches(timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,integer)') IS NULL
     OR to_regprocedure('public.get_basketball_match_detail(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing Phase 4 Basketball RPC';
  END IF;
  IF has_function_privilege('anon', 'public.get_basketball_daily_matches(timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_basketball_match_detail(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role can execute Basketball read models';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_basketball_match_detail(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated admins cannot execute Basketball detail read model';
  END IF;
  IF (SELECT enabled FROM public.sports_providers WHERE code = 'highlightly') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled during Phase 4 smoke';
  END IF;
END
$structure$;

DO $wnba$
DECLARE
  sport_id uuid;
  v_competition_id constant uuid := '40000000-0000-4000-8000-000000000001';
  v_season_id constant uuid := '40000000-0000-4000-8000-000000000002';
  home_id constant uuid := '40000000-0000-4000-8000-000000000003';
  away_id constant uuid := '40000000-0000-4000-8000-000000000004';
  v_match_id constant uuid := '40000000-0000-4000-8000-000000000005';
  metric_id constant uuid := '40000000-0000-4000-8000-000000000006';
  summary_home uuid;
  summary_score jsonb;
  valid_count integer;
BEGIN
  SELECT id INTO sport_id FROM public.sports WHERE code = 'basketball';
  INSERT INTO public.sports_competitions (id, sport_id, name, short_name)
  VALUES (v_competition_id, sport_id, 'NBA Women', 'WNBA');
  INSERT INTO public.sports_seasons (id, competition_id, label)
  VALUES (v_season_id, v_competition_id, '2026');
  INSERT INTO public.sports_teams (id, sport_id, name)
  VALUES (home_id, sport_id, 'Phase 4 Home'), (away_id, sport_id, 'Phase 4 Away');
  INSERT INTO public.sports_matches (
    id, sport_id, competition_id, season_id, kickoff_at, status, score_data
  ) VALUES (
    v_match_id, sport_id, v_competition_id, v_season_id,
    '2026-07-15T22:00:00Z', 'finished', '{"current":"90 - 87"}'::jsonb
  );
  INSERT INTO public.sports_match_participants (match_id, team_id, role, score_data)
  VALUES
    (v_match_id, home_id, 'home', '{"current":90}'::jsonb),
    (v_match_id, away_id, 'away', '{"current":87}'::jsonb);
  INSERT INTO public.hl_metric_definitions (
    id, provider_id, sport_id, resource, group_name, provider_key,
    canonical_key, display_name, value_type, status
  ) SELECT
    metric_id, provider.id, sport_id, 'match_statistics_derived', 'Efficiency',
    '__phase4_smoke_pace__', 'pace', 'Pace', 'decimal', 'observed'
  FROM public.sports_providers AS provider WHERE provider.code = 'highlightly';
  INSERT INTO public.sports_match_team_stats (
    match_id, team_id, metric_definition_id, numeric_value
  ) VALUES (v_match_id, home_id, metric_id, 82.12);
  INSERT INTO public.sports_standings_snapshots (
    competition_id, season_id, team_id, group_key, snapshot_at, rank,
    played, wins, draws, losses, quality_status
  ) VALUES
    (v_competition_id, v_season_id, home_id, 'Overall', '2026-07-15T21:00:00Z', 1, 20, 15, 0, 5, 'valid'),
    (v_competition_id, v_season_id, away_id, 'Overall', '2026-07-15T21:00:00Z', 2, 20, 12, 0, 8, 'valid'),
    (v_competition_id, v_season_id, away_id, 'Corrupt', '2026-07-15T21:01:00Z', 1, 99, 1, 0, 98, 'quarantined');

  SELECT home_team_id, home_score_data
  INTO summary_home, summary_score
  FROM public.sports_basketball_match_summary_v
  WHERE match_id = v_match_id;
  IF summary_home IS DISTINCT FROM home_id OR summary_score->>'current' <> '90' THEN
    RAISE EXCEPTION 'Basketball summary failed: home %, score %', summary_home, summary_score;
  END IF;
  SELECT count(*) INTO valid_count
  FROM public.sports_standings_snapshots
  WHERE competition_id = v_competition_id AND season_id = v_season_id
    AND quality_status = 'valid';
  IF valid_count <> 2 THEN
    RAISE EXCEPTION 'Basketball valid standings filter fixture failed: %', valid_count;
  END IF;
END
$wnba$;

ROLLBACK;
