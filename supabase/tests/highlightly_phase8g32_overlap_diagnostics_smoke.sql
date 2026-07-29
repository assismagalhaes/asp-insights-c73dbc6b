BEGIN;

DO $structure$
DECLARE
  diagnostic_oid regprocedure;
  provider_enabled boolean;
BEGIN
  diagnostic_oid := to_regprocedure(
    'public.get_highlightly_labeled_feature_overlap_diagnostics_v2(integer)'
  );
  IF diagnostic_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.3.2 diagnostic function must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = diagnostic_oid) THEN
    RAISE EXCEPTION 'Phase 8G.3.2 diagnostic must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', diagnostic_oid, 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       diagnostic_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       diagnostic_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Phase 8G.3.2 diagnostic privileges are invalid';
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
  label_set_id uuid;
  home_id uuid := gen_random_uuid();
  away_id uuid := gen_random_uuid();
  target_match_id uuid := gen_random_uuid();
  label_id uuid := gen_random_uuid();
  kickoff_at timestamptz := '1900-01-01 00:00:00+00';
  outcome_at timestamptz := '1900-01-01 02:00:00+00';
  report jsonb;
  target_match jsonb;
  labels_before integer;
  labels_after integer;
  snapshots_before integer;
  snapshots_after integer;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    SELECT id INTO football_id
    FROM public.sports
    WHERE code = 'football';

    SELECT id INTO label_set_id
    FROM public.hl_label_sets
    WHERE sport_id = football_id
      AND code = 'highlightly_football_postmatch'
      AND version = '1.0.0';

    INSERT INTO public.sports_teams (id, sport_id, name)
    VALUES
      (home_id, football_id, 'Phase 8G.3.2 Home'),
      (away_id, football_id, 'Phase 8G.3.2 Away');

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
    FROM public.hl_match_labels;
    SELECT count(*)::integer INTO snapshots_before
    FROM public.hl_match_feature_snapshots;

    report :=
      public.get_highlightly_labeled_feature_overlap_diagnostics_v2(200);

    SELECT match_payload
    INTO target_match
    FROM jsonb_array_elements(report -> 'matches') AS match_payload
    WHERE match_payload ->> 'match_id' = target_match_id::text;

    SELECT count(*)::integer INTO labels_after
    FROM public.hl_match_labels;
    SELECT count(*)::integer INTO snapshots_after
    FROM public.hl_match_feature_snapshots;

    IF target_match IS NULL
       OR target_match ->> 'diagnostic_reason'
         <> 'source_v100_snapshot_missing'
       OR target_match #>> '{participants,home}' <> '1'
       OR target_match #>> '{participants,away}' <> '1'
       OR report #>> '{safeguards,read_only}' <> 'true'
       OR report #>> '{safeguards,provider_calls}' <> '0'
       OR report #>> '{safeguards,database_writes}' <> '0'
       OR labels_before <> labels_after
       OR snapshots_before <> snapshots_after THEN
      RAISE EXCEPTION
        'Phase 8G.3.2 diagnostic contract failed: %',
        report;
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
