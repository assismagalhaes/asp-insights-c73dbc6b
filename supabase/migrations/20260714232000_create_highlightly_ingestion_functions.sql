-- Highlightly Phase 1: service-role-only queue functions.

CREATE OR REPLACE FUNCTION public.enqueue_highlightly_ingestion_job(
  p_endpoint_key text,
  p_sport text,
  p_resource text,
  p_dedupe_key text,
  p_request_params jsonb DEFAULT '{}'::jsonb,
  p_cursor_data jsonb DEFAULT '{}'::jsonb,
  p_priority smallint DEFAULT 2,
  p_scheduled_at timestamptz DEFAULT now(),
  p_max_attempts smallint DEFAULT 5,
  p_reprocess_raw_object_id uuid DEFAULT NULL
)
RETURNS public.hl_ingestion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  result public.hl_ingestion_jobs;
BEGIN
  INSERT INTO public.hl_ingestion_jobs (
    endpoint_key,
    sport,
    resource,
    dedupe_key,
    request_params,
    cursor_data,
    priority,
    scheduled_at,
    max_attempts,
    reprocess_raw_object_id
  )
  VALUES (
    p_endpoint_key,
    p_sport,
    p_resource,
    p_dedupe_key,
    COALESCE(p_request_params, '{}'::jsonb),
    COALESCE(p_cursor_data, '{}'::jsonb),
    p_priority,
    p_scheduled_at,
    p_max_attempts,
    p_reprocess_raw_object_id
  )
  ON CONFLICT (dedupe_key) DO UPDATE SET
    scheduled_at = LEAST(public.hl_ingestion_jobs.scheduled_at, EXCLUDED.scheduled_at),
    priority = LEAST(public.hl_ingestion_jobs.priority, EXCLUDED.priority),
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_highlightly_ingestion_job(
  p_worker_id text,
  p_lock_seconds integer DEFAULT 900
)
RETURNS SETOF public.hl_ingestion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'worker_id must not be empty';
  END IF;

  IF p_lock_seconds < 30 OR p_lock_seconds > 3600 THEN
    RAISE EXCEPTION 'lock_seconds must be between 30 and 3600';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.hl_ingestion_jobs AS job
    WHERE job.attempts < job.max_attempts
      AND (
        (job.status IN ('pending', 'retry') AND job.scheduled_at <= now())
        OR (job.status = 'running' AND job.lock_expires_at < now())
      )
    ORDER BY job.priority ASC, job.scheduled_at ASC, job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.hl_ingestion_jobs AS job
  SET
    status = 'running',
    attempts = job.attempts + 1,
    worker_id = p_worker_id,
    locked_at = now(),
    lock_expires_at = now() + make_interval(secs => p_lock_seconds),
    started_at = COALESCE(job.started_at, now()),
    finished_at = NULL,
    last_error = NULL,
    updated_at = now()
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.*;
END
$function$;

CREATE OR REPLACE FUNCTION public.finish_highlightly_ingestion_job(
  p_job_id uuid,
  p_worker_id text,
  p_outcome text,
  p_error text DEFAULT NULL,
  p_retry_delay_seconds integer DEFAULT 300
)
RETURNS public.hl_ingestion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  result public.hl_ingestion_jobs;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'retry', 'dead', 'cancelled') THEN
    RAISE EXCEPTION 'invalid outcome: %', p_outcome;
  END IF;

  IF p_retry_delay_seconds < 0 OR p_retry_delay_seconds > 86400 THEN
    RAISE EXCEPTION 'retry_delay_seconds must be between 0 and 86400';
  END IF;

  UPDATE public.hl_ingestion_jobs AS job
  SET
    status = CASE
      WHEN p_outcome = 'retry' AND job.attempts >= job.max_attempts THEN 'dead'
      ELSE p_outcome
    END,
    scheduled_at = CASE
      WHEN p_outcome = 'retry' AND job.attempts < job.max_attempts
        THEN now() + make_interval(secs => p_retry_delay_seconds)
      ELSE job.scheduled_at
    END,
    worker_id = NULL,
    locked_at = NULL,
    lock_expires_at = NULL,
    finished_at = CASE WHEN p_outcome = 'retry' AND job.attempts < job.max_attempts THEN NULL ELSE now() END,
    last_error = p_error,
    updated_at = now()
  WHERE job.id = p_job_id
    AND job.status = 'running'
    AND job.worker_id = p_worker_id
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'running job % is not owned by worker %', p_job_id, p_worker_id;
  END IF;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_highlightly_ingestion_job(
  text, text, text, text, jsonb, jsonb, smallint, timestamptz, smallint, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_highlightly_ingestion_job(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_highlightly_ingestion_job(uuid, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_highlightly_ingestion_job(
  text, text, text, text, jsonb, jsonb, smallint, timestamptz, smallint, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_highlightly_ingestion_job(text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_highlightly_ingestion_job(uuid, text, text, text, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
