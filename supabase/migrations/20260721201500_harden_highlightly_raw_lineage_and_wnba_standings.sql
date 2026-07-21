-- Preserve one raw capture per ingestion run and make the WNBA standings
-- quarantine explicit in the selected competition catalog.

CREATE UNIQUE INDEX IF NOT EXISTS idx_hl_raw_objects_run_unique
  ON public.hl_raw_objects (run_id)
  WHERE run_id IS NOT NULL;

COMMENT ON INDEX public.idx_hl_raw_objects_run_unique IS
  'Enforces one immutable raw capture registry row per Highlightly ingestion run.';

UPDATE public.hl_competition_scopes
SET
  capabilities = jsonb_set(capabilities, '{standings}', 'false'::jsonb, true),
  metadata = metadata || jsonb_build_object(
    'standingsPolicy', 'provider_quarantined',
    'standingsQuarantineReason', 'recurrent_identity_corruption',
    'standingsQuarantinedAt', '2026-07-21'
  ),
  updated_at = now()
WHERE provider_family = 'basketball'
  AND scope_key = 'wnba'
  AND provider_competition_id = '11847';
