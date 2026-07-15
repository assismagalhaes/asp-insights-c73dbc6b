-- Transactional smoke for the global 2-7 preferred-bookmaker consensus policy.
BEGIN;

DO $minimum_consensus$
DECLARE
  sport_id uuid;
  provider_id uuid;
  home_id constant uuid := '31000000-0000-4000-8000-000000000001';
  away_id constant uuid := '31000000-0000-4000-8000-000000000002';
  v_match_id constant uuid := '31000000-0000-4000-8000-000000000003';
  market_id constant uuid := '31000000-0000-4000-8000-000000000004';
  bookmaker record;
  quote_price numeric := 1.90;
  consensus_count integer;
  median_price numeric;
  selected_bookmakers integer;
BEGIN
  SELECT id INTO sport_id FROM public.sports WHERE code = 'baseball';
  SELECT id INTO provider_id FROM public.sports_providers WHERE code = 'highlightly';

  INSERT INTO public.sports_teams (id, sport_id, name)
  VALUES
    (home_id, sport_id, 'Minimum Consensus Home'),
    (away_id, sport_id, 'Minimum Consensus Away');
  INSERT INTO public.sports_matches (id, sport_id, kickoff_at)
  VALUES (v_match_id, sport_id, '2026-07-16T00:00:00Z');
  INSERT INTO public.sports_match_participants (match_id, team_id, role)
  VALUES (v_match_id, home_id, 'home'), (v_match_id, away_id, 'away');
  INSERT INTO public.sports_market_definitions (
    id, provider_id, sport_id, provider_market_key, canonical_family, display_name
  ) VALUES (
    market_id, provider_id, sport_id,
    '__two_bookmaker_consensus__', 'run_line', 'Two Bookmaker Run Line'
  );

  FOR bookmaker IN
    SELECT id
    FROM public.sports_bookmakers
    WHERE normalized_name IN ('bet365', '1xbet')
    ORDER BY normalized_name
  LOOP
    PERFORM public.upsert_sports_odds_quote(
      v_match_id, bookmaker.id, market_id, 'home', 'Home', '-1.5', -1.5,
      quote_price, 'open', false, NULL, '2026-07-15T23:55:00Z', NULL
    );
    quote_price := quote_price + 0.20;
  END LOOP;

  consensus_count := public.refresh_sports_odds_consensus(
    v_match_id, '2026-07-15T23:56:00Z', 2, 7
  );
  SELECT median_odds, bookmaker_count
  INTO median_price, selected_bookmakers
  FROM public.sports_odds_consensus
  WHERE sports_odds_consensus.match_id = v_match_id;

  IF consensus_count <> 1 OR median_price <> 2.00 OR selected_bookmakers <> 2 THEN
    RAISE EXCEPTION 'Two-bookmaker consensus failed: rows %, median %, bookmakers %',
      consensus_count, median_price, selected_bookmakers;
  END IF;

  BEGIN
    PERFORM public.refresh_sports_odds_consensus(
      v_match_id, '2026-07-15T23:57:00Z', 1, 7
    );
    RAISE EXCEPTION 'One-bookmaker minimum was unexpectedly accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'p_min_bookmakers must be between 2 and p_max_bookmakers%' THEN
        RAISE;
      END IF;
  END;

  IF has_function_privilege(
    'anon',
    'public.refresh_sports_odds_consensus(uuid,timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.refresh_sports_odds_consensus(uuid,timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Consensus writer leaked outside service_role';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.refresh_sports_odds_consensus(uuid,timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot refresh odds consensus';
  END IF;
  IF (SELECT enabled FROM public.sports_providers WHERE code = 'highlightly') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled';
  END IF;
END
$minimum_consensus$;

ROLLBACK;
