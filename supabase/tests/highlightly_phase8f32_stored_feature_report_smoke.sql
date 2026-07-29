BEGIN;

DO $structure$
DECLARE
  report_oid regprocedure;
  provider_enabled boolean;
  football_id uuid;
  v120 public.hl_feature_sets%ROWTYPE;
BEGIN
  IF to_regclass(
    'public.idx_hl_match_feature_snapshots_report'
  ) IS NULL THEN
    RAISE EXCEPTION 'Phase 8F.3.2 report index must exist';
  END IF;

  report_oid := to_regprocedure(
    'public.get_highlightly_feature_store_report_v7(text,integer)'
  );
  IF report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8F.3.2 report RPC must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8F.3.2 report must be SECURITY INVOKER';
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
    RAISE EXCEPTION 'Phase 8F.3.2 report privileges are invalid';
  END IF;

  SELECT id INTO football_id
  FROM public.sports
  WHERE code = 'football';

  SELECT feature_set.* INTO v120
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.2.0';
  IF v120.id IS NULL OR v120.status <> 'draft' OR v120.is_enabled THEN
    RAISE EXCEPTION 'Football feature set 1.2.0 must remain draft';
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
  report_payload jsonb;
  feature_row jsonb;
  snapshots_before integer;
  snapshots_after integer;
  runs_before integer;
  runs_after integer;
  labels_before integer;
  labels_after integer;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    SELECT count(*)::integer INTO snapshots_before
    FROM public.hl_match_feature_snapshots AS snapshot
    JOIN public.hl_feature_sets AS feature_set
      ON feature_set.id = snapshot.feature_set_id
    WHERE feature_set.version = '1.2.0';

    SELECT count(*)::integer INTO runs_before
    FROM public.hl_feature_materialization_runs AS run
    JOIN public.hl_feature_sets AS feature_set
      ON feature_set.id = run.feature_set_id
    WHERE feature_set.version = '1.2.0';

    SELECT count(*)::integer INTO labels_before
    FROM public.hl_match_labels;

    report_payload := public.get_highlightly_feature_store_report_v7(
      'football',
      365
    );

    SELECT count(*)::integer INTO snapshots_after
    FROM public.hl_match_feature_snapshots AS snapshot
    JOIN public.hl_feature_sets AS feature_set
      ON feature_set.id = snapshot.feature_set_id
    WHERE feature_set.version = '1.2.0';

    SELECT count(*)::integer INTO runs_after
    FROM public.hl_feature_materialization_runs AS run
    JOIN public.hl_feature_sets AS feature_set
      ON feature_set.id = run.feature_set_id
    WHERE feature_set.version = '1.2.0';

    SELECT count(*)::integer INTO labels_after
    FROM public.hl_match_labels;

    IF snapshots_after <> snapshots_before
       OR runs_after <> runs_before
       OR labels_after <> labels_before THEN
      RAISE EXCEPTION 'Phase 8F.3.2 report must be read-only';
    END IF;

    IF report_payload ->> 'quality_contract_version' <> 'phase8f.3.2'
       OR report_payload ->> 'recommendation_source'
         <> 'stored_v120_competition_aware'
       OR jsonb_typeof(
         report_payload -> 'feature_sets'
       ) <> 'array'
       OR jsonb_typeof(
         report_payload -> 'competition_profiles'
       ) <> 'array'
       OR jsonb_typeof(
         report_payload -> 'profile_components'
       ) <> 'array'
       OR jsonb_typeof(
         report_payload -> 'eligibility_reasons'
       ) <> 'array'
       OR jsonb_typeof(
         report_payload -> 'stored_v120'
       ) <> 'object'
       OR jsonb_typeof(
         report_payload -> 'projected_v120'
       ) <> 'object'
       OR COALESCE(
         (report_payload ->> 'automatic_training')::boolean,
         true
       )
       OR COALESCE(
         (report_payload ->> 'automatic_predictions')::boolean,
         true
       ) THEN
      RAISE EXCEPTION 'Phase 8F.3.2 report payload is invalid';
    END IF;

    IF (report_payload #>> '{eligibility,snapshots}')::integer <> 100
       OR (
         report_payload
           #>> '{eligibility,model_eligible_snapshots}'
       )::integer <> 70
       OR (
         report_payload #>> '{eligibility,model_eligible_pct}'
       )::numeric <> 70.00
       OR (
         report_payload #>> '{eligibility,unclassified_snapshots}'
       )::integer <> 0
       OR report_payload #>> '{eligibility,recommendation}'
         <> 'ready_for_feature_review' THEN
      RAISE EXCEPTION
        'Stored Football 1.2.0 eligibility must resolve to feature review';
    END IF;

    SELECT value INTO feature_row
    FROM jsonb_array_elements(
      report_payload -> 'feature_sets'
    )
    WHERE value ->> 'version' = '1.2.0'
      AND value ->> 'horizon_key' = 't24h';

    IF feature_row IS NULL
       OR (feature_row ->> 'snapshots')::integer <> 100
       OR feature_row ->> 'recommendation'
         <> 'ready_for_feature_review'
       OR (
         feature_row
           ->> 'competition_aware_average_coverage_pct'
       )::numeric <> 77.75 THEN
      RAISE EXCEPTION
        'Corrected Football 1.2.0 feature-set summary is invalid';
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
