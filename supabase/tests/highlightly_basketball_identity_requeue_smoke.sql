BEGIN;

DO $structure$
BEGIN
  IF to_regprocedure(
    'public.requeue_highlightly_dead_basketball_identity_jobs(text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'basketball identity requeue RPC is missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = to_regprocedure(
      'public.requeue_highlightly_dead_basketball_identity_jobs(text,integer)'
    )
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'basketball identity requeue RPC must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.requeue_highlightly_dead_basketball_identity_jobs(text,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.requeue_highlightly_dead_basketball_identity_jobs(text,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.requeue_highlightly_dead_basketball_identity_jobs(text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'basketball identity requeue RPC privileges are invalid';
  END IF;
END
$structure$;

DO $contract$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(
    to_regprocedure(
      'public.requeue_highlightly_dead_basketball_identity_jobs(text,integer)'
    )
  )
  INTO function_definition;

  IF function_definition NOT LIKE '%job.sport = ''basketball''%'
    OR function_definition NOT LIKE
      '%job.endpoint_key = ''basketball.MatchesController_getMatches''%'
    OR function_definition NOT LIKE
      '%sports_match_participants_match_team_unique%'
    OR function_definition NOT LIKE
      '%duplicate key value violates unique constraint%'
    OR function_definition NOT LIKE '%active ingestion queue must be empty%'
    OR function_definition NOT LIKE '%max_attempts = 1%'
    OR function_definition NOT LIKE
      '%jsonb_set(%''{_fanout}''%''false''::jsonb%'
  THEN
    RAISE EXCEPTION
      'basketball identity requeue RPC is missing one or more safety filters';
  END IF;

  IF function_definition LIKE
    '%job.endpoint_key <> ''basketball.MatchesController_getMatches''%'
  THEN
    RAISE EXCEPTION
      'basketball identity requeue RPC contains an invalid endpoint predicate';
  END IF;
END
$contract$;

ROLLBACK;
