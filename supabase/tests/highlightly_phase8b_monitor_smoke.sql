BEGIN;

DO $structure$
BEGIN
  IF to_regprocedure('public.get_highlightly_collection_monitor(text)') IS NULL THEN
    RAISE EXCEPTION 'Highlightly collection monitor RPC is missing';
  END IF;

  IF has_function_privilege(
      'anon',
      'public.get_highlightly_collection_monitor(text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'authenticated',
      'public.get_highlightly_collection_monitor(text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.get_highlightly_collection_monitor(text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Highlightly collection monitor privileges are invalid';
  END IF;

  IF (
    SELECT procedure.prosecdef
    FROM pg_proc AS procedure
    WHERE procedure.oid = 'public.get_highlightly_collection_monitor(text)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Highlightly collection monitor must remain SECURITY INVOKER';
  END IF;
END
$structure$;

DO $monitor$
DECLARE
  provider uuid;
  monitor jsonb;
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
    planned_end_at,
    daily_request_budget,
    reserve_requests,
    config
  ) VALUES (
    provider,
    'phase8b-monitor-smoke',
    'running',
    ARRAY['football', 'baseball']::text[],
    now(),
    now() + interval '7 days',
    5000,
    750,
    jsonb_build_object(
      'current_slice',
      jsonb_build_object('data_start', '2026-07-08', 'data_end', '2026-07-14')
    )
  );

  INSERT INTO public.hl_ingestion_jobs (
    endpoint_key,
    sport,
    resource,
    dedupe_key,
    status,
    shadow_scope,
    request_params,
    attempts,
    max_attempts,
    last_error
  ) VALUES
    ('football.MatchesController_getMatches', 'football', 'matches', 'phase8b-monitor-smoke:success', 'succeeded', 'phase8b-monitor-smoke', '{"date":"2026-07-08","_shadow_scope":"phase8b-monitor-smoke"}', 1, 5, NULL),
    ('football.TeamsController_teamStatistics', 'football', 'team_statistics', 'phase8b-monitor-smoke:retry', 'retry', 'phase8b-monitor-smoke', '{"_shadow_scope":"phase8b-monitor-smoke"}', 2, 5, 'temporary upstream failure'),
    ('baseball.BaseballMatchController_getMatches', 'baseball', 'matches', 'phase8b-monitor-smoke:pending', 'pending', 'phase8b-monitor-smoke', '{"date":"2026-07-08","_shadow_scope":"phase8b-monitor-smoke"}', 0, 5, NULL),
    ('baseball.BaseballStandingsController_getStandings', 'baseball', 'standings', 'phase8b-monitor-smoke:dead', 'dead', 'phase8b-monitor-smoke', '{"_shadow_scope":"phase8b-monitor-smoke"}', 5, 5, 'bounded failure');

  monitor := public.get_highlightly_collection_monitor('phase8b-monitor-smoke');

  IF monitor ->> 'scope' <> 'phase8b-monitor-smoke'
    OR (monitor #>> '{queue,total}')::integer <> 4
    OR (monitor #>> '{queue,active}')::integer <> 2
    OR (monitor #>> '{queue,succeeded}')::integer <> 1
    OR (monitor #>> '{queue,dead}')::integer <> 1
    OR jsonb_array_length(monitor -> 'by_sport') <> 2
    OR jsonb_array_length(monitor -> 'recent_errors') <> 2
    OR monitor #>> '{window,current_slice,data_start}' <> '2026-07-08' THEN
    RAISE EXCEPTION 'Unexpected collection monitor payload: %', monitor;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(monitor -> 'scopes') AS scope_row
    WHERE scope_row ->> 'scope' = 'phase8b-monitor-smoke'
  ) THEN
    RAISE EXCEPTION 'Synthetic monitor scope was not listed';
  END IF;
END
$monitor$;

ROLLBACK;
