BEGIN;

DO $structure$
DECLARE
  report_oid regprocedure;
  provider_enabled boolean;
  policy jsonb;
BEGIN
  report_oid := to_regprocedure(
    'public.get_highlightly_label_settlement_preview_v2('
      || 'text,integer,integer)'
  );
  IF report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.1.1 settlement preview must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8G.1.1 preview must be SECURITY INVOKER';
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
    RAISE EXCEPTION 'Phase 8G.1.1 preview privileges are invalid';
  END IF;

  SELECT label_set.outcome_policy INTO policy
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport
    ON sport.id = label_set.sport_id
   AND sport.code = 'football'
  WHERE label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0';

  IF COALESCE((policy ->> 'requires_ended_at')::boolean, true)
     OR NOT COALESCE(
       (policy ->> 'requires_terminal_observation_at')::boolean,
       false
     )
     OR policy #>> '{provider_observation_requirements,state_description}'
       <> 'Finished'
     OR NOT COALESCE(
       (
         policy
           #>> '{provider_observation_requirements,score_must_match_canonical}'
       )::boolean,
       false
     ) THEN
    RAISE EXCEPTION 'Phase 8G.1.1 outcome policy is invalid: %',
      policy;
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
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
  external_id text := 'phase8g11-' || gen_random_uuid()::text;
  report_payload jsonb;
  match_payload jsonb;
  labels_before integer;
  labels_after integer;
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
      (home_id, football_id, 'Phase 8G.1.1 Home'),
      (away_id, football_id, 'Phase 8G.1.1 Away');

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
      statement_timestamp() - interval '2 hours',
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
      statement_timestamp() - interval '5 minutes'
    );

    SELECT count(*)::integer INTO labels_before
    FROM public.hl_match_labels;

    report_payload :=
      public.get_highlightly_label_settlement_preview_v2(
        'football',
        365,
        200
      );

    SELECT count(*)::integer INTO labels_after
    FROM public.hl_match_labels;

    IF labels_after <> labels_before THEN
      RAISE EXCEPTION 'Phase 8G.1.1 preview must not write labels';
    END IF;

    SELECT value INTO match_payload
    FROM jsonb_array_elements(report_payload -> 'matches')
    WHERE value ->> 'match_id' = match_id::text;

    IF match_payload IS NULL
       OR match_payload ->> 'overall_status' <> 'partial'
       OR (match_payload ->> 'ready_definitions')::integer <> 18
       OR match_payload ->> 'base_block_reason' IS NOT NULL
       OR match_payload ->> 'terminal_observation_source'
         <> 'provider_finished_observation'
       OR match_payload ->> 'terminal_observed_at' IS NULL
       OR match_payload #>> '{family_readiness,full_time_result,status}'
         <> 'ready'
       OR match_payload #>> '{family_readiness,first_team_to_score,status}'
         <> 'incomplete'
       OR match_payload #>> '{family_readiness,total_corners,status}'
         <> 'incomplete' THEN
      RAISE EXCEPTION
        'Verified Finished observation must unlock score labels only: %',
        match_payload;
    END IF;

    IF report_payload ->> 'quality_contract_version'
         <> 'phase8g.1.1'
       OR COALESCE(
         (report_payload #>> '{safeguards,provider_calls}')::integer,
         -1
       ) <> 0
       OR COALESCE(
         (report_payload #>> '{safeguards,labels_written}')::integer,
         -1
       ) <> 0 THEN
      RAISE EXCEPTION 'Phase 8G.1.1 safeguards are invalid';
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
