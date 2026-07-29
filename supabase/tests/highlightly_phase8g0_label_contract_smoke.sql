BEGIN;

DO $structure$
DECLARE
  report_oid regprocedure;
  provider_enabled boolean;
  football_id uuid;
  target public.hl_label_sets%ROWTYPE;
  family_counts jsonb;
BEGIN
  IF to_regclass('public.hl_label_sets') IS NULL
     OR to_regclass('public.hl_label_definitions') IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.0 label catalog tables must exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.hl_match_labels'::regclass
      AND attname = 'label_set_id'
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.hl_match_labels'::regclass
      AND attname = 'lineage'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Phase 8G.0 label lineage columns must exist';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.hl_label_sets'::regclass
  ) OR NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.hl_label_definitions'::regclass
  ) THEN
    RAISE EXCEPTION 'Phase 8G.0 label catalog must use RLS';
  END IF;

  IF has_table_privilege('anon', 'public.hl_label_sets', 'SELECT')
     OR has_table_privilege(
       'anon',
       'public.hl_label_definitions',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.hl_label_sets',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.hl_label_definitions',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'Phase 8G.0 label table privileges are invalid';
  END IF;

  report_oid := to_regprocedure(
    'public.get_highlightly_label_contract_report_v1(text,integer)'
  );
  IF report_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 8G.0 report RPC must exist';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = report_oid) THEN
    RAISE EXCEPTION 'Phase 8G.0 report must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', report_oid, 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated',
       report_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       report_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Phase 8G.0 report privileges are invalid';
  END IF;

  SELECT id INTO football_id
  FROM public.sports
  WHERE code = 'football';

  SELECT label_set.* INTO target
  FROM public.hl_label_sets AS label_set
  WHERE label_set.sport_id = football_id
    AND label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0';

  IF target.id IS NULL
     OR target.status <> 'draft'
     OR target.is_enabled THEN
    RAISE EXCEPTION 'Football label set 1.0.0 must remain draft';
  END IF;

  SELECT jsonb_object_agg(market_family, definitions)
  INTO family_counts
  FROM (
    SELECT market_family, count(*)::integer AS definitions
    FROM public.hl_label_definitions
    WHERE label_set_id = target.id
    GROUP BY market_family
  ) AS counts;

  IF (
    SELECT count(*)
    FROM public.hl_label_definitions
    WHERE label_set_id = target.id
  ) <> 27
     OR (family_counts ->> 'full_time_result')::integer <> 1
     OR (family_counts ->> 'total_goals')::integer <> 10
     OR (family_counts ->> 'both_teams_to_score')::integer <> 1
     OR (family_counts ->> 'first_team_to_score')::integer <> 1
     OR (family_counts ->> 'asian_handicap')::integer <> 6
     OR (family_counts ->> 'total_corners')::integer <> 8 THEN
    RAISE EXCEPTION 'Football label catalog counts are invalid: %',
      family_counts;
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;
END
$structure$;

DO $contract$
DECLARE
  report_payload jsonb;
  labels_before integer;
  labels_after integer;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    SELECT count(*)::integer INTO labels_before
    FROM public.hl_match_labels;

    report_payload := public.get_highlightly_label_contract_report_v1(
      'football',
      365
    );

    SELECT count(*)::integer INTO labels_after
    FROM public.hl_match_labels;

    IF labels_after <> labels_before THEN
      RAISE EXCEPTION 'Phase 8G.0 report must not create labels';
    END IF;

    IF report_payload ->> 'quality_contract_version' <> 'phase8g.0'
       OR (report_payload ->> 'definition_count')::integer <> 27
       OR report_payload #>> '{label_set,status}' <> 'draft'
       OR COALESCE(
         (report_payload #>> '{label_set,is_enabled}')::boolean,
         true
       )
       OR report_payload ->> 'recommendation'
         <> 'ready_for_label_readiness_review'
       OR jsonb_typeof(
         report_payload -> 'market_families'
       ) <> 'array'
       OR jsonb_typeof(
         report_payload -> 'readiness'
       ) <> 'object'
       OR COALESCE(
         (report_payload #>> '{safeguards,provider_calls}')::integer,
         -1
       ) <> 0
       OR COALESCE(
         (report_payload #>> '{safeguards,automatic_generation}')::boolean,
         true
       )
       OR COALESCE(
         (report_payload #>> '{safeguards,automatic_training}')::boolean,
         true
       )
       OR COALESCE(
         (report_payload #>> '{safeguards,automatic_predictions}')::boolean,
         true
       ) THEN
      RAISE EXCEPTION 'Phase 8G.0 report payload is invalid: %',
        report_payload;
    END IF;
  END IF;
END
$contract$;

ROLLBACK;
