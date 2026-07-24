ALTER TABLE public.analises_ia
  ADD COLUMN IF NOT EXISTS rollout_stage text NULL,
  ADD COLUMN IF NOT EXISTS rollout_variant text NULL,
  ADD COLUMN IF NOT EXISTS rollout_reason text NULL;

ALTER TABLE public.analises_ia
  DROP CONSTRAINT IF EXISTS analises_ia_rollout_stage_valid,
  ADD CONSTRAINT analises_ia_rollout_stage_valid
    CHECK (rollout_stage IS NULL OR rollout_stage IN ('legacy', 'canary', 'full')) NOT VALID,
  DROP CONSTRAINT IF EXISTS analises_ia_rollout_variant_valid,
  ADD CONSTRAINT analises_ia_rollout_variant_valid
    CHECK (rollout_variant IS NULL OR rollout_variant IN ('legacy', 'structured')) NOT VALID,
  DROP CONSTRAINT IF EXISTS analises_ia_rollout_reason_valid,
  ADD CONSTRAINT analises_ia_rollout_reason_valid
    CHECK (
      rollout_reason IS NULL
      OR rollout_reason IN (
        'explicit_rollback',
        'stage_legacy',
        'canary_allowlist',
        'canary_holdback',
        'stage_full'
      )
    ) NOT VALID;

ALTER TABLE public.analises_ia
  VALIDATE CONSTRAINT analises_ia_rollout_stage_valid,
  VALIDATE CONSTRAINT analises_ia_rollout_variant_valid,
  VALIDATE CONSTRAINT analises_ia_rollout_reason_valid;

CREATE INDEX IF NOT EXISTS idx_analises_ia_rollout
  ON public.analises_ia(rollout_stage, rollout_variant, created_at DESC);

COMMENT ON COLUMN public.analises_ia.rollout_stage IS
  'Configured release stage for the validation contract: legacy, canary or full.';
COMMENT ON COLUMN public.analises_ia.rollout_variant IS
  'Contract variant actually used by the run after rollback and canary evaluation.';
COMMENT ON COLUMN public.analises_ia.rollout_reason IS
  'Deterministic reason that selected the effective contract variant.';