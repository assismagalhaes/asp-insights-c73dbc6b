CREATE TABLE IF NOT EXISTS public.sports_match_state_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL
    REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  observation_source text NOT NULL,
  kickoff_at timestamptz NOT NULL,
  status text NOT NULL,
  provider_status text,
  score_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_fingerprint text NOT NULL,
  CONSTRAINT sports_match_state_history_source_check CHECK (
    observation_source IN ('migration_baseline', 'canonical_change')
  ),
  CONSTRAINT sports_match_state_history_match_fingerprint_unique
    UNIQUE (match_id, state_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_sports_match_state_history_match_time
  ON public.sports_match_state_history (match_id, observed_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_sports_match_state_history_observed
  ON public.sports_match_state_history (observed_at DESC, match_id);

ALTER TABLE public.sports_match_state_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sports_match_state_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sports_match_state_history TO service_role;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.capture_sports_match_state_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  fingerprint_value text;
BEGIN
  fingerprint_value := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'kickoff_at', NEW.kickoff_at,
      'status', NEW.status,
      'provider_status', NEW.provider_status,
      'score_data', COALESCE(NEW.score_data, '{}'::jsonb),
      'state_data', COALESCE(NEW.state_data, '{}'::jsonb)
    )::text
  );

  INSERT INTO public.sports_match_state_history (
    match_id,
    observed_at,
    observation_source,
    kickoff_at,
    status,
    provider_status,
    score_data,
    state_data,
    state_fingerprint
  ) VALUES (
    NEW.id,
    pg_catalog.now(),
    'canonical_change',
    NEW.kickoff_at,
    NEW.status,
    NEW.provider_status,
    COALESCE(NEW.score_data, '{}'::jsonb),
    COALESCE(NEW.state_data, '{}'::jsonb),
    fingerprint_value
  )
  ON CONFLICT (match_id, state_fingerprint) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_sports_match_state_history()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS capture_sports_match_state_history_insert
  ON public.sports_matches;

CREATE TRIGGER capture_sports_match_state_history_insert
AFTER INSERT
ON public.sports_matches
FOR EACH ROW
EXECUTE FUNCTION private.capture_sports_match_state_history();

DROP TRIGGER IF EXISTS capture_sports_match_state_history_update
  ON public.sports_matches;

CREATE TRIGGER capture_sports_match_state_history_update
AFTER UPDATE OF kickoff_at, status, provider_status, score_data, state_data
ON public.sports_matches
FOR EACH ROW
WHEN (
  OLD.kickoff_at IS DISTINCT FROM NEW.kickoff_at
  OR OLD.status IS DISTINCT FROM NEW.status
  OR OLD.provider_status IS DISTINCT FROM NEW.provider_status
  OR OLD.score_data IS DISTINCT FROM NEW.score_data
  OR OLD.state_data IS DISTINCT FROM NEW.state_data
)
EXECUTE FUNCTION private.capture_sports_match_state_history();

INSERT INTO public.sports_match_state_history (
  match_id,
  observed_at,
  observation_source,
  kickoff_at,
  status,
  provider_status,
  score_data,
  state_data,
  state_fingerprint
)
SELECT
  match_row.id,
  pg_catalog.now(),
  'migration_baseline',
  match_row.kickoff_at,
  match_row.status,
  match_row.provider_status,
  COALESCE(match_row.score_data, '{}'::jsonb),
  COALESCE(match_row.state_data, '{}'::jsonb),
  pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'kickoff_at', match_row.kickoff_at,
      'status', match_row.status,
      'provider_status', match_row.provider_status,
      'score_data', COALESCE(match_row.score_data, '{}'::jsonb),
      'state_data', COALESCE(match_row.state_data, '{}'::jsonb)
    )::text
  )
FROM public.sports_matches AS match_row
ON CONFLICT (match_id, state_fingerprint) DO NOTHING;

COMMENT ON TABLE public.sports_match_state_history IS
  'Immutable state observations for canonical matches. The migration baseline records only the state seen at deployment and is not retrospective history.';

COMMENT ON COLUMN public.sports_match_state_history.observed_at IS
  'Time ASP Insights observed this canonical state; not the provider event time.';
