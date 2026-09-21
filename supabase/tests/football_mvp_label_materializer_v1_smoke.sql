BEGIN;

DO $test$
DECLARE
  target_match_id uuid;
  result jsonb;
  stored public.hl_match_labels%ROWTYPE;
  distinct_keys integer;
BEGIN
  SELECT match_row.id
  INTO target_match_id
  FROM public.sports_matches AS match_row
  JOIN public.sports_provider_entities AS competition_entity
    ON competition_entity.entity_type = 'competition'
   AND competition_entity.canonical_id = match_row.competition_id
   AND competition_entity.external_id IN ('33973', '119924', '84182')
  JOIN public.sports_providers AS provider
    ON provider.id = competition_entity.provider_id
   AND provider.code = 'highlightly'
  JOIN public.sports_match_participants AS home
    ON home.match_id = match_row.id AND home.role = 'home'
  JOIN public.sports_match_participants AS away
    ON away.match_id = match_row.id AND away.role = 'away'
   AND away.team_id <> home.team_id
  WHERE match_row.status = 'finished'
    AND match_row.updated_at <= statement_timestamp()
    AND match_row.score_data ->> 'current'
          ~ '^[[:space:]]*[0-9]+[[:space:]]*-[[:space:]]*[0-9]+[[:space:]]*$'
    AND NOT EXISTS (
      SELECT 1
      FROM public.hl_match_labels AS label
      WHERE label.match_id = match_row.id
        AND label.label_version =
          'highlightly_football_postmatch_mvp.2.0.0'
    )
  ORDER BY match_row.updated_at DESC, match_row.id
  LIMIT 1;

  IF target_match_id IS NOT NULL THEN
    result := public.materialize_football_mvp_labels_v1(
      ARRAY[target_match_id]
    );

    IF (result ->> 'requested')::integer <> 1
       OR (result ->> 'eligible')::integer <> 1
       OR (result ->> 'inserted')::integer <> 1
       OR (result ->> 'provider_calls')::integer <> 0 THEN
      RAISE EXCEPTION 'unexpected materialization result: %', result;
    END IF;

    SELECT label.* INTO stored
    FROM public.hl_match_labels AS label
    WHERE label.match_id = target_match_id
      AND label.label_version =
        'highlightly_football_postmatch_mvp.2.0.0';

    SELECT count(DISTINCT value ->> 'label_key')::integer
    INTO distinct_keys
    FROM jsonb_array_elements(stored.labels -> 'values') AS values(value);

    IF stored.id IS NULL
       OR stored.quality_status <> 'valid'
       OR stored.label_set_id IS NULL
       OR jsonb_array_length(stored.labels -> 'values') <> 19
       OR distinct_keys <> 19
       OR stored.source_data_max_at > stored.label_available_at THEN
      RAISE EXCEPTION 'stored MVP label violates contract';
    END IF;

    result := public.materialize_football_mvp_labels_v1(
      ARRAY[target_match_id, target_match_id]
    );
    IF (result ->> 'requested')::integer <> 1
       OR (result ->> 'inserted')::integer <> 0 THEN
      RAISE EXCEPTION 'materializer is not idempotent: %', result;
    END IF;
  END IF;
END
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.materialize_football_mvp_labels_v1(NULL);
    RAISE EXCEPTION 'null match list should have failed';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;

  IF has_function_privilege(
       'anon', 'public.materialize_football_mvp_labels_v1(uuid[])', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.materialize_football_mvp_labels_v1(uuid[])',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.materialize_football_mvp_labels_v1(uuid[])',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'unexpected MVP label materializer privileges';
  END IF;
END
$test$;

ROLLBACK;
