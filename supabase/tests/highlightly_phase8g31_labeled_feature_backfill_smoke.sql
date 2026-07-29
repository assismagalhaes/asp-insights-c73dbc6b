BEGIN;

DO $structure$
DECLARE
  preview_oid regprocedure;
  backfill_oid regprocedure;
  provider_enabled boolean;
BEGIN
  preview_oid := to_regprocedure(
    'public.get_highlightly_labeled_feature_backfill_preview_v1(integer)'
  );
  backfill_oid := to_regprocedure(
    'public.backfill_highlightly_football_labeled_features_v1(integer)'
  );

  IF preview_oid IS NULL OR backfill_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.3.1 functions must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = preview_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = backfill_oid) THEN
    RAISE EXCEPTION 'Phase 8G.3.1 functions must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', preview_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', preview_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', preview_oid, 'EXECUTE')
     OR has_function_privilege('anon', backfill_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', backfill_oid, 'EXECUTE')
     OR NOT has_function_privilege(
       'service_role',
       backfill_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Phase 8G.3.1 function privileges are invalid';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hl_feature_sets AS feature_set
    JOIN public.sports AS sport
      ON sport.id = feature_set.sport_id
     AND sport.code = 'football'
    WHERE feature_set.code = 'highlightly_football_prematch'
      AND feature_set.version = '1.2.0'
      AND (
        feature_set.status <> 'draft'
        OR feature_set.is_enabled
      )
  ) THEN
    RAISE EXCEPTION 'Football feature set 1.2.0 must remain draft/disabled';
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
  target_match_id uuid := gen_random_uuid();
  label_id uuid := gen_random_uuid();
  kickoff_at timestamptz := '2001-01-01 00:00:00+00';
  outcome_at timestamptz := '2001-01-01 02:00:00+00';
  label_values jsonb;
  preview jsonb;
  backfill_result jsonb;
  labels_before integer;
  labels_after integer;
  snapshot_count integer;
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

    INSERT INTO public.sports_teams (id, sport_id, name)
    VALUES
      (home_id, football_id, 'Phase 8G.3.1 Home'),
      (away_id, football_id, 'Phase 8G.3.1 Away');

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
      target_match_id,
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
      (target_match_id, home_id, 'home', '{"current":"2 - 1"}'::jsonb),
      (target_match_id, away_id, 'away', '{"current":"2 - 1"}'::jsonb);

    INSERT INTO public.hl_match_labels (
      id,
      target_match_id,
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

    SELECT count(*)::integer INTO labels_before
    FROM public.hl_match_labels AS label
    WHERE label.match_id = target_match_id;

    preview :=
      public.get_highlightly_labeled_feature_backfill_preview_v1(1);
    IF (preview ->> 'matches_missing_snapshot')::integer <> 1
       OR preview ->> 'recommendation'
         <> 'ready_for_labeled_feature_backfill_canary'
       OR COALESCE(
         (preview #>> '{safeguards,provider_calls}')::integer,
         -1
       ) <> 0 THEN
      RAISE EXCEPTION 'Phase 8G.3.1 preview failed: %', preview;
    END IF;

    backfill_result :=
      public.backfill_highlightly_football_labeled_features_v1(1);

    SELECT count(*)::integer INTO snapshot_count
    FROM public.hl_match_feature_snapshots AS snapshot
    WHERE snapshot.feature_set_id = feature_set_id
      AND snapshot.match_id = target_match_id
      AND snapshot.horizon_key = 't24h'
      AND snapshot.kickoff_at = kickoff_at;

    SELECT count(*)::integer INTO labels_after
    FROM public.hl_match_labels AS label
    WHERE label.match_id = target_match_id;

    IF snapshot_count <> 1
       OR labels_before <> labels_after
       OR (backfill_result ->> 'matches_considered')::integer <> 1
       OR (backfill_result ->> 'matches_processed')::integer <> 1
       OR (backfill_result ->> 'matches_failed')::integer <> 0
       OR (backfill_result ->> 'snapshots_created')::integer <> 1
       OR COALESCE(
         (backfill_result #>> '{safeguards,provider_calls}')::integer,
         -1
       ) <> 0
       OR backfill_result #>> '{safeguards,labels_generated}' <> '0'
       OR backfill_result #>> '{safeguards,automatic_training}' <> 'false'
       OR backfill_result #>> '{safeguards,automatic_predictions}'
         <> 'false' THEN
      RAISE EXCEPTION
        'Phase 8G.3.1 must create one provider-free snapshot: %',
        backfill_result;
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
