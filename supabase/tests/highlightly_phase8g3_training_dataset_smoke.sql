BEGIN;

DO $structure$
DECLARE
  evaluate_oid regprocedure;
  preview_oid regprocedure;
  build_oid regprocedure;
  report_oid regprocedure;
  target_table text;
  provider_enabled boolean;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'hl_training_dataset_specs',
    'hl_training_dataset_build_runs',
    'hl_training_dataset_rows'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      RAISE EXCEPTION 'Phase 8G.3 table % must exist', target_table;
    END IF;
    IF NOT (
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = to_regclass('public.' || target_table)
    ) THEN
      RAISE EXCEPTION 'Phase 8G.3 table % must have RLS', target_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || target_table, 'SELECT')
       OR NOT has_table_privilege(
         'authenticated',
         'public.' || target_table,
         'SELECT'
       )
       OR has_table_privilege(
         'authenticated',
         'public.' || target_table,
         'INSERT'
       )
       OR NOT has_table_privilege(
         'service_role',
         'public.' || target_table,
         'INSERT'
       ) THEN
      RAISE EXCEPTION
        'Phase 8G.3 table % privileges are invalid',
        target_table;
    END IF;
  END LOOP;

  evaluate_oid := to_regprocedure(
    'public.evaluate_highlightly_football_training_dataset_v1('
      || 'timestamp with time zone,timestamp with time zone,integer)'
  );
  preview_oid := to_regprocedure(
    'public.get_highlightly_training_dataset_preview_v1('
      || 'timestamp with time zone,timestamp with time zone,integer)'
  );
  build_oid := to_regprocedure(
    'public.build_highlightly_football_training_dataset_v1('
      || 'timestamp with time zone,timestamp with time zone,integer)'
  );
  report_oid := to_regprocedure(
    'public.get_highlightly_training_dataset_report_v1(text,integer)'
  );

  IF evaluate_oid IS NULL
     OR preview_oid IS NULL
     OR build_oid IS NULL
     OR report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.3 functions must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = evaluate_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = preview_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = build_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8G.3 functions must be SECURITY INVOKER';
  END IF;

  IF has_function_privilege('anon', build_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', build_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', build_oid, 'EXECUTE')
     OR has_function_privilege('anon', preview_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', preview_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', preview_oid, 'EXECUTE')
     OR has_function_privilege('anon', report_oid, 'EXECUTE')
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
    RAISE EXCEPTION 'Phase 8G.3 function privileges are invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.hl_training_dataset_rows'::regclass
      AND tgname = 'trg_hl_training_dataset_rows_immutable'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Phase 8G.3 dataset rows must be immutable';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.hl_training_dataset_specs AS dataset_spec
    JOIN public.sports AS sport
      ON sport.id = dataset_spec.sport_id
     AND sport.code = 'football'
    WHERE dataset_spec.code = 'highlightly_football_prematch_score'
      AND dataset_spec.version = '1.0.0'
      AND dataset_spec.status = 'draft'
      AND NOT dataset_spec.is_enabled
      AND dataset_spec.horizon_key = 't24h'
  ) THEN
    RAISE EXCEPTION 'Football dataset spec must be draft and disabled';
  END IF;
END
$structure$;

DO $contract$
DECLARE
  football_id uuid;
  feature_set_id uuid;
  label_set_id uuid;
  home_id uuid := gen_random_uuid();
  away_id uuid := gen_random_uuid();
  match_id uuid := gen_random_uuid();
  snapshot_id uuid := gen_random_uuid();
  label_id uuid := gen_random_uuid();
  cutoff_at timestamptz := '1999-12-31 00:00:00+00';
  kickoff_at timestamptz := '2000-01-01 00:00:00+00';
  outcome_at timestamptz := '2000-01-01 02:00:00+00';
  label_values jsonb;
  preview jsonb;
  build_result jsonb;
  report jsonb;
  target_run_id uuid;
  stored_row public.hl_training_dataset_rows%ROWTYPE;
  immutable_blocked boolean := false;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    SELECT id INTO football_id
    FROM public.sports
    WHERE code = 'football';

    SELECT id INTO feature_set_id
    FROM public.hl_feature_sets
    WHERE sport_id = football_id
      AND code = 'highlightly_football_prematch'
      AND version = '1.2.0';

    SELECT id INTO label_set_id
    FROM public.hl_label_sets
    WHERE sport_id = football_id
      AND code = 'highlightly_football_postmatch'
      AND version = '1.0.0';

    SELECT jsonb_agg(
      jsonb_build_object(
        'label_key', definition.label_key,
        'market_family', definition.market_family,
        'line_value', definition.line_value,
        'status', 'ready',
        'outcome', 'smoke'
      )
      ORDER BY
        definition.market_family,
        definition.line_value NULLS FIRST,
        definition.label_key
    )
    INTO label_values
    FROM public.hl_label_definitions AS definition
    WHERE definition.label_set_id = label_set_id
      AND definition.market_family IN (
        'full_time_result',
        'total_goals',
        'both_teams_to_score',
        'asian_handicap'
      );

    IF jsonb_array_length(label_values) <> 18 THEN
      RAISE EXCEPTION 'Smoke requires the 18 score definitions';
    END IF;

    INSERT INTO public.sports_teams (id, sport_id, name)
    VALUES
      (home_id, football_id, 'Phase 8G.3 Home'),
      (away_id, football_id, 'Phase 8G.3 Away');

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
      kickoff_at,
      'finished',
      'Finished',
      '{"current":"2 - 1","penalties":null}'::jsonb,
      outcome_at
    );

    INSERT INTO public.sports_match_participants (
      match_id,
      team_id,
      role,
      score_data
    )
    VALUES
      (match_id, home_id, 'home', '{"current":"2 - 1"}'::jsonb),
      (match_id, away_id, 'away', '{"current":"2 - 1"}'::jsonb);

    INSERT INTO public.hl_match_feature_snapshots (
      id,
      feature_set_id,
      match_id,
      horizon_key,
      cutoff_at,
      kickoff_at,
      features,
      lineage,
      quality,
      coverage_pct,
      leakage_status
    )
    VALUES (
      snapshot_id,
      feature_set_id,
      match_id,
      't24h',
      cutoff_at,
      kickoff_at,
      '{"schema_version":"1.2.0"}'::jsonb,
      jsonb_build_object(
        'target_match_facts_used', false,
        'home_source_max_at', cutoff_at - interval '1 hour',
        'away_source_max_at', cutoff_at - interval '1 hour',
        'odds_source_max_at', cutoff_at - interval '1 hour',
        'lineup_source_max_at', cutoff_at - interval '1 hour'
      ),
      jsonb_build_object(
        'competition_profile', 'league',
        'model_eligible', true,
        'eligibility_reason', 'eligible'
      ),
      100,
      'clean'
    );

    INSERT INTO public.hl_match_labels (
      id,
      match_id,
      label_set_id,
      label_version,
      outcome_at,
      label_available_at,
      labels,
      quality_status,
      source_data_max_at,
      lineage
    )
    VALUES (
      label_id,
      match_id,
      label_set_id,
      'highlightly_football_postmatch.score.1.0.0',
      outcome_at,
      outcome_at,
      jsonb_build_object(
        'contract_version', 'phase8g.2',
        'scope', 'score_based',
        'definition_count', 18,
        'values', label_values
      ),
      'valid',
      outcome_at,
      '{"provider_calls":0}'::jsonb
    );

    preview := public.get_highlightly_training_dataset_preview_v1(
      '1999-12-31 00:00:00+00',
      '2000-01-02 00:00:00+00',
      10
    );
    IF (preview ->> 'matches_considered')::integer <> 1
       OR (preview ->> 'rows_eligible')::integer <> 1
       OR (preview ->> 'rows_blocked')::integer <> 0
       OR preview ->> 'recommendation' <> 'review_small_dataset_canary'
       OR COALESCE(
         (preview #>> '{safeguards,provider_calls}')::integer,
         -1
       ) <> 0 THEN
      RAISE EXCEPTION 'Phase 8G.3 preview contract failed: %', preview;
    END IF;

    build_result :=
      public.build_highlightly_football_training_dataset_v1(
        '1999-12-31 00:00:00+00',
        '2000-01-02 00:00:00+00',
        10
      );

    target_run_id := (build_result ->> 'build_run_id')::uuid;
    SELECT * INTO stored_row
    FROM public.hl_training_dataset_rows AS dataset_row
    WHERE dataset_row.build_run_id = target_run_id;

    IF stored_row.id IS NULL
       OR stored_row.match_id <> match_id
       OR stored_row.feature_snapshot_id <> snapshot_id
       OR stored_row.label_id <> label_id
       OR stored_row.split_key <> 'train'
       OR stored_row.feature_cutoff_at >= stored_row.kickoff_at
       OR stored_row.kickoff_at > stored_row.outcome_at
       OR (build_result ->> 'rows_inserted')::integer <> 1
       OR COALESCE(
         (build_result #>> '{safeguards,provider_calls}')::integer,
         -1
       ) <> 0 THEN
      RAISE EXCEPTION
        'Phase 8G.3 build must persist one clean temporal row: % / %',
        stored_row,
        build_result;
    END IF;

    report := public.get_highlightly_training_dataset_report_v1(
      'football',
      365
    );
    IF report #>> '{integrity,provider_disabled}' <> 'true'
       OR report #>> '{integrity,provider_calls_zero}' <> 'true'
       OR COALESCE(
         (report #>> '{integrity,temporal_violations}')::integer,
         -1
       ) <> 0
       OR COALESCE(
         (report #>> '{integrity,lineage_violations}')::integer,
         -1
       ) <> 0 THEN
      RAISE EXCEPTION 'Phase 8G.3 report integrity failed: %', report;
    END IF;

    BEGIN
      UPDATE public.hl_training_dataset_rows
      SET split_key = 'test'
      WHERE id = stored_row.id;
    EXCEPTION
      WHEN SQLSTATE '55000' THEN
        immutable_blocked := true;
    END;
    IF NOT immutable_blocked THEN
      RAISE EXCEPTION 'Training dataset rows must be immutable';
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
