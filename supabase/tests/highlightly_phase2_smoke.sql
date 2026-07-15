-- Transactional smoke for Highlightly Phase 2. Always finishes with ROLLBACK.
BEGIN;

DO $smoke$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO missing
  FROM unnest(ARRAY[
    'sports_match_team_stats', 'sports_team_season_stats', 'sports_player_stats',
    'sports_player_box_scores', 'sports_lineups', 'sports_lineup_players',
    'sports_match_events', 'sports_standings_snapshots', 'sports_highlights',
    'sports_market_definitions', 'sports_odds_current', 'sports_odds_history',
    'sports_odds_consensus'
  ]) AS required(name)
  WHERE to_regclass('public.' || name) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing Phase 2 tables: %', missing;
  END IF;

  IF to_regclass('public.sports_football_match_summary_v') IS NULL THEN
    RAISE EXCEPTION 'Missing Football summary read model';
  END IF;
  IF to_regprocedure('public.upsert_sports_odds_quote(uuid,uuid,uuid,text,text,text,numeric,numeric,text,boolean,timestamptz,timestamptz,uuid)') IS NULL
     OR to_regprocedure('public.upsert_sports_odds_quotes(jsonb)') IS NULL
     OR to_regprocedure('public.get_football_daily_matches(timestamptz,timestamptz,timestamptz,uuid,integer)') IS NULL
     OR to_regprocedure('public.get_football_match_detail(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing Phase 2 RPC';
  END IF;

  IF (SELECT enabled FROM public.sports_providers WHERE code = 'highlightly') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled during migration smoke';
  END IF;
  IF has_function_privilege('anon', 'public.upsert_sports_odds_quotes(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.upsert_sports_odds_quotes(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Bulk odds writer leaked outside service_role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.upsert_sports_odds_quotes(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute bulk odds writer';
  END IF;
  IF has_function_privilege('anon', 'public.get_football_match_detail(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role can execute Football detail read model';
  END IF;
END
$smoke$;

DO $odds$
DECLARE
  sport_id uuid;
  provider_id uuid;
  bookmaker_id uuid;
  market_id constant uuid := '20000000-0000-4000-8000-000000000001';
  competition_id constant uuid := '20000000-0000-4000-8000-000000000002';
  season_id constant uuid := '20000000-0000-4000-8000-000000000003';
  home_id constant uuid := '20000000-0000-4000-8000-000000000004';
  away_id constant uuid := '20000000-0000-4000-8000-000000000005';
  v_match_id constant uuid := '20000000-0000-4000-8000-000000000006';
  current_count integer;
  history_count integer;
  current_price numeric;
BEGIN
  SELECT id INTO sport_id FROM public.sports WHERE code = 'football';
  SELECT id INTO provider_id FROM public.sports_providers WHERE code = 'highlightly';
  SELECT id INTO bookmaker_id FROM public.sports_bookmakers WHERE normalized_name = 'bet365';

  INSERT INTO public.sports_competitions (id, sport_id, name)
  VALUES (competition_id, sport_id, 'Phase 2 Smoke League');
  INSERT INTO public.sports_seasons (id, competition_id, label)
  VALUES (season_id, competition_id, '2026');
  INSERT INTO public.sports_teams (id, sport_id, name)
  VALUES (home_id, sport_id, 'Phase 2 Home'), (away_id, sport_id, 'Phase 2 Away');
  INSERT INTO public.sports_matches (id, sport_id, competition_id, season_id, kickoff_at)
  VALUES (v_match_id, sport_id, competition_id, season_id, '2026-07-15T12:00:00Z');
  INSERT INTO public.sports_match_participants (match_id, team_id, role)
  VALUES (v_match_id, home_id, 'home'), (v_match_id, away_id, 'away');
  INSERT INTO public.sports_market_definitions (
    id, provider_id, sport_id, provider_market_key, canonical_family, display_name
  ) VALUES (
    market_id, provider_id, sport_id,
    '__phase2_smoke_full_time_result__', 'moneyline', 'Phase 2 Smoke Full Time Result'
  );

  PERFORM public.upsert_sports_odds_quote(
    v_match_id, bookmaker_id, market_id, 'home', 'Home', '', NULL,
    2.10, 'open', false, NULL, '2026-07-15T10:00:00Z', NULL
  );
  PERFORM public.upsert_sports_odds_quote(
    v_match_id, bookmaker_id, market_id, 'home', 'Home', '', NULL,
    2.10, 'open', false, NULL, '2026-07-15T10:00:00Z', NULL
  );
  PERFORM * FROM public.upsert_sports_odds_quotes(jsonb_build_array(jsonb_build_object(
    'p_match_id', v_match_id,
    'p_bookmaker_id', bookmaker_id,
    'p_market_definition_id', market_id,
    'p_selection_key', 'home',
    'p_selection_name', 'Home',
    'p_line_key', '',
    'p_line_value', NULL,
    'p_decimal_odds', 2.20,
    'p_quote_status', 'open',
    'p_is_live', false,
    'p_collected_at', '2026-07-15T10:05:00Z'
  )));

  SELECT count(*), max(decimal_odds) INTO current_count, current_price
  FROM public.sports_odds_current AS quote WHERE quote.match_id = v_match_id;
  SELECT count(*) INTO history_count
  FROM public.sports_odds_history WHERE sports_odds_history.match_id = v_match_id;
  IF current_count <> 1 OR history_count <> 2 OR current_price <> 2.20 THEN
    RAISE EXCEPTION 'Odds idempotency failed: current %, history %, price %', current_count, history_count, current_price;
  END IF;
END
$odds$;

ROLLBACK;
