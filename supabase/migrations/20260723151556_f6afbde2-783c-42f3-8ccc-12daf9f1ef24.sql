CREATE OR REPLACE FUNCTION public.requeue_highlightly_dead_basketball_identity_jobs(
  p_scope text,
  p_limit integer DEFAULT 1
)
RETURNS SETOF public.hl_ingestion_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_scope IS NULL OR btrim(p_scope) = '' OR length(p_scope) > 160 THEN
    RAISE EXCEPTION 'scope must contain between 1 and 160 characters';
  END IF;
  IF p_limit < 1 OR p_limit > 10 THEN
    RAISE EXCEPTION 'limit must be between 1 and 10';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly'
      AND provider.enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must be disabled before requeue';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.hl_ingestion_jobs AS active_job
    WHERE active_job.status IN ('pending', 'retry', 'running')
  ) THEN
    RAISE EXCEPTION 'active ingestion queue must be empty before requeue';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.hl_ingestion_jobs AS job
    WHERE job.shadow_scope = btrim(p_scope)
      AND job.sport = 'basketball'
      AND job.endpoint_key = 'basketball.MatchesController_getMatches'
      AND job.status = 'dead'
      AND job.last_error LIKE 'Supabase returned HTTP 409:%'
      AND job.last_error LIKE '%sports_match_participants_match_team_unique%'
      AND job.last_error LIKE '%duplicate key value violates unique constraint%'
    ORDER BY job.updated_at ASC, job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.hl_ingestion_jobs AS job
  SET
    status = 'retry',
    priority = 0,
    scheduled_at = now(),
    attempts = 0,
    max_attempts = 1,
    worker_id = NULL,
    locked_at = NULL,
    lock_expires_at = NULL,
    started_at = NULL,
    finished_at = NULL,
    request_params = jsonb_set(
      COALESCE(job.request_params, '{}'::jsonb),
      '{_fanout}',
      'false'::jsonb,
      true
    ),
    cursor_data = COALESCE(job.cursor_data, '{}'::jsonb) || jsonb_build_object(
      '_basketball_identity_requeued_at', now(),
      '_basketball_identity_prior_attempts', job.attempts,
      '_basketball_identity_prior_fanout', job.request_params -> '_fanout'
    ),
    updated_at = now()
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING job.*;
END
$function$;

REVOKE ALL ON FUNCTION public.requeue_highlightly_dead_basketball_identity_jobs(
  text,
  integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.requeue_highlightly_dead_basketball_identity_jobs(
  text,
  integer
) TO service_role;