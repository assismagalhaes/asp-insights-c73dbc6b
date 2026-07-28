BEGIN;

DO $structure$
DECLARE
  report_oid regprocedure;
  report_definition text;
  provider_enabled boolean;
  v110_id uuid;
BEGIN
  report_oid := to_regprocedure(
    'public.get_highlightly_feature_store_report_v5(text,integer)'
  );
  IF report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8F.2.1 report RPC must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8F.2.1 report must be SECURITY INVOKER';
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
    RAISE EXCEPTION 'Phase 8F.2.1 report privileges are invalid';
  END IF;

  report_definition := pg_get_functiondef(report_oid);
  IF position('get_highlightly_feature_store_report_v4' IN report_definition) = 0
     OR position('get_highlightly_feature_store_report_v3' IN report_definition) = 0
     OR position('jsonb_array_elements' IN report_definition) = 0
     OR position('required_for_horizon' IN report_definition) = 0
     OR position('phase8f.2.1' IN report_definition) = 0 THEN
    RAISE EXCEPTION 'Phase 8F.2.1 report contract is incomplete';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;

  SELECT feature_set.id INTO v110_id
  FROM public.hl_feature_sets AS feature_set
  JOIN public.sports AS sport ON sport.id = feature_set.sport_id
  WHERE sport.code = 'football'
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.1.0'
    AND feature_set.status = 'draft'
    AND NOT feature_set.is_enabled;

  IF v110_id IS NULL THEN
    RAISE EXCEPTION 'Football feature set 1.1.0 must remain draft and disabled';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.hl_match_feature_snapshots AS snapshot
    WHERE snapshot.feature_set_id = v110_id
  ) THEN
    RAISE EXCEPTION 'Phase 8F.2.1 migration must not materialize snapshots';
  END IF;
END
$structure$;

DO $report_contract$
DECLARE
  report_payload jsonb;
  component_payload jsonb;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    report_payload := public.get_highlightly_feature_store_report_v5(
      'football',
      30
    );
    component_payload := report_payload -> 'components';

    IF report_payload ->> 'quality_contract_version' <> 'phase8f.2.1'
       OR jsonb_typeof(component_payload) <> 'array'
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(component_payload) AS item(payload)
         WHERE jsonb_typeof(item.payload) <> 'object'
            OR NOT item.payload ? 'component'
            OR NOT item.payload ? 'available_snapshots'
            OR NOT item.payload ? 'missing_snapshots'
            OR NOT item.payload ? 'availability_pct'
            OR NOT item.payload ? 'requirement'
            OR NOT item.payload ? 'required_for_horizon'
       )
       OR COALESCE(
         (report_payload ->> 'automatic_training')::boolean,
         true
       )
       OR COALESCE(
         (report_payload ->> 'automatic_predictions')::boolean,
         true
       ) THEN
      RAISE EXCEPTION 'Phase 8F.2.1 report payload is invalid';
    END IF;
  END IF;
END
$report_contract$;

ROLLBACK;
