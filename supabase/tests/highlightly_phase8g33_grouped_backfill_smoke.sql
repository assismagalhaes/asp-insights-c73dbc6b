BEGIN;

DO $structure$
DECLARE
  preview_oid regprocedure;
  backfill_oid regprocedure;
  provider_enabled boolean;
BEGIN
  preview_oid := to_regprocedure(
    'public.get_highlightly_labeled_feature_backfill_preview_v2(integer,integer)'
  );
  backfill_oid := to_regprocedure(
    'public.backfill_highlightly_football_labeled_features_v2(integer,integer)'
  );

  IF preview_oid IS NULL OR backfill_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.3.3 functions must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = preview_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = backfill_oid) THEN
    RAISE EXCEPTION 'Phase 8G.3.3 functions must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', preview_oid, 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       preview_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       preview_oid,
       'EXECUTE'
     )
     OR has_function_privilege('anon', backfill_oid, 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       backfill_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       backfill_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Phase 8G.3.3 function privileges are invalid';
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
  feature_set_id uuid;
  label_set_id uuid;
  generated_match_one uuid := gen_random_uuid();
  generated_match_two uuid := gen_random_uuid();
  first_match_id uuid;
  target_match_id uuid;
  first_home_id uuid := gen_random_uuid();
  first_away_id uuid := gen_random_uuid();
  target_home_id uuid := gen_random_uuid();
  target_away_id uuid := gen_random_uuid();
  label_id uuid := gen_random_uuid();
  kickoff_at timestamptz := '1800-01-01 00:00:00+00';
  outcome_at timestamptz := '1800-01-01 02:00:00+00';
  preview jsonb;
  backfill_result jsonb;
  labels_before integer;
  labels_after integer;
  target_snapshot_count integer;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    IF generated_match_one < generated_match_two THEN
      first_match_id := generated_match_one;
      target_match_id := generated_match_two;
    ELSE
      first_match_id := generated_match_two;
      target_match_id := generated_match_one;
    END IF;

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

    INSERT INTO public.sports_teams (id, sport_id, name)
    VALUES
      (first_home_id, football_id, 'Phase 8G.3.3 First Home'),
      (first_away_id, football_id, 'Phase 8G.3.3 First Away'),
      (target_home_id, football_id, 'Phase 8G.3.3 Target Home'),
      (target_away_id, football_id, 'Phase 8G.3.3 Target Away');

    /*
     * The unlabeled UUID sorts first at the same kickoff. The legacy
     * one-millisecond window plus LIMIT 1 would materialize only this peer.
     */
    INSERT INTO public.sports_matches (
      id,
      sport_id,
      kickoff_at,
      status,
      provider_status,
      score_data,
      ended_at
    )
    VALUES
      (
        first_match_id,
        football_id,
        kickoff_at,
        'finished',
        'Finished',
        '{"current":"1 - 0","penalties":null}'::jsonb,
        outcome_at
      ),
      (
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
      (
        first_match_id,
        first_home_id,
        'home',
        '{"current":"1 - 0"}'::jsonb
      ),
      (
        first_match_id,
        first_away_id,
        'away',
        '{"current":"1 - 0"}'::jsonb
      ),
      (
        target_match_id,
        target_home_id,
        'home',
        '{"current":"2 - 1"}'::jsonb
      ),
      (
        target_match_id,
        target_away_id,
        'away',
        '{"current":"2 - 1"}'::jsonb
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
      target_match_id,
      label_set_id,
      'highlightly_football_postmatch.score.1.0.0',
      outcome_at,
      outcome_at,
      '{"contract_version":"phase8g.2","definition_count":18}'::jsonb,
      'valid',
      outcome_at,
      '{"provider_calls":0}'::jsonb
    );

    SELECT count(*)::integer INTO labels_before
    FROM public.hl_match_labels
    WHERE match_id = target_match_id;

    preview :=
      public.get_highlightly_labeled_feature_backfill_preview_v2(
        1,
        10
      );

    IF (preview ->> 'missing_labeled_matches')::integer <> 1
       OR (preview ->> 'kickoff_groups')::integer <> 1
       OR (preview ->> 'materializer_candidates')::integer <> 2
       OR (preview ->> 'potential_collateral_matches')::integer <> 1
       OR preview ->> 'recommendation'
         <> 'ready_for_grouped_backfill_canary'
       OR preview #>> '{safeguards,provider_calls}' <> '0' THEN
      RAISE EXCEPTION 'Phase 8G.3.3 preview failed: %', preview;
    END IF;

    backfill_result :=
      public.backfill_highlightly_football_labeled_features_v2(
        1,
        10
      );

    SELECT count(*)::integer INTO target_snapshot_count
    FROM public.hl_match_feature_snapshots AS snapshot
    WHERE snapshot.feature_set_id = feature_set_id
      AND snapshot.match_id = target_match_id
      AND snapshot.horizon_key = 't24h'
      AND snapshot.kickoff_at = kickoff_at;

    SELECT count(*)::integer INTO labels_after
    FROM public.hl_match_labels
    WHERE match_id = target_match_id;

    IF target_snapshot_count <> 1
       OR labels_before <> labels_after
       OR (
         backfill_result ->> 'labeled_matches_considered'
       )::integer <> 1
       OR (
         backfill_result ->> 'kickoff_groups_processed'
       )::integer <> 1
       OR (
         backfill_result ->> 'kickoff_groups_failed'
       )::integer <> 0
       OR (
         backfill_result ->> 'materializer_candidates_processed'
       )::integer <> 2
       OR (
         backfill_result ->> 'labeled_snapshots_created'
       )::integer <> 1
       OR (
         backfill_result ->> 'collateral_snapshots_created'
       )::integer <> 1
       OR backfill_result #>> '{safeguards,provider_calls}' <> '0'
       OR backfill_result #>> '{safeguards,labels_generated}' <> '0'
       OR backfill_result #>> '{safeguards,automatic_training}'
         <> 'false'
       OR backfill_result #>> '{safeguards,automatic_predictions}'
         <> 'false' THEN
      RAISE EXCEPTION
        'Phase 8G.3.3 grouped backfill contract failed: %',
        backfill_result;
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
