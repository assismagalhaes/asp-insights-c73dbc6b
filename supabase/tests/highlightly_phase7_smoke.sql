BEGIN;

DO $structure$
BEGIN
  IF to_regclass('public.hl_shadow_windows') IS NULL
    OR to_regclass('public.hl_shadow_observations') IS NULL
    OR to_regclass('public.hl_source_reconciliations') IS NULL
    OR to_regclass('public.hl_phase7_window_health_v') IS NULL THEN
    RAISE EXCEPTION 'Phase 7 observability objects are missing';
  END IF;

  IF has_table_privilege('anon', 'public.hl_shadow_windows', 'SELECT')
    OR has_table_privilege('anon', 'public.hl_shadow_observations', 'SELECT')
    OR has_table_privilege('anon', 'public.hl_source_reconciliations', 'SELECT')
    OR has_table_privilege('anon', 'public.hl_phase7_window_health_v', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read Phase 7 operational data';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.hl_shadow_windows', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.hl_phase7_window_health_v', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated admin read grants are missing';
  END IF;

  IF has_table_privilege('authenticated', 'public.hl_shadow_windows', 'INSERT')
    OR has_table_privilege('authenticated', 'public.hl_shadow_observations', 'INSERT')
    OR has_table_privilege('authenticated', 'public.hl_source_reconciliations', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated must not write Phase 7 operational data';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.hl_shadow_windows', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.hl_shadow_observations', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.hl_source_reconciliations', 'INSERT') THEN
    RAISE EXCEPTION 'service_role Phase 7 grants are missing';
  END IF;

  IF has_function_privilege(
      'anon',
      'public.refresh_highlightly_shadow_observation(uuid,date,text,text,integer)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.refresh_highlightly_shadow_observation(uuid,date,text,text,integer)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.refresh_highlightly_shadow_observation(uuid,date,text,text,integer)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Phase 7 observation RPC privileges are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sports_providers
    WHERE code = 'highlightly' AND enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must stay disabled';
  END IF;
END
$structure$;

DO $metrics$
DECLARE
  provider uuid;
  shadow_window uuid;
  health public.hl_phase7_window_health_v%ROWTYPE;
BEGIN
  SELECT id INTO STRICT provider
  FROM public.sports_providers
  WHERE code = 'highlightly';

  INSERT INTO public.hl_shadow_windows (
    provider_id,
    scope,
    status,
    sports,
    started_at,
    planned_end_at
  ) VALUES (
    provider,
    'phase7-smoke',
    'running',
    ARRAY['football']::text[],
    now(),
    now() + interval '7 days'
  )
  RETURNING id INTO shadow_window;

  FOR day_offset IN 0..6 LOOP
    INSERT INTO public.hl_shadow_observations (
      window_id,
      observed_on,
      sport,
      jobs_total,
      jobs_succeeded,
      requests_used,
      matches_expected,
      matches_seen,
      matches_with_odds,
      freshness_p95_seconds,
      latency_p50_ms,
      latency_p95_ms
    ) VALUES (
      shadow_window,
      current_date + day_offset,
      'football',
      10,
      10,
      100,
      20,
      19,
      18,
      900,
      100,
      200
    );
  END LOOP;

  INSERT INTO public.hl_source_reconciliations (
    window_id,
    observed_on,
    sport,
    source_name,
    competition_key,
    expected_matches,
    highlightly_matches,
    matched_matches,
    missing_in_highlightly
  ) VALUES (
    shadow_window,
    current_date,
    'football',
    'current_source',
    'smoke-league',
    20,
    19,
    19,
    1
  );

  SELECT * INTO STRICT health
  FROM public.hl_phase7_window_health_v
  WHERE window_id = shadow_window;

  IF health.observed_days <> 7
    OR health.requests_used <> 700
    OR health.minimum_match_coverage_pct <> 95
    OR health.minimum_odds_coverage_pct < 94.73
    OR health.gate_status <> 'ready' THEN
    RAISE EXCEPTION 'Unexpected Phase 7 health summary: %', row_to_json(health);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.hl_source_reconciliations
    WHERE window_id = shadow_window AND coverage_pct = 95
  ) THEN
    RAISE EXCEPTION 'Source reconciliation coverage was not calculated';
  END IF;
END
$metrics$;

ROLLBACK;
