BEGIN;

DO $test$
DECLARE
  target_id uuid;
  policy jsonb;
  definition_count integer;
  handicap_count integer;
  invalid_handicap_count integer;
  double_chance_count integer;
BEGIN
  SELECT label_set.id, label_set.outcome_policy
  INTO target_id, policy
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport ON sport.id = label_set.sport_id
  WHERE sport.code = 'football'
    AND label_set.code = 'highlightly_football_postmatch_mvp'
    AND label_set.version = '2.0.0';

  IF target_id IS NULL THEN
    RAISE EXCEPTION 'MVP label set v2 was not created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hl_label_sets
    WHERE id = target_id
      AND (status <> 'draft' OR is_enabled)
  ) THEN
    RAISE EXCEPTION 'MVP label set must remain draft and disabled';
  END IF;

  SELECT count(*) INTO definition_count
  FROM public.hl_label_definitions
  WHERE label_set_id = target_id;

  IF definition_count <> 19 THEN
    RAISE EXCEPTION 'Expected 19 MVP definitions, found %', definition_count;
  END IF;

  SELECT count(*) INTO handicap_count
  FROM public.hl_label_definitions
  WHERE label_set_id = target_id
    AND market_family = 'asian_handicap';

  IF handicap_count <> 12 THEN
    RAISE EXCEPTION 'Expected 12 half-line handicaps, found %', handicap_count;
  END IF;

  SELECT count(*) INTO invalid_handicap_count
  FROM public.hl_label_definitions
  WHERE label_set_id = target_id
    AND market_family = 'asian_handicap'
    AND (
      abs(line_value) NOT IN (0.5, 1.5, 2.5, 3.5, 4.5, 5.5)
      OR abs(line_value * 2) % 2 <> 1
    );

  IF invalid_handicap_count <> 0 THEN
    RAISE EXCEPTION 'Unsupported handicap lines found: %', invalid_handicap_count;
  END IF;

  SELECT count(*) INTO double_chance_count
  FROM public.hl_label_definitions
  WHERE label_set_id = target_id
    AND (
      market_family = 'double_chance'
      OR label_key IN ('1x', 'x2', '12')
    );

  IF double_chance_count <> 0 THEN
    RAISE EXCEPTION 'Double chance must not have actionable definitions';
  END IF;

  IF policy #>> '{market_availability,double_chance}'
       <> 'blocked_provider_not_offered'
     OR policy #>> '{double_chance,blocking_code}'
       <> 'DOUBLE_CHANCE_PRICE_MISSING'
     OR (policy #>> '{double_chance,synthetic_price_forbidden}')::boolean
       IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Double chance blocking policy is incomplete';
  END IF;
END
$test$;

ROLLBACK;
