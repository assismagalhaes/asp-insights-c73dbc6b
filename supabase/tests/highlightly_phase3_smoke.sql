-- Transactional smoke for Highlightly Phase 3 (MLB). Always finishes with ROLLBACK.
BEGIN;

DO $smoke$
BEGIN
  IF to_regclass('public.sports_baseball_match_summary_v') IS NULL THEN
    RAISE EXCEPTION 'Missing Baseball summary read model';
  END IF;
  IF to_regprocedure('public.refresh_sports_odds_consensus(uuid,timestamp with time zone,integer,integer)') IS NULL
     OR to_regprocedure('public.get_baseball_daily_matches(timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,integer)') IS NULL
     OR to_regprocedure('public.get_baseball_match_detail(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing Phase 3 RPC';
  END IF;
  IF (SELECT enabled FROM public.sports_providers WHERE code = 'highlightly') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled during Phase 3 smoke';
  END IF;
  IF has_function_privilege('anon', 'public.refresh_sports_odds_consensus(uuid,timestamp with time zone,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.refresh_sports_odds_consensus(uuid,timestamp with time zone,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Consensus writer leaked outside service_role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.refresh_sports_odds_consensus(uuid,timestamp with time zone,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot refresh odds consensus';
  END IF;
  IF has_function_privilege('anon', 'public.get_baseball_match_detail(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role can execute Baseball detail read model';
  END IF;
END
$smoke$;

DO $mlb$
DECLARE
  sport_id uuid;
  provider_id uuid;
  competition_id constant uuid := '30000000-0000-4000-8000-000000000001';
  season_id constant uuid := '30000000-0000-4000-8000-000000000002';
  home_id constant uuid := '30000000-0000-4000-8000-000000000003';
  away_id constant uuid := '30000000-0000-4000-8000-000000000004';
  pitcher_id constant uuid := '30000000-0000-4000-8000-000000000005';
  v_match_id constant uuid := '30000000-0000-4000-8000-000000000006';
  lineup_id constant uuid := '30000000-0000-4000-8000-000000000007';
  market_id constant uuid := '30000000-0000-4000-8000-000000000008';
  bookmaker record;
  quote_price numeric := 1.80;
  consensus_count integer;
  median_price numeric;
  selected_bookmakers integer;
  summary_pitcher uuid;
  summary_status text;
BEGIN
  SELECT id INTO sport_id FROM public.sports WHERE code = 'baseball';
  SELECT id INTO provider_id FROM public.sports_providers WHERE code = 'highlightly';

  INSERT INTO public.sports_competitions (id, sport_id, name, short_name)
  VALUES (competition_id, sport_id, 'Major League Baseball', 'MLB');
  INSERT INTO public.sports_seasons (id, competition_id, label)
  VALUES (season_id, competition_id, '2026');
  INSERT INTO public.sports_teams (id, sport_id, name)
  VALUES (home_id, sport_id, 'Phase 3 Home'), (away_id, sport_id, 'Phase 3 Away');
  INSERT INTO public.sports_players (id, sport_id, current_team_id, name, position)
  VALUES (pitcher_id, sport_id, home_id, 'Phase 3 Ace', 'Pitcher');
  INSERT INTO public.sports_matches (id, sport_id, competition_id, season_id, kickoff_at)
  VALUES (v_match_id, sport_id, competition_id, season_id, '2026-07-15T22:00:00Z');
  INSERT INTO public.sports_match_participants (match_id, team_id, role)
  VALUES (v_match_id, home_id, 'home'), (v_match_id, away_id, 'away');
  INSERT INTO public.sports_lineups (id, match_id, team_id, version_key, is_confirmed, published_at)
  VALUES (lineup_id, v_match_id, home_id, '__phase3_smoke__', true, '2026-07-15T20:00:00Z');
  INSERT INTO public.sports_lineup_players (
    lineup_id, player_id, role, position, formation_order, metadata
  ) VALUES (
    lineup_id, pitcher_id, 'starter', 'Pitcher', 0,
    '{"positionAbbreviation":"P","isStartingPitcher":true,"starterStatus":"confirmed"}'::jsonb
  );
  INSERT INTO public.sports_market_definitions (
    id, provider_id, sport_id, provider_market_key, canonical_family, display_name
  ) VALUES (
    market_id, provider_id, sport_id,
    '__phase3_smoke_home_away__', 'moneyline', 'Phase 3 Smoke Home/Away'
  );

  FOR bookmaker IN
    SELECT id
    FROM public.sports_bookmakers
    WHERE normalized_name IN ('bet365', '1xbet', 'unibet', 'william-hill', 'stake.com')
    ORDER BY normalized_name
  LOOP
    PERFORM public.upsert_sports_odds_quote(
      v_match_id, bookmaker.id, market_id, 'home', 'Home', '', NULL,
      quote_price, 'open', false, NULL, '2026-07-15T20:00:00Z', NULL
    );
    quote_price := quote_price + 0.10;
  END LOOP;

  consensus_count := public.refresh_sports_odds_consensus(
    v_match_id, '2026-07-15T20:05:00Z', 5, 7
  );
  SELECT median_odds, bookmaker_count
  INTO median_price, selected_bookmakers
  FROM public.sports_odds_consensus
  WHERE sports_odds_consensus.match_id = v_match_id;
  IF consensus_count <> 1 OR median_price <> 2.00 OR selected_bookmakers <> 5 THEN
    RAISE EXCEPTION 'MLB consensus failed: rows %, median %, bookmakers %',
      consensus_count, median_price, selected_bookmakers;
  END IF;

  SELECT home_starting_pitcher_id, home_starting_pitcher_status
  INTO summary_pitcher, summary_status
  FROM public.sports_baseball_match_summary_v
  WHERE sports_baseball_match_summary_v.match_id = v_match_id;
  IF summary_pitcher IS DISTINCT FROM pitcher_id OR summary_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Starting pitcher read model failed: pitcher %, status %',
      summary_pitcher, summary_status;
  END IF;
END
$mlb$;

ROLLBACK;
