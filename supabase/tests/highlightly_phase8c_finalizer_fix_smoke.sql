BEGIN;

DO $structure$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.finalize_highlightly_shadow_window(text)'::regprocedure
  ) INTO function_definition;

  IF function_definition NOT LIKE
    '%JOIN public.hl_ingestion_runs AS ingestion_run ON ingestion_run.id = issue.run_id%'
    OR function_definition NOT LIKE
    '%JOIN public.hl_ingestion_jobs AS ingestion_job ON ingestion_job.id = ingestion_run.job_id%'
  THEN
    RAISE EXCEPTION 'finalizer join order is invalid';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.finalize_highlightly_shadow_window(text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.finalize_highlightly_shadow_window(text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.finalize_highlightly_shadow_window(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'finalizer privileges are invalid';
  END IF;
END
$structure$;

ROLLBACK;
