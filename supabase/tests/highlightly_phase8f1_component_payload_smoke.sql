BEGIN;

DO $structure$
DECLARE
  function_definition text;
BEGIN
  IF to_regprocedure(
    'public.get_highlightly_feature_store_report_v3(text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Phase 8F.1.1 report is missing';
  END IF;

  IF (
    SELECT function_row.prosecdef
    FROM pg_proc AS function_row
    WHERE function_row.oid =
      'public.get_highlightly_feature_store_report_v3(text,integer)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Phase 8F.1.1 report must remain SECURITY INVOKER';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_highlightly_feature_store_report_v3(text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_highlightly_feature_store_report_v3(text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_highlightly_feature_store_report_v3(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Phase 8F.1.1 report privileges are invalid';
  END IF;

  SELECT pg_get_functiondef(function_row.oid)
  INTO function_definition
  FROM pg_proc AS function_row
  WHERE function_row.oid =
    'public.get_highlightly_feature_store_report_v3(text,integer)'::regprocedure;

  IF function_definition NOT LIKE '%to_jsonb(component_summary)%'
     OR function_definition NOT LIKE '%availability_pct%'
     OR function_definition NOT LIKE '%available_snapshots%'
     OR function_definition NOT LIKE '%missing_snapshots%'
     OR function_definition NOT LIKE '%phase8f.1.1%' THEN
    RAISE EXCEPTION 'Structured component payload contract is incomplete';
  END IF;

  IF (
    SELECT sports_provider.enabled
    FROM public.sports_providers AS sports_provider
    WHERE sports_provider.code = 'highlightly'
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled';
  END IF;
END
$structure$;

ROLLBACK;
