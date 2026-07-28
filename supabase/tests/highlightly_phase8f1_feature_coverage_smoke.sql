BEGIN;

DO $structure$
DECLARE
  function_definition text;
BEGIN
  IF to_regprocedure(
    'public.get_highlightly_feature_store_report_v2(text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Phase 8F.1 feature coverage report is missing';
  END IF;

  IF (
    SELECT function_row.prosecdef
    FROM pg_proc AS function_row
    WHERE function_row.oid =
      'public.get_highlightly_feature_store_report_v2(text,integer)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Phase 8F.1 report must remain SECURITY INVOKER';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_feature_store_report_v2(text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_feature_store_report_v2(text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_feature_store_report_v2(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Phase 8F.1 report privileges are invalid';
  END IF;

  SELECT pg_get_functiondef(function_row.oid)
  INTO function_definition
  FROM pg_proc AS function_row
  WHERE function_row.oid =
    'public.get_highlightly_feature_store_report_v2(text,integer)'::regprocedure;

  IF function_definition NOT LIKE '%' || quote_literal('components') || '%'
     OR function_definition NOT LIKE '%' || quote_literal('leagues') || '%'
     OR function_definition NOT LIKE '%' || quote_literal('integrity') || '%'
     OR function_definition NOT LIKE '%' || quote_literal('labels') || '%'
     OR function_definition NOT LIKE '%blocked_by_leakage%'
     OR function_definition NOT LIKE '%improve_component_coverage%'
     OR function_definition NOT LIKE '%ready_for_100_match_canary%'
     OR function_definition NOT LIKE '%' || quote_literal('automatic_training') || ', false%'
     OR function_definition NOT LIKE '%' || quote_literal('automatic_predictions') || ', false%' THEN
    RAISE EXCEPTION 'Phase 8F.1 report contract is incomplete';
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

DO $canary_invariants$
DECLARE
  blocked_count integer;
  label_count integer;
BEGIN
  SELECT count(*)::integer
  INTO blocked_count
  FROM public.hl_match_feature_snapshots AS snapshot
  JOIN public.hl_feature_sets AS feature_set
    ON feature_set.id = snapshot.feature_set_id
  JOIN public.sports AS sport ON sport.id = feature_set.sport_id
  WHERE sport.code = 'football'
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.0.0'
    AND snapshot.leakage_status = 'blocked';
  IF blocked_count <> 0 THEN
    RAISE EXCEPTION 'Football canary must not contain blocked snapshots';
  END IF;

  SELECT count(*)::integer
  INTO label_count
  FROM public.hl_match_labels;
  IF label_count <> 0 THEN
    RAISE EXCEPTION 'Phase 8F.1 must not create labels';
  END IF;
END
$canary_invariants$;

ROLLBACK;
