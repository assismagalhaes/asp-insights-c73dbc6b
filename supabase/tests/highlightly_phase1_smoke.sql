-- Run only after all three Highlightly Phase 1 migrations.
-- The whole smoke test is rolled back and leaves no test rows behind.

BEGIN;

DO $assert_foundation$
BEGIN
  IF to_regclass('public.hl_ingestion_jobs') IS NULL
    OR to_regclass('public.hl_raw_objects') IS NULL
    OR to_regclass('public.sports_matches') IS NULL
    OR to_regprocedure('public.claim_highlightly_ingestion_job(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'Highlightly Phase 1 foundation is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sports_providers
    WHERE code = 'highlightly'
      AND contract_version = '6.13.2'
      AND enabled = false
  ) THEN
    RAISE EXCEPTION 'Highlightly provider seed is missing or unexpectedly enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'highlightly-raw'
      AND public = false
  ) THEN
    RAISE EXCEPTION 'highlightly-raw bucket is missing or public';
  END IF;
END
$assert_foundation$;

-- A synthetic authenticated user without a user_roles row must see no internal data.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

DO $assert_rls$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sports_providers) THEN
    RAISE EXCEPTION 'non-admin authenticated role can read Highlightly internal tables';
  END IF;
END
$assert_rls$;

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT public.enqueue_highlightly_ingestion_job(
  'smoke.matches',
  'football',
  'matches',
  'smoke:phase1:idempotency',
  '{"date":"2099-01-01"}'::jsonb,
  '{}'::jsonb,
  0::smallint,
  '1900-01-01T00:00:00Z'::timestamptz,
  2::smallint,
  NULL
);

SELECT public.enqueue_highlightly_ingestion_job(
  'smoke.matches',
  'football',
  'matches',
  'smoke:phase1:idempotency',
  '{"date":"2099-01-01"}'::jsonb,
  '{}'::jsonb,
  0::smallint,
  '1900-01-01T00:00:00Z'::timestamptz,
  2::smallint,
  NULL
);

DO $assert_idempotency$
DECLARE
  claimed public.hl_ingestion_jobs;
  finished public.hl_ingestion_jobs;
BEGIN
  IF (SELECT count(*) FROM public.hl_ingestion_jobs WHERE dedupe_key = 'smoke:phase1:idempotency') <> 1 THEN
    RAISE EXCEPTION 'repeated enqueue created a duplicate job';
  END IF;

  SELECT * INTO claimed
  FROM public.claim_highlightly_ingestion_job('phase1-smoke', 60)
  WHERE dedupe_key = 'smoke:phase1:idempotency';

  IF claimed.id IS NULL OR claimed.status <> 'running' OR claimed.attempts <> 1 THEN
    RAISE EXCEPTION 'job claim failed';
  END IF;

  SELECT * INTO finished
  FROM public.finish_highlightly_ingestion_job(
    claimed.id,
    'phase1-smoke',
    'succeeded',
    NULL,
    0
  );

  IF finished.status <> 'succeeded' OR finished.worker_id IS NOT NULL THEN
    RAISE EXCEPTION 'job finish failed';
  END IF;
END
$assert_idempotency$;

RESET ROLE;

DO $assert_privileges$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.claim_highlightly_ingestion_job(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated unexpectedly has queue RPC execute privilege';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.claim_highlightly_ingestion_job(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role is missing queue RPC execute privilege';
  END IF;
END
$assert_privileges$;

ROLLBACK;
