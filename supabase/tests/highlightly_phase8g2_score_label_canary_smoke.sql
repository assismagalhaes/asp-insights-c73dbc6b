BEGIN;

DO $structure$
DECLARE
  materializer_oid regprocedure;
  report_oid regprocedure;
  prevention_oid regprocedure;
  runs_rls boolean;
  provider_enabled boolean;
  label_set_status text;
  label_set_enabled boolean;
BEGIN
  IF to_regclass('public.hl_label_materialization_runs') IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.2 run table must exist';
  END IF;

  SELECT relrowsecurity INTO runs_rls
  FROM pg_class
  WHERE oid = 'public.hl_label_materialization_runs'::regclass;
  IF runs_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Phase 8G.2 run table must have RLS enabled';
  END IF;
  IF has_table_privilege(
       'anon',
       'public.hl_label_materialization_runs',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.hl_label_materialization_runs',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.hl_label_materialization_runs',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.hl_label_materialization_runs',
       'INSERT'
     ) THEN
    RAISE EXCEPTION 'Phase 8G.2 run table privileges are invalid';
  END IF;

  materializer_oid := to_regprocedure(
    'public.materialize_highlightly_football_score_labels_v1('
      || 'integer,integer)'
  );
  report_oid := to_regprocedure(
    'public.get_highlightly_label_materialization_report_v1('
      || 'text,integer)'
  );
  prevention_oid := to_regprocedure(
    'public.prevent_highlightly_match_label_mutation()'
  );

  IF materializer_oid IS NULL
     OR report_oid IS NULL
     OR prevention_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.2 functions must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = materializer_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = report_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = prevention_oid) THEN
    RAISE EXCEPTION 'Phase 8G.2 functions must be SECURITY INVOKER';
  END IF;

  IF has_function_privilege('anon', materializer_oid, 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       materializer_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       materializer_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Phase 8G.2 materializer privileges are invalid';
  END IF;
  IF has_function_privilege('anon', report_oid, 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated',
       report_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       report_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Phase 8G.2 report privileges are invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.hl_match_labels'::regclass
      AND tgname = 'trg_hl_match_labels_immutable'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Phase 8G.2 label immutability trigger must exist';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;

  SELECT label_set.status, label_set.is_enabled
  INTO label_set_status, label_set_enabled
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport
    ON sport.id = label_set.sport_id
   AND sport.code = 'football'
  WHERE label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0';

  IF label_set_status IS DISTINCT FROM 'draft'
     OR label_set_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Football label set must remain draft and disabled';
  END IF;
END
$structure$;

DO $contract$
DECLARE
  football_id uuid;
  provider_id uuid;
  home_id uuid := gen_random_uuid();
  away_id uuid := gen_random_uuid();
  match_id uuid := gen_random_uuid();
  external_id text := 'phase8g2-' || gen_random_uuid()::text;
  first_result jsonb;
  second_result jsonb;
  stored_label public.hl_match_labels%ROWTYPE;
  definition_count integer;
  family_count integer;
  immutable_blocked boolean := false;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    SELECT id INTO football_id
    FROM public.sports
    WHERE code = 'football';

    SELECT id INTO provider_id
    FROM public.sports_providers
    WHERE code = 'highlightly';

    INSERT INTO public.sports_teams (id, sport_id, name)
    VALUES
      (home_id, football_id, 'Phase 8G.2 Home'),
      (away_id, football_id, 'Phase 8G.2 Away');

    INSERT INTO public.sports_matches (
      id,
      sport_id,
      kickoff_at,
      status,
      provider_status,
      score_data,
      ended_at
    )
    VALUES (
      match_id,
      football_id,
      statement_timestamp() - interval '1 second',
      'finished',
      'Finished',
      '{"current":"2 - 1","penalties":null}'::jsonb,
      NULL
    );

    INSERT INTO public.sports_match_participants (
      match_id,
      team_id,
      role,
      score_data
    )
    VALUES
      (
        match_id,
        home_id,
        'home',
        '{"current":"2 - 1","penalties":null}'::jsonb
      ),
      (
        match_id,
        away_id,
        'away',
        '{"current":"2 - 1","penalties":null}'::jsonb
      );

    INSERT INTO public.sports_provider_entities (
      provider_id,
      sport_id,
      entity_type,
      external_id,
      canonical_id,
      provider_payload,
      last_seen_at
    )
    VALUES (
      provider_id,
      football_id,
      'match',
      external_id,
      match_id,
      jsonb_build_object(
        'id', external_id,
        'state', jsonb_build_object(
          'description', 'Finished',
          'score', jsonb_build_object('current', '2 - 1')
        )
      ),
      statement_timestamp()
    );

    first_result :=
      public.materialize_highlightly_football_score_labels_v1(365, 1);

    SELECT * INTO stored_label
    FROM public.hl_match_labels AS label
    WHERE label.match_id = match_id
      AND label.label_version
        = 'highlightly_football_postmatch.score.1.0.0';

    IF stored_label.id IS NULL
       OR stored_label.quality_status <> 'valid'
       OR stored_label.labels ->> 'scope' <> 'score_based'
       OR stored_label.lineage ->> 'terminal_observation_source'
         <> 'provider_finished_observation'
       OR COALESCE(
         (stored_label.lineage ->> 'provider_calls')::integer,
         -1
       ) <> 0
       OR (first_result ->> 'labels_inserted')::integer <> 1 THEN
      RAISE EXCEPTION
        'Phase 8G.2 must store one valid provider-free score label: % / %',
        stored_label,
        first_result;
    END IF;

    definition_count :=
      jsonb_array_length(stored_label.labels -> 'values');
    SELECT count(DISTINCT label_value ->> 'market_family')::integer
    INTO family_count
    FROM jsonb_array_elements(
      stored_label.labels -> 'values'
    ) AS label_value;

    IF definition_count <> 18
       OR family_count <> 4
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           stored_label.labels -> 'values'
         ) AS label_value
         WHERE label_value ->> 'market_family' IN (
           'first_team_to_score',
           'total_corners'
         )
           OR label_value ->> 'status' <> 'ready'
           OR NULLIF(label_value ->> 'outcome', '') IS NULL
       ) THEN
      RAISE EXCEPTION
        'Phase 8G.2 canary must contain exactly 18 ready score labels';
    END IF;

    second_result :=
      public.materialize_highlightly_football_score_labels_v1(365, 1);
    IF (second_result ->> 'labels_inserted')::integer <> 0
       OR (second_result ->> 'labels_skipped')::integer <> 1
       OR second_result ->> 'recommendation' <> 'idempotency_confirmed'
       OR (
         SELECT count(*)
         FROM public.hl_match_labels AS label
         WHERE label.match_id = match_id
           AND label.label_version
             = 'highlightly_football_postmatch.score.1.0.0'
       ) <> 1 THEN
      RAISE EXCEPTION
        'Phase 8G.2 materialization must be idempotent: %',
        second_result;
    END IF;

    BEGIN
      UPDATE public.hl_match_labels
      SET quality_status = 'quarantined'
      WHERE id = stored_label.id;
    EXCEPTION
      WHEN SQLSTATE '55000' THEN
        immutable_blocked := true;
    END;
    IF NOT immutable_blocked THEN
      RAISE EXCEPTION 'Stored labels must be immutable';
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
