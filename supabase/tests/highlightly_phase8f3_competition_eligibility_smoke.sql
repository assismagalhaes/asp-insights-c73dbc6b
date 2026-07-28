BEGIN;

DO $structure$
DECLARE
  classifier_oid regprocedure;
  materializer_oid regprocedure;
  report_oid regprocedure;
  policy_rls boolean;
  football_id uuid;
  v120 public.hl_feature_sets%ROWTYPE;
  provider_enabled boolean;
  football_competitions integer;
  classified_competitions integer;
BEGIN
  IF to_regclass('public.hl_competition_feature_policies') IS NULL THEN
    RAISE EXCEPTION 'Phase 8F.3 competition policy table must exist';
  END IF;

  SELECT relrowsecurity INTO policy_rls
  FROM pg_class
  WHERE oid = 'public.hl_competition_feature_policies'::regclass;
  IF policy_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Competition policy table must have RLS enabled';
  END IF;
  IF has_table_privilege(
       'anon',
       'public.hl_competition_feature_policies',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.hl_competition_feature_policies',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.hl_competition_feature_policies',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.hl_competition_feature_policies',
       'INSERT'
     ) THEN
    RAISE EXCEPTION 'Competition policy table privileges are invalid';
  END IF;

  classifier_oid := to_regprocedure(
    'public.classify_highlightly_football_competition(text,text)'
  );
  materializer_oid := to_regprocedure(
    'public.materialize_highlightly_football_features_v3(timestamptz,timestamptz,text,integer)'
  );
  report_oid := to_regprocedure(
    'public.get_highlightly_feature_store_report_v6(text,integer)'
  );
  IF classifier_oid IS NULL OR materializer_oid IS NULL OR report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8F.3 RPCs must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = classifier_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = materializer_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8F.3 RPCs must be SECURITY INVOKER';
  END IF;

  IF has_function_privilege('anon', classifier_oid, 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated',
       classifier_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       classifier_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Competition classifier privileges are invalid';
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
    RAISE EXCEPTION 'Phase 8F.3 materializer privileges are invalid';
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
    RAISE EXCEPTION 'Phase 8F.3 report privileges are invalid';
  END IF;

  IF has_function_privilege(
       current_user,
       classifier_oid,
       'EXECUTE'
     ) THEN
    IF public.classify_highlightly_football_competition(
         'Friendlies Clubs',
         NULL
       ) <> 'friendly'
       OR public.classify_highlightly_football_competition(
         'Australia Cup',
         NULL
       ) <> 'cup'
       OR public.classify_highlightly_football_competition(
         'UEFA Champions League Women',
         NULL
       ) <> 'tournament'
       OR public.classify_highlightly_football_competition(
         'Premier League',
         NULL
       ) <> 'league'
       OR public.classify_highlightly_football_competition(
         'Unmapped Event XYZ',
         NULL
       ) <> 'unknown' THEN
      RAISE EXCEPTION 'Competition classifier contract is invalid';
    END IF;
  END IF;

  SELECT id INTO football_id
  FROM public.sports
  WHERE code = 'football';

  SELECT count(*)::integer INTO football_competitions
  FROM public.sports_competitions
  WHERE sport_id = football_id;
  SELECT count(*)::integer INTO classified_competitions
  FROM public.hl_competition_feature_policies
  WHERE sport_id = football_id;
  IF classified_competitions <> football_competitions THEN
    RAISE EXCEPTION
      'Every installed Football competition must have an auditable policy';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.hl_competition_feature_policies
    WHERE sport_id = football_id
      AND (
        (profile_key = 'league' AND standings_policy <> 'required')
        OR (profile_key <> 'league' AND standings_policy <> 'optional')
        OR (profile_key = 'unknown' AND is_model_eligible)
      )
  ) THEN
    RAISE EXCEPTION 'Competition profile policy invariants are invalid';
  END IF;

  SELECT feature_set.* INTO v120
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.2.0';
  IF v120.id IS NULL
     OR v120.status <> 'draft'
     OR v120.is_enabled
     OR v120.feature_spec ->> 'coverage_policy_version' <> 'phase8f.3'
     OR COALESCE(
       (v120.feature_spec ->> 'competition_aware')::boolean,
       false
     ) IS NOT TRUE
     OR v120.feature_spec #>> '{competition_profiles,league,standings_policy}'
       <> 'required'
     OR v120.feature_spec #>> '{competition_profiles,cup,standings_policy}'
       <> 'optional'
     OR COALESCE(
       (
         v120.feature_spec
           #>> '{competition_profiles,unknown,model_eligible}'
       )::boolean,
       true
     ) THEN
    RAISE EXCEPTION 'Football feature set 1.2.0 contract is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hl_match_feature_snapshots AS snapshot
    WHERE snapshot.feature_set_id = v120.id
  ) OR EXISTS (
    SELECT 1
    FROM public.hl_feature_materialization_runs AS run
    WHERE run.feature_set_id = v120.id
  ) THEN
    RAISE EXCEPTION 'Phase 8F.3 migration must not materialize 1.2.0';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;
END
$structure$;

DO $report_contract$
DECLARE
  report_payload jsonb;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    report_payload := public.get_highlightly_feature_store_report_v6(
      'football',
      30
    );
    IF report_payload ->> 'quality_contract_version' <> 'phase8f.3'
       OR report_payload ->> 'projected_feature_set_version' <> '1.2.0'
       OR jsonb_typeof(
         report_payload -> 'competition_profiles'
       ) <> 'array'
       OR jsonb_typeof(
         report_payload -> 'profile_components'
       ) <> 'array'
       OR jsonb_typeof(
         report_payload -> 'competition_eligibility'
       ) <> 'array'
       OR jsonb_typeof(
         report_payload -> 'classification_catalog'
       ) <> 'array'
       OR jsonb_typeof(report_payload -> 'eligibility') <> 'object'
       OR COALESCE(
         (report_payload ->> 'automatic_training')::boolean,
         true
       )
       OR COALESCE(
         (report_payload ->> 'automatic_predictions')::boolean,
         true
       ) THEN
      RAISE EXCEPTION 'Phase 8F.3 report payload is invalid';
    END IF;
  END IF;
END
$report_contract$;

ROLLBACK;
