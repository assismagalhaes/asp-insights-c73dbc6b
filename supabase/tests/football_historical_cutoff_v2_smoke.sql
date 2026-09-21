BEGIN;

DO $test$
DECLARE
  invalid_count integer;
BEGIN
  SELECT count(*)::integer
  INTO invalid_count
  FROM public.sports_seasons AS current_season
  CROSS JOIN LATERAL (
    SELECT public.resolve_previous_competition_season_v1(
      current_season.competition_id,
      current_season.id
    ) AS previous_season_id
  ) AS resolved
  JOIN public.sports_seasons AS previous_season
    ON previous_season.id = resolved.previous_season_id
  WHERE previous_season.id = current_season.id
     OR previous_season.competition_id <> current_season.competition_id
     OR (
       current_season.start_date IS NOT NULL
       AND COALESCE(previous_season.end_date, previous_season.start_date)
           >= current_season.start_date
     )
     OR (
       current_season.start_date IS NULL
       AND current_season.label ~ '^[0-9]{4}$'
       AND previous_season.label ~ '^[0-9]{4}$'
       AND previous_season.label::integer >= current_season.label::integer
     );

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'previous-season fallback violated identity or ordering';
  END IF;
END
$test$;

DO $test$
DECLARE
  target record;
  payload jsonb;
  cutoff timestamptz;
BEGIN
  SELECT participant.team_id, match_row.updated_at
  INTO target
  FROM public.sports_match_participants AS participant
  JOIN public.sports_matches AS match_row ON match_row.id = participant.match_id
  JOIN public.sports_provider_entities AS competition_entity
    ON competition_entity.entity_type = 'competition'
   AND competition_entity.canonical_id = match_row.competition_id
   AND competition_entity.external_id IN ('33973', '119924', '84182')
  JOIN public.sports_providers AS provider
    ON provider.id = competition_entity.provider_id
   AND provider.code = 'highlightly'
  WHERE match_row.status = 'finished'
    AND match_row.ended_at IS NULL
    AND match_row.score_data ->> 'current'
          ~ '^[[:space:]]*[0-9]+[[:space:]]*-[[:space:]]*[0-9]+[[:space:]]*$'
  ORDER BY match_row.updated_at DESC, match_row.id
  LIMIT 1;

  IF target.team_id IS NOT NULL THEN
    cutoff := target.updated_at + interval '1 microsecond';
    payload := public.build_football_match_window_v2(
      target.team_id, cutoff, 500, NULL, NULL
    );

    IF (payload ->> 'sample')::integer < 1 THEN
      RAISE EXCEPTION 'finished history without ended_at was not recovered';
    END IF;
    IF NULLIF(payload ->> 'source_max_at', '')::timestamptz > cutoff THEN
      RAISE EXCEPTION 'historical window leaked a source after cutoff';
    END IF;

    payload := public.build_football_match_window_v2(
      target.team_id, target.updated_at - interval '1 microsecond', 500, NULL, NULL
    );
    IF NULLIF(payload ->> 'source_max_at', '')::timestamptz
         > target.updated_at - interval '1 microsecond' THEN
      RAISE EXCEPTION 'pre-observation cutoff admitted a future source';
    END IF;
  END IF;
END
$test$;

DO $test$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.resolve_previous_competition_season_v1(uuid,uuid)',
    'public.build_football_match_window_v2(uuid,timestamp with time zone,integer,uuid,text)',
    'public.build_football_h2h_window_v2(uuid,uuid,uuid,timestamp with time zone,integer)',
    'public.build_football_league_prior_v2(uuid,uuid,timestamp with time zone)'
  ] LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE')
       OR has_function_privilege('authenticated', signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'unexpected function privilege: %', signature;
    END IF;
  END LOOP;
END
$test$;

ROLLBACK;
