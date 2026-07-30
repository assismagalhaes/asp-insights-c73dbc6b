BEGIN;

DO $structure$
DECLARE
  materializer_oid regprocedure :=
    to_regprocedure(
      'public.materialize_highlightly_football_score_labels_v2(integer,integer,timestamptz,uuid)'
    );
  legacy_oid regprocedure :=
    to_regprocedure(
      'public.materialize_highlightly_football_score_labels_v2_phase8g43_legacy(integer,integer,timestamptz,uuid)'
    );
  materializer_source text;
  rejection_filter text;
BEGIN
  IF materializer_oid IS NULL OR legacy_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.4.3 materializer functions are missing';
  END IF;

  SELECT pg_get_functiondef(materializer_oid)
  INTO materializer_source;

  rejection_filter := split_part(
    split_part(
      materializer_source,
      'WHERE source.block_reason IN (',
      2
    ),
    'ON CONFLICT (match_id, label_version)',
    1
  );

  IF rejection_filter NOT LIKE
       '%terminal_state_requires_manual_review%'
     OR rejection_filter NOT LIKE
       '%participant_identity_collision%'
     OR rejection_filter LIKE
       '%terminal_observed_at IS NOT NULL%' THEN
    RAISE EXCEPTION
      'null-terminal deterministic blockers are still filtered out';
  END IF;

  IF materializer_source NOT LIKE
       '%source.kickoff_at%'
     OR materializer_source NOT LIKE
       '%null_terminal_rejection_fix%' THEN
    RAISE EXCEPTION
      'rejected label timestamp fallback contract is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS proc
    WHERE proc.oid IN (materializer_oid, legacy_oid)
      AND proc.prosecdef
  ) THEN
    RAISE EXCEPTION 'materializers must be SECURITY INVOKER';
  END IF;

  IF has_function_privilege('anon', materializer_oid, 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       materializer_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       materializer_oid,
       'EXECUTE'
     )
     OR has_function_privilege('anon', legacy_oid, 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       legacy_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       legacy_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'materializer privileges are invalid';
  END IF;

  IF (
    SELECT provider.enabled
    FROM public.sports_providers AS provider
    WHERE provider.code = 'highlightly'
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled';
  END IF;
END
$structure$;

ROLLBACK;
