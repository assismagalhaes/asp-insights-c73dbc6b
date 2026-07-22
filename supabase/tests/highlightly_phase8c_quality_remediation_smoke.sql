BEGIN;

DO $structure$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hl_shadow_observations'
      AND column_name = 'odds_availability_pct'
  ) THEN
    RAISE EXCEPTION 'eligible odds availability column is missing';
  END IF;
  IF to_regclass('public.hl_highlightly_future_gate_v') IS NULL THEN
    RAISE EXCEPTION 'future gate view is missing';
  END IF;
  IF to_regprocedure(
    'public.accept_highlightly_quarantined_wnba_standings_issues(text)'
  ) IS NULL OR to_regprocedure(
    'public.requeue_highlightly_dead_521_jobs(text,integer)'
  ) IS NULL OR to_regprocedure(
    'public.finalize_highlightly_shadow_window(text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Phase 8C remediation RPC is missing';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.accept_highlightly_quarantined_wnba_standings_issues(text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.accept_highlightly_quarantined_wnba_standings_issues(text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.accept_highlightly_quarantined_wnba_standings_issues(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'WNBA acceptance privileges are invalid';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.requeue_highlightly_dead_521_jobs(text,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.requeue_highlightly_dead_521_jobs(text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.requeue_highlightly_dead_521_jobs(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'HTTP 521 replay privileges are invalid';
  END IF;
  IF has_table_privilege('anon', 'public.hl_highlightly_future_gate_v', 'SELECT')
    OR NOT has_table_privilege(
      'service_role', 'public.hl_highlightly_future_gate_v', 'SELECT'
    ) THEN
    RAISE EXCEPTION 'future gate view privileges are invalid';
  END IF;
END
$structure$;

DO $state_math$
DECLARE
  provider uuid;
  v_window_id uuid := gen_random_uuid();
  job_id uuid := gen_random_uuid();
  run_id uuid := gen_random_uuid();
  issue_id uuid := gen_random_uuid();
  health public.hl_phase7_window_health_v%ROWTYPE;
  accepted integer;
  finalized public.hl_shadow_windows%ROWTYPE;
BEGIN
  SELECT id INTO provider
  FROM public.sports_providers
  WHERE code = 'highlightly';

  INSERT INTO public.hl_shadow_windows (
    id, provider_id, scope, status, sports, started_at, planned_end_at, config
  ) VALUES (
    v_window_id,
    provider,
    'phase8c-smoke-historical',
    'running',
    ARRAY['basketball']::text[],
    now() - interval '2 days',
    now() + interval '5 days',
    '{"window_kind":"historical","current_slice":{"status":"running"}}'::jsonb
  );

  INSERT INTO public.hl_ingestion_jobs (
    id, endpoint_key, sport, resource, request_params, dedupe_key, status
  ) VALUES (
    job_id,
    'basketball.BasketballStandingsController_getStandings',
    'basketball',
    'standings',
    '{"leagueId":11847,"season":2026,"_shadow_scope":"phase8c-smoke-historical"}'::jsonb,
    'phase8c-smoke-historical:wnba-standings',
    'succeeded'
  );

  INSERT INTO public.hl_ingestion_runs (
    id, job_id, worker_id, status, finished_at
  ) VALUES (
    run_id, job_id, 'phase8c-smoke', 'partial', now()
  );

  INSERT INTO public.hl_data_quality_issues (
    id, run_id, endpoint_key, sport, severity, issue_code, details
  ) VALUES (
    issue_id,
    run_id,
    'basketball.BasketballStandingsController_getStandings',
    'basketball',
    'critical',
    'BASKETBALL_STANDINGS_CORRUPTED',
    '{"context":{"leagueId":11847,"rows":30,"distinctTeams":1,"duplicateWithinGroup":true}}'::jsonb
  );

  INSERT INTO public.hl_shadow_observations (
    window_id, observed_on, sport, jobs_total, jobs_succeeded,
    jobs_dead, open_critical_issues, matches_seen, matches_with_odds,
    matches_odds_eligible, matches_eligible_with_odds
  ) VALUES
    (v_window_id, current_date - 1, 'basketball', 3, 1, 2, 1, 10, 2, 4, 2),
    (v_window_id, current_date, 'basketball', 3, 1, 2, 1, 10, 2, 4, 2);

  SELECT * INTO health
  FROM public.hl_phase7_window_health_v
  WHERE hl_phase7_window_health_v.window_id = v_window_id;

  IF health.unrecovered_jobs <> 2 OR health.open_critical_issues <> 1 THEN
    RAISE EXCEPTION 'latest-state gate still double counts snapshots: %', row_to_json(health);
  END IF;
  IF health.minimum_odds_coverage_pct <> 50 THEN
    RAISE EXCEPTION 'eligible odds denominator was not used: %', health.minimum_odds_coverage_pct;
  END IF;

  accepted := public.accept_highlightly_quarantined_wnba_standings_issues(
    'phase8c-smoke-historical'
  );
  IF accepted <> 1 OR EXISTS (
    SELECT 1 FROM public.hl_data_quality_issues
    WHERE id = issue_id AND resolution_status <> 'accepted'
  ) THEN
    RAISE EXCEPTION 'known WNBA issue was not accepted exactly once';
  END IF;
  IF public.accept_highlightly_quarantined_wnba_standings_issues(
    'phase8c-smoke-historical'
  ) <> 0 THEN
    RAISE EXCEPTION 'WNBA acceptance is not idempotent';
  END IF;

  finalized := public.finalize_highlightly_shadow_window('phase8c-smoke-historical');
  IF finalized.status <> 'passed' OR finalized.ended_at IS NULL THEN
    RAISE EXCEPTION 'historical window did not finalize cleanly: %', row_to_json(finalized);
  END IF;
END
$state_math$;

ROLLBACK;
