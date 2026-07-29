BEGIN;

DO $structure$
DECLARE
  report_oid regprocedure;
  provider_enabled boolean;
  football_id uuid;
  label_set_row public.hl_label_sets%ROWTYPE;
BEGIN
  IF to_regclass(
    'public.idx_sports_matches_finished_schedule'
  ) IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.1 finished-match index must exist';
  END IF;

  report_oid := to_regprocedure(
    'public.get_highlightly_label_settlement_preview_v1('
      || 'text,integer,integer)'
  );
  IF report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.1 settlement preview must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8G.1 preview must be SECURITY INVOKER';
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
    RAISE EXCEPTION 'Phase 8G.1 preview privileges are invalid';
  END IF;

  SELECT id INTO football_id
  FROM public.sports
  WHERE code = 'football';

  SELECT label_set.* INTO label_set_row
  FROM public.hl_label_sets AS label_set
  WHERE label_set.sport_id = football_id
    AND label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0';

  IF label_set_row.id IS NULL
     OR label_set_row.status <> 'draft'
     OR label_set_row.is_enabled THEN
    RAISE EXCEPTION 'Football label set 1.0.0 must remain draft';
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
  partial_match_id uuid := gen_random_uuid();
  metric_id uuid := gen_random_uuid();
  report_payload jsonb;
  match_payload jsonb;
  label_payload jsonb;
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
      (home_id, football_id, 'Phase 8G.1 Home'),
      (away_id, football_id, 'Phase 8G.1 Away');

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
      statement_timestamp() - interval '5 minutes'
    );

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
      partial_match_id,
      football_id,
      statement_timestamp() - interval '3 hours',
      'finished',
      'Finished',
      '{"current":"1 - 0","penalties":null}'::jsonb,
      statement_timestamp() - interval '10 minutes'
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
      ),
      (
        partial_match_id,
        home_id,
        'home',
        '{"current":"1 - 0","penalties":null}'::jsonb
      ),
      (
        partial_match_id,
        away_id,
        'away',
        '{"current":"1 - 0","penalties":null}'::jsonb
      );

    INSERT INTO public.hl_metric_definitions (
      id,
      provider_id,
      sport_id,
      resource,
      provider_key,
      canonical_key,
      display_name,
      value_type
    )
    VALUES (
      metric_id,
      provider_id,
      football_id,
      'match_statistics',
      'phase8g1_corners_' || match_id::text,
      'corners',
      'Corners',
      'integer'
    );

    INSERT INTO public.sports_match_team_stats (
      match_id,
      team_id,
      metric_definition_id,
      numeric_value
    )
    VALUES
      (match_id, home_id, metric_id, 5),
      (match_id, away_id, metric_id, 4);

    INSERT INTO public.sports_match_events (
      match_id,
      sequence_key,
      event_type,
      elapsed_seconds,
      team_id
    )
    VALUES
      (match_id, '0001:home-goal', 'Goal', 600, home_id),
      (match_id, '0002:away-goal', 'Goal', 1800, away_id),
      (match_id, '0003:home-goal', 'Goal', 3600, home_id);

    SELECT count(*)::integer INTO labels_before
    FROM public.hl_match_labels;

    report_payload :=
      public.get_highlightly_label_settlement_preview_v1(
        'football',
        365,
        200
      );

    SELECT count(*)::integer INTO labels_after
    FROM public.hl_match_labels;

    IF labels_after <> labels_before THEN
      RAISE EXCEPTION 'Phase 8G.1 preview must not write labels';
    END IF;

    SELECT value INTO match_payload
    FROM jsonb_array_elements(report_payload -> 'matches')
    WHERE value ->> 'match_id' = match_id::text;

    IF match_payload IS NULL
       OR match_payload ->> 'overall_status' <> 'ready'
       OR (match_payload ->> 'ready_definitions')::integer <> 27
       OR (match_payload ->> 'home_score')::integer <> 2
       OR (match_payload ->> 'away_score')::integer <> 1
       OR (match_payload ->> 'total_corners')::numeric <> 9 THEN
      RAISE EXCEPTION 'Phase 8G.1 synthetic match preview is invalid: %',
        match_payload;
    END IF;

    SELECT value INTO match_payload
    FROM jsonb_array_elements(report_payload -> 'matches')
    WHERE value ->> 'match_id' = partial_match_id::text;

    IF match_payload IS NULL
       OR match_payload ->> 'overall_status' <> 'partial'
       OR (match_payload ->> 'ready_definitions')::integer <> 18
       OR match_payload #>> '{family_readiness,first_team_to_score,status}'
         <> 'incomplete'
       OR match_payload #>> '{family_readiness,first_team_to_score,reason}'
         <> 'goal_event_count_mismatch'
       OR match_payload #>> '{family_readiness,total_corners,status}'
         <> 'incomplete'
       OR match_payload #>> '{family_readiness,total_corners,reason}'
         <> 'corners_missing_for_one_or_both_teams' THEN
      RAISE EXCEPTION 'Phase 8G.1 partial-resource split is invalid: %',
        match_payload;
    END IF;

    SELECT value INTO match_payload
    FROM jsonb_array_elements(report_payload -> 'matches')
    WHERE value ->> 'match_id' = match_id::text;

    SELECT value INTO label_payload
    FROM jsonb_array_elements(match_payload -> 'labels_preview')
    WHERE value ->> 'label_key' = 'full_time_result';
    IF label_payload ->> 'outcome' <> 'home' THEN
      RAISE EXCEPTION 'Full-time result preview is invalid';
    END IF;

    SELECT value INTO label_payload
    FROM jsonb_array_elements(match_payload -> 'labels_preview')
    WHERE value ->> 'label_key' = 'total_goals_2_5';
    IF label_payload ->> 'outcome' <> 'over' THEN
      RAISE EXCEPTION 'Total-goals preview is invalid';
    END IF;

    SELECT value INTO label_payload
    FROM jsonb_array_elements(match_payload -> 'labels_preview')
    WHERE value ->> 'label_key' = 'both_teams_to_score';
    IF label_payload ->> 'outcome' <> 'yes' THEN
      RAISE EXCEPTION 'BTTS preview is invalid';
    END IF;

    SELECT value INTO label_payload
    FROM jsonb_array_elements(match_payload -> 'labels_preview')
    WHERE value ->> 'label_key' = 'first_team_to_score';
    IF label_payload ->> 'outcome' <> 'home' THEN
      RAISE EXCEPTION 'First-team-to-score preview is invalid';
    END IF;

    SELECT value INTO label_payload
    FROM jsonb_array_elements(match_payload -> 'labels_preview')
    WHERE value ->> 'label_key' = 'asian_handicap_home_minus_0_5';
    IF label_payload ->> 'outcome' <> 'home_cover' THEN
      RAISE EXCEPTION 'Asian-handicap preview is invalid';
    END IF;

    SELECT value INTO label_payload
    FROM jsonb_array_elements(match_payload -> 'labels_preview')
    WHERE value ->> 'label_key' = 'total_corners_8_5';
    IF label_payload ->> 'outcome' <> 'over' THEN
      RAISE EXCEPTION 'Total-corners preview is invalid';
    END IF;

    IF report_payload ->> 'quality_contract_version' <> 'phase8g.1'
       OR COALESCE(
         (report_payload #>> '{safeguards,provider_calls}')::integer,
         -1
       ) <> 0
       OR COALESCE(
         (report_payload #>> '{safeguards,labels_written}')::integer,
         -1
       ) <> 0
       OR COALESCE(
         (report_payload #>> '{safeguards,automatic_training}')::boolean,
         true
       )
       OR COALESCE(
         (report_payload #>> '{safeguards,automatic_predictions}')::boolean,
         true
       ) THEN
      RAISE EXCEPTION 'Phase 8G.1 safeguards are invalid';
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
