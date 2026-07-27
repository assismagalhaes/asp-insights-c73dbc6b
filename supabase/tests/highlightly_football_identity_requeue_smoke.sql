BEGIN;

DO $structure$
DECLARE
  function_oid regprocedure;
BEGIN
  function_oid :=
    to_regprocedure(
      'public.requeue_highlightly_dead_football_identity_jobs(text,integer)'
    );
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'football identity requeue RPC is missing';
  END IF;
  IF (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = function_oid
  ) THEN
    RAISE EXCEPTION 'football identity requeue RPC must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege(
    'anon',
    function_oid,
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    function_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'client roles must not execute football identity requeue RPC';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    function_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute football identity requeue RPC';
  END IF;
END
$structure$;

DO $at_rest$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sports_providers
    WHERE code = 'highlightly'
      AND enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;
END
$at_rest$;

ROLLBACK;
