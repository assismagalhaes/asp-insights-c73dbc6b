CREATE OR REPLACE FUNCTION public.finalize_highlightly_shadow_window(
  p_scope text
)
RETURNS public.hl_shadow_windows
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  window_result public.hl_shadow_windows;
  dead_count integer := 0;
  critical_count integer := 0;
BEGIN
  IF p_scope IS NULL OR btrim(p_scope) = '' OR length(p_scope) > 160 THEN
    RAISE EXCEPTION 'scope must contain between 1 and 160 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly' AND provider.enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must be disabled before finalization';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.hl_ingestion_jobs AS ingestion_job
    WHERE ingestion_job.shadow_scope = btrim(p_scope)
      AND ingestion_job.status IN ('pending', 'retry', 'running')
  ) THEN
    RAISE EXCEPTION 'scope still contains active ingestion jobs';
  END IF;

  SELECT count(*)::integer
  INTO dead_count
  FROM public.hl_ingestion_jobs AS ingestion_job
  WHERE ingestion_job.shadow_scope = btrim(p_scope)
    AND ingestion_job.status = 'dead';

  SELECT count(*)::integer
  INTO critical_count
  FROM public.hl_data_quality_issues AS issue
  JOIN public.hl_ingestion_runs AS ingestion_run ON ingestion_run.id = issue.run_id
  JOIN public.hl_ingestion_jobs AS ingestion_job ON ingestion_job.id = ingestion_run.job_id
  WHERE ingestion_job.shadow_scope = btrim(p_scope)
    AND issue.severity = 'critical'
    AND issue.resolution_status = 'open';

  UPDATE public.hl_shadow_windows AS window_row
  SET
    status = CASE
      WHEN dead_count > 0 OR critical_count > 0 THEN 'completed_with_exceptions'
      ELSE 'passed'
    END,
    ended_at = COALESCE(window_row.ended_at, now()),
    config = jsonb_set(
      jsonb_set(
        jsonb_set(
          window_row.config,
          '{window_kind}',
          to_jsonb(
            COALESCE(
              NULLIF(window_row.config ->> 'window_kind', ''),
              CASE
                WHEN window_row.scope LIKE 'future-%' THEN 'future'
                WHEN window_row.scope LIKE 'phase7-%' THEN 'historical'
                ELSE 'shadow'
              END
            )
          ),
          true
        ),
        '{current_slice,status}',
        '"completed"'::jsonb,
        true
      ),
      '{completion}',
      jsonb_build_object(
        'completedAt', now(),
        'deadJobs', dead_count,
        'openCriticalIssues', critical_count
      ),
      true
    ),
    updated_at = now()
  WHERE window_row.scope = btrim(p_scope)
  RETURNING * INTO window_result;

  IF window_result.id IS NULL THEN
    RAISE EXCEPTION 'unknown Highlightly shadow scope: %', btrim(p_scope);
  END IF;

  RETURN window_result;
END
$function$;

REVOKE ALL ON FUNCTION public.finalize_highlightly_shadow_window(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_highlightly_shadow_window(text)
  TO service_role;

NOTIFY pgrst, 'reload schema';