\set ON_ERROR_STOP on

CREATE TABLE public.sports_bookmakers (
  id uuid PRIMARY KEY,
  normalized_name text NOT NULL
);

CREATE TABLE public.sports_market_definitions (
  id uuid PRIMARY KEY,
  canonical_family text NOT NULL,
  odds_type text NOT NULL
);

CREATE TABLE public.sports_odds_history (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL,
  bookmaker_id uuid NOT NULL,
  market_definition_id uuid NOT NULL,
  selection_key text NOT NULL,
  selection_name text NOT NULL,
  line_key text NOT NULL DEFAULT '',
  line_value numeric,
  decimal_odds numeric NOT NULL,
  quote_status text NOT NULL,
  is_live boolean NOT NULL,
  captured_at timestamptz NOT NULL,
  source_raw_object_id uuid
);

CREATE TABLE public.sports_odds_current (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL,
  bookmaker_id uuid NOT NULL,
  market_definition_id uuid NOT NULL,
  selection_key text NOT NULL,
  selection_name text NOT NULL,
  line_key text NOT NULL DEFAULT '',
  line_value numeric,
  decimal_odds numeric NOT NULL,
  quote_status text NOT NULL,
  is_live boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  source_raw_object_id uuid
);

CREATE TABLE public.sports_odds_consensus (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL,
  market_definition_id uuid NOT NULL,
  selection_key text NOT NULL,
  selection_name text NOT NULL,
  line_key text NOT NULL DEFAULT '',
  line_value numeric,
  median_odds numeric,
  best_odds numeric,
  minimum_odds numeric,
  iqr numeric,
  bookmaker_count integer NOT NULL,
  bookmaker_ids uuid[] NOT NULL,
  is_live boolean NOT NULL,
  snapshot_at timestamptz NOT NULL
);

\i /tmp/align_football_feature_market_families.sql

INSERT INTO public.sports_bookmakers VALUES
  ('00000000-0000-0000-0000-000000000001', 'bet365');

INSERT INTO public.sports_market_definitions VALUES
  ('10000000-0000-0000-0000-000000000001', 'moneyline', 'prematch'),
  ('10000000-0000-0000-0000-000000000002', 'total', 'prematch'),
  ('10000000-0000-0000-0000-000000000003', 'handicap', 'prematch'),
  ('10000000-0000-0000-0000-000000000004', 'both_teams_to_score', 'prematch');

INSERT INTO public.sports_odds_history VALUES
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'home', 'Home', '', NULL, 1.90, 'open', false, '2026-09-20 12:00+00', NULL),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'draw', 'Draw', '', NULL, 3.20, 'open', false, '2026-09-20 12:00+00', NULL),
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'away', 'Away', '', NULL, 4.00, 'open', false, '2026-09-20 12:00+00', NULL),
  ('20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'over', 'Over', '2.5', 2.5, 1.80, 'open', false, '2026-09-20 12:00+00', NULL),
  ('20000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'home', 'Home', '-0.5', -0.5, 1.95, 'open', false, '2026-09-20 12:00+00', NULL),
  ('20000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'yes', 'Yes', '', NULL, 1.85, 'open', false, '2026-09-20 12:00+00', NULL),
  ('20000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'home', 'Home', '', NULL, 9.99, 'open', false, '2026-09-22 12:00+00', NULL);

DO $smoke$
DECLARE
  payload jsonb;
  families text[];
BEGIN
  payload := public.build_football_odds_asof_v2(
    '30000000-0000-0000-0000-000000000001',
    '2026-09-21 00:00+00'
  );
  SELECT array_agg(DISTINCT value ->> 'market_family' ORDER BY value ->> 'market_family')
  INTO families
  FROM jsonb_array_elements(payload -> 'quotes') AS value;

  IF families <> ARRAY[
    'asian_handicap', 'both_teams_to_score', 'full_time_result', 'total_goals'
  ] THEN
    RAISE EXCEPTION 'unexpected translated families: %', families;
  END IF;
  IF jsonb_array_length(payload -> 'quotes') <> 6 THEN
    RAISE EXCEPTION 'cutoff or quote count failed: %', payload;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload -> 'quotes') AS value
    WHERE (value ->> 'decimal_odds')::numeric = 9.99
  ) THEN
    RAISE EXCEPTION 'post-cutoff quote leaked into snapshot';
  END IF;
  IF has_function_privilege('anon', 'public.build_football_odds_asof_v2(uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.build_football_odds_asof_v2(uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public client can execute internal feature builder';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.build_football_odds_asof_v2(uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute feature builder';
  END IF;
END
$smoke$;

SELECT 'football_market_family_alignment_smoke_passed' AS result;
