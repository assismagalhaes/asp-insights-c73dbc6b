-- Highlightly Phase 8E hotfix: empty responses are not successful resources.
-- Rollout policies and provider state are intentionally left unchanged.

CREATE OR REPLACE FUNCTION public.get_highlightly_match_lifecycle_candidates_v2(
  p_at timestamptz DEFAULT now(),
  p_limit integer DEFAULT 1000,
  p_include_disabled boolean DEFAULT false
)
RETURNS TABLE (
  match_id uuid,
  sport text,
  external_match_id text,
  kickoff_at timestamptz,
  match_status text,
  lifecycle_stage text,
  cadence_key text,
  resource text,
  endpoint_key text,
  request_params jsonb,
  dedupe_key text,
  priority integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH candidates AS (
    SELECT *
    FROM public.get_highlightly_match_lifecycle_candidates(
      p_at,
      3000,
      p_include_disabled
    )
  )
  SELECT
    candidate.match_id,
    candidate.sport,
    candidate.external_match_id,
    candidate.kickoff_at,
    candidate.match_status,
    candidate.lifecycle_stage,
    candidate.cadence_key,
    candidate.resource,
    candidate.endpoint_key,
    candidate.request_params,
    candidate.dedupe_key,
    candidate.priority
  FROM candidates AS candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.hl_match_lifecycle_resources AS resource_state
    WHERE resource_state.match_id = candidate.match_id
      AND resource_state.resource = candidate.resource
      AND resource_state.status IN ('provider_unavailable', 'not_supported')
  )
  ORDER BY
    candidate.priority,
    candidate.kickoff_at,
    candidate.sport,
    candidate.external_match_id,
    candidate.resource
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1000), 3000));
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_match_lifecycle_candidates_v2(
  timestamptz,
  integer,
  boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_match_lifecycle_candidates_v2(
  timestamptz,
  integer,
  boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_match_lifecycle_report_v2(
  p_from timestamptz DEFAULT now() - interval '36 hours',
  p_to timestamptz DEFAULT now() + interval '36 hours'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT public.get_highlightly_match_lifecycle_report(p_from, p_to);
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_match_lifecycle_report_v2(
  timestamptz,
  timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_match_lifecycle_report_v2(
  timestamptz,
  timestamptz
) TO authenticated, service_role;

WITH latest_phase8e_run AS (
  SELECT DISTINCT ON (ingestion_run.job_id)
    ingestion_run.job_id,
    ingestion_run.records_received
  FROM public.hl_ingestion_runs AS ingestion_run
  JOIN public.hl_ingestion_jobs AS ingestion_job
    ON ingestion_job.id = ingestion_run.job_id
  WHERE ingestion_job.shadow_scope LIKE 'phase8e-lifecycle-%'
    AND ingestion_run.status = 'succeeded'
  ORDER BY ingestion_run.job_id, ingestion_run.started_at DESC
),
classified AS (
  SELECT
    resource_state.match_id,
    resource_state.resource,
    CASE
      WHEN sport.code = 'football'
        AND resource_state.resource = 'box_scores'
        THEN 'not_supported'
      WHEN resource_state.metadata ->> 'cadenceKey' = 'post24h'
        AND resource_state.resource = ANY (lifecycle_policy.required_resources)
        THEN 'provider_unavailable'
      WHEN resource_state.metadata ->> 'cadenceKey' = 'post24h'
        THEN 'not_supported'
      ELSE 'retry'
    END AS corrected_status
  FROM public.hl_match_lifecycle_resources AS resource_state
  JOIN latest_phase8e_run AS ingestion_run
    ON ingestion_run.job_id = resource_state.last_job_id
  JOIN public.sports_matches AS match_row
    ON match_row.id = resource_state.match_id
  JOIN public.sports AS sport
    ON sport.id = match_row.sport_id
  JOIN public.hl_match_lifecycle_policies AS lifecycle_policy
    ON lifecycle_policy.sport_id = match_row.sport_id
  WHERE resource_state.status = 'succeeded'
    AND ingestion_run.records_received = 0
)
UPDATE public.hl_match_lifecycle_resources AS resource_state
SET
  status = classified.corrected_status,
  completed_at = CASE
    WHEN classified.corrected_status IN ('provider_unavailable', 'not_supported')
      THEN COALESCE(resource_state.completed_at, now())
    ELSE NULL
  END,
  last_error = CASE classified.corrected_status
    WHEN 'retry' THEN 'empty_required_or_pending_resource_retry'
    WHEN 'provider_unavailable' THEN 'empty_required_resource_after_post24h'
    WHEN 'not_supported' THEN 'empty_optional_resource_not_supported'
  END,
  metadata = resource_state.metadata || jsonb_build_object(
    'emptyResponse',
    true,
    'recordsReceived',
    0,
    'emptyClassification',
    classified.corrected_status,
    'reconciledBy',
    'phase8e_empty_hotfix'
  ),
  updated_at = now()
FROM classified
WHERE resource_state.match_id = classified.match_id
  AND resource_state.resource = classified.resource;

SELECT public.refresh_highlightly_match_lifecycle_states(now());

COMMENT ON FUNCTION public.get_highlightly_match_lifecycle_candidates_v2(
  timestamptz,
  integer,
  boolean
) IS
  'Returns Phase 8E candidates while suppressing terminal empty-resource classifications.';
COMMENT ON FUNCTION public.get_highlightly_match_lifecycle_report_v2(
  timestamptz,
  timestamptz
) IS
  'Returns the admin-gated Phase 8E monitor with a 36-hour historical default window.';