BEGIN;

DO $test$
DECLARE
  runs_before bigint;
  runs_after bigint;
BEGIN
  SELECT count(*) INTO runs_before
  FROM public.hl_training_dataset_build_runs AS run
  JOIN public.hl_training_dataset_specs AS spec
    ON spec.id = run.dataset_spec_id
  WHERE spec.code = 'football_mvp_pl_laliga_canary'
    AND spec.version = '1.0.0';

  BEGIN
    PERFORM public.build_football_mvp_pl_laliga_canary_v1(
      '2026-08-12T00:00:00Z'::timestamptz,
      '2026-09-30T00:00:00Z'::timestamptz,
      500
    );
    RAISE EXCEPTION 'builder unexpectedly bypassed a non-ready gate';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      IF SQLERRM NOT LIKE 'Phase 2 gate is %, required ready' THEN
        RAISE;
      END IF;
  END;

  SELECT count(*) INTO runs_after
  FROM public.hl_training_dataset_build_runs AS run
  JOIN public.hl_training_dataset_specs AS spec
    ON spec.id = run.dataset_spec_id
  WHERE spec.code = 'football_mvp_pl_laliga_canary'
    AND spec.version = '1.0.0';

  IF runs_after <> runs_before THEN
    RAISE EXCEPTION 'blocked gate persisted a build run';
  END IF;
END
$test$;

-- Transaction-local replacement. ROLLBACK restores the real gate function.
CREATE OR REPLACE FUNCTION public.get_highlightly_football_canary_gate_v1(
  p_days integer DEFAULT 14,
  p_match_coverage_sla numeric DEFAULT 95,
  p_odds_coverage_sla numeric DEFAULT 90,
  p_freshness_sla_seconds integer DEFAULT 3600,
  p_min_league_matches integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $stub$
  SELECT jsonb_build_object(
    'gate_status', 'ready',
    'required_days', p_days,
    'observed_days', p_days,
    'odds_coverage_pct', 100,
    'freshness_p95_seconds', 1,
    'dead_jobs', 0,
    'open_critical_issues', 0,
    'test_stub', true
  )
$stub$;

CREATE TEMP TABLE canary_smoke_result ON COMMIT DROP AS
SELECT public.build_football_mvp_pl_laliga_canary_v1(
  '2026-08-12T00:00:00Z'::timestamptz,
  '2026-09-30T00:00:00Z'::timestamptz,
  500
) AS result;

DO $test$
DECLARE
  build_result jsonb;
  report jsonb;
  build_id uuid;
BEGIN
  SELECT result INTO build_result FROM canary_smoke_result;
  build_id := (build_result ->> 'build_run_id')::uuid;

  IF build_result ->> 'gate_status' <> 'ready'
     OR COALESCE((build_result ->> 'rows_inserted')::integer, 0) < 1
     OR COALESCE((build_result ->> 'provider_calls')::integer, -1) <> 0
     OR COALESCE((build_result ->> 'automatic_training')::boolean, true)
     OR COALESCE((build_result ->> 'automatic_predictions')::boolean, true) THEN
    RAISE EXCEPTION 'unexpected gated build result: %', build_result;
  END IF;

  report := public.get_football_mvp_pl_laliga_canary_report_v1(build_id);

  IF report #>> '{build_run,id}' <> build_id::text
     OR COALESCE((report #>> '{integrity,temporal_violations}')::integer, -1) <> 0
     OR COALESCE((report #>> '{integrity,duplicate_match_rows}')::integer, -1) <> 0
     OR COALESCE((report #>> '{integrity,competition_scope_violations}')::integer, -1) <> 0
     OR COALESCE((report #>> '{integrity,readiness_violations}')::integer, -1) <> 0
     OR COALESCE((report #>> '{integrity,lineage_violations}')::integer, -1) <> 0
     OR COALESCE((report #>> '{integrity,temporal_split_violations}')::integer, -1) <> 0
     OR jsonb_array_length(report -> 'leagues') <> 2
     OR jsonb_array_length(report -> 'seasons') < 1
     OR jsonb_array_length(report -> 'markets') < 1
     OR jsonb_array_length(report -> 'features') <> 13 THEN
    RAISE EXCEPTION 'unexpected canary coverage report: %', report;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hl_training_dataset_rows AS row
    JOIN public.sports_matches AS match_row ON match_row.id = row.match_id
    JOIN public.sports_provider_entities AS entity
      ON entity.entity_type = 'competition'
     AND entity.canonical_id = match_row.competition_id
    JOIN public.sports_providers AS provider
      ON provider.id = entity.provider_id
     AND provider.code = 'highlightly'
    WHERE row.build_run_id = build_id
      AND entity.external_id NOT IN ('33973', '119924')
  ) THEN
    RAISE EXCEPTION 'canary contains an out-of-scope competition';
  END IF;

  IF EXISTS (
    SELECT match_id
    FROM public.hl_training_dataset_rows
    WHERE build_run_id = build_id
    GROUP BY match_id
    HAVING count(DISTINCT split_key) <> 1
  ) THEN
    RAISE EXCEPTION 'a match crossed dataset splits';
  END IF;
END
$test$;

SELECT result FROM canary_smoke_result;

ROLLBACK;
