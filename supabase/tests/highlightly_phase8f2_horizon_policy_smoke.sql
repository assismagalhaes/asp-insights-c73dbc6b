BEGIN;

DO $structure$
DECLARE
  materializer_oid regprocedure;
  report_oid regprocedure;
  football_id uuid;
  v100 public.hl_feature_sets%ROWTYPE;
  v110 public.hl_feature_sets%ROWTYPE;
  provider_enabled boolean;
  materializer_definition text;
  report_definition text;
BEGIN
  materializer_oid := to_regprocedure(
    'public.materialize_highlightly_football_features_v2(timestamptz,timestamptz,text,integer)'
  );
  report_oid := to_regprocedure(
    'public.get_highlightly_feature_store_report_v4(text,integer)'
  );

  IF materializer_oid IS NULL OR report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8F.2 RPCs must exist';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = materializer_oid)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8F.2 RPCs must be SECURITY INVOKER';
  END IF;

  IF has_function_privilege(
       'anon',
       materializer_oid,
       'EXECUTE'
     )
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
    RAISE EXCEPTION 'Phase 8F.2 materializer privileges are invalid';
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
    RAISE EXCEPTION 'Phase 8F.2 report privileges are invalid';
  END IF;

  SELECT id INTO football_id
  FROM public.sports
  WHERE code = 'football';

  SELECT feature_set.* INTO v100
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.0.0';

  SELECT feature_set.* INTO v110
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.1.0';

  IF v100.id IS NULL OR v110.id IS NULL THEN
    RAISE EXCEPTION 'Football feature sets 1.0.0 and 1.1.0 must exist';
  END IF;
  IF v100.is_enabled OR v110.is_enabled OR v110.status <> 'draft' THEN
    RAISE EXCEPTION 'Football feature sets must remain disabled and 1.1.0 draft';
  END IF;
  IF v110.feature_spec #> '{component_policy,t24h,required}'
     <> '["home_history","away_history","home_standings","away_standings"]'::jsonb
     OR v110.feature_spec #> '{component_policy,t24h,optional}'
     <> '["prematch_odds","lineups"]'::jsonb
     OR v110.feature_spec #> '{component_policy,t6h,required}'
     <> '["home_history","away_history","home_standings","away_standings","prematch_odds"]'::jsonb
     OR v110.feature_spec #> '{component_policy,t6h,optional}'
     <> '["lineups"]'::jsonb
     OR v110.feature_spec #> '{component_policy,t60m,required}'
     <> '["home_history","away_history","home_standings","away_standings","prematch_odds","lineups"]'::jsonb
     OR v110.feature_spec #> '{component_policy,t60m,optional}'
     <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Football 1.1.0 horizon component policy is invalid';
  END IF;
  IF COALESCE(
       (v110.feature_spec ->> 'targets_separated')::boolean,
       false
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Football 1.1.0 must preserve target separation';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hl_match_feature_snapshots AS snapshot
    WHERE snapshot.feature_set_id = v110.id
  ) THEN
    RAISE EXCEPTION 'Phase 8F.2 migration must not materialize snapshots';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.hl_feature_materialization_runs AS run
    WHERE run.feature_set_id = v110.id
  ) THEN
    RAISE EXCEPTION 'Phase 8F.2 migration must not start materialization runs';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.hl_match_feature_snapshots'::regclass
      AND tgname = 'trg_hl_match_feature_snapshots_immutable'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Immutable snapshot trigger must remain active';
  END IF;

  materializer_definition := pg_get_functiondef(materializer_oid);
  report_definition := pg_get_functiondef(report_oid);
  IF position('materialize_highlightly_football_features(' IN materializer_definition) = 0
     OR position('provider_calls' IN materializer_definition) = 0
     OR position('labels_generated' IN materializer_definition) = 0
     OR position('target_match_facts_used' IN materializer_definition) = 0 THEN
    RAISE EXCEPTION 'Phase 8F.2 materializer safety contract is incomplete';
  END IF;
  IF position('policy_adjusted_average_coverage_pct' IN report_definition) = 0
     OR position('stored_average_coverage_pct' IN report_definition) = 0
     OR position('quality_contract_version' IN report_definition) = 0
     OR position('phase8f.2' IN report_definition) = 0 THEN
    RAISE EXCEPTION 'Phase 8F.2 report contract is incomplete';
  END IF;
END
$structure$;

DO $report_contract$
DECLARE
  report_payload jsonb;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    report_payload := public.get_highlightly_feature_store_report_v4(
      'football',
      30
    );
    IF report_payload ->> 'quality_contract_version' <> 'phase8f.2'
       OR COALESCE(
         (report_payload ->> 'automatic_training')::boolean,
         true
       )
       OR COALESCE(
         (report_payload ->> 'automatic_predictions')::boolean,
         true
       )
       OR jsonb_typeof(report_payload -> 'feature_set_catalog') <> 'array'
       OR jsonb_typeof(report_payload -> 'horizon_policies') <> 'object'
       OR jsonb_typeof(report_payload -> 'feature_sets') <> 'array'
       OR jsonb_typeof(report_payload -> 'components') <> 'array' THEN
      RAISE EXCEPTION 'Phase 8F.2 report payload is invalid';
    END IF;
  END IF;
END
$report_contract$;

ROLLBACK;
