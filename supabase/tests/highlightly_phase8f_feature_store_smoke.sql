BEGIN;

DO $structure$
DECLARE
  target_table text;
  function_definition text;
  feature_set_count integer;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'hl_feature_sets',
    'hl_match_feature_snapshots',
    'hl_match_labels',
    'hl_feature_materialization_runs'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      RAISE EXCEPTION 'missing Phase 8F table: %', target_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || target_table, 'SELECT') THEN
      RAISE EXCEPTION 'anon must not read Phase 8F table: %', target_table;
    END IF;
    IF NOT has_table_privilege(
      'service_role',
      'public.' || target_table,
      'INSERT'
    ) THEN
      RAISE EXCEPTION 'service_role must write Phase 8F table: %', target_table;
    END IF;
  END LOOP;

  SELECT count(*)::integer
  INTO feature_set_count
  FROM public.hl_feature_sets AS feature_set
  JOIN public.sports AS sport ON sport.id = feature_set.sport_id
  WHERE sport.code = 'football'
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.0.0'
    AND feature_set.status = 'draft'
    AND NOT feature_set.is_enabled
    AND feature_set.feature_spec ->> 'targets_separated' = 'true';
  IF feature_set_count <> 1 THEN
    RAISE EXCEPTION 'Football feature set must be installed once, disabled and draft';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.materialize_highlightly_football_features(timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.materialize_highlightly_football_features(timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.materialize_highlightly_football_features(timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Football materializer must be service_role only';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_feature_store_report(text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_feature_store_report(text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_feature_store_report(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Feature report privileges are invalid';
  END IF;

  IF (
    SELECT function_row.prosecdef
    FROM pg_proc AS function_row
    WHERE function_row.oid =
      'public.materialize_highlightly_football_features(timestamptz,timestamptz,text,integer)'::regprocedure
  ) OR (
    SELECT function_row.prosecdef
    FROM pg_proc AS function_row
    WHERE function_row.oid =
      'public.get_highlightly_feature_store_report(text,integer)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Phase 8F RPCs must remain SECURITY INVOKER';
  END IF;

  SELECT pg_get_functiondef(function_row.oid)
  INTO function_definition
  FROM pg_proc AS function_row
  WHERE function_row.oid =
    'public.materialize_highlightly_football_features(timestamptz,timestamptz,text,integer)'::regprocedure;
  IF function_definition NOT LIKE '%cutoff_at%'
     OR function_definition NOT LIKE '%target_match_facts_used%'
     OR function_definition NOT LIKE '%provider_calls%'
     OR function_definition NOT LIKE '%labels_generated%' THEN
    RAISE EXCEPTION 'Materializer is missing point-in-time safety evidence';
  END IF;

  SELECT pg_get_functiondef(function_row.oid)
  INTO function_definition
  FROM pg_proc AS function_row
  WHERE function_row.oid =
    'public.build_highlightly_football_team_features(uuid,uuid,uuid,timestamptz)'::regprocedure;
  IF function_definition NOT LIKE '%previous_match.kickoff_at < p_cutoff_at%'
     OR function_definition NOT LIKE '%team_stat.collected_at <= p_cutoff_at%'
     OR function_definition NOT LIKE '%standing.snapshot_at <= p_cutoff_at%' THEN
    RAISE EXCEPTION 'Team features must enforce point-in-time source cutoffs';
  END IF;

  IF (
    SELECT sports_provider.enabled
    FROM public.sports_providers AS sports_provider
    WHERE sports_provider.code = 'highlightly'
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;
END
$structure$;

DO $immutability$
DECLARE
  trigger_count integer;
BEGIN
  SELECT count(*)::integer
  INTO trigger_count
  FROM pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid =
      'public.hl_match_feature_snapshots'::regclass
    AND trigger_row.tgname =
      'trg_hl_match_feature_snapshots_immutable'
    AND NOT trigger_row.tgisinternal;
  IF trigger_count <> 1 THEN
    RAISE EXCEPTION 'Feature snapshot immutability trigger is missing';
  END IF;
END
$immutability$;

ROLLBACK;
