CREATE TABLE IF NOT EXISTS public.hl_label_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  code text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  is_enabled boolean NOT NULL DEFAULT false,
  outcome_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_label_sets_code_format CHECK (
    code ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  CONSTRAINT hl_label_sets_version_format CHECK (
    version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  CONSTRAINT hl_label_sets_status_check CHECK (
    status IN ('draft', 'shadow', 'active', 'retired')
  ),
  CONSTRAINT hl_label_sets_policy_check CHECK (
    jsonb_typeof(outcome_policy) = 'object'
  ),
  CONSTRAINT hl_label_sets_unique UNIQUE (sport_id, code, version)
);

CREATE TABLE IF NOT EXISTS public.hl_label_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_set_id uuid NOT NULL
    REFERENCES public.hl_label_sets(id) ON DELETE CASCADE,
  label_key text NOT NULL,
  market_family text NOT NULL,
  display_name text NOT NULL,
  line_value numeric(6, 2),
  outcome_domain text[] NOT NULL,
  required_sources text[] NOT NULL,
  settlement_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_label_definitions_key_format CHECK (
    label_key ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  CONSTRAINT hl_label_definitions_market_check CHECK (
    market_family IN (
      'full_time_result',
      'total_goals',
      'both_teams_to_score',
      'first_team_to_score',
      'asian_handicap',
      'total_corners'
    )
  ),
  CONSTRAINT hl_label_definitions_line_check CHECK (
    (
      market_family IN ('total_goals', 'asian_handicap', 'total_corners')
      AND line_value IS NOT NULL
      AND line_value * 2 = trunc(line_value * 2)
    )
    OR (
      market_family NOT IN (
        'total_goals',
        'asian_handicap',
        'total_corners'
      )
      AND line_value IS NULL
    )
  ),
  CONSTRAINT hl_label_definitions_outcomes_check CHECK (
    cardinality(outcome_domain) >= 2
  ),
  CONSTRAINT hl_label_definitions_sources_check CHECK (
    cardinality(required_sources) >= 1
  ),
  CONSTRAINT hl_label_definitions_status_check CHECK (
    status IN ('draft', 'shadow', 'active', 'retired')
  ),
  CONSTRAINT hl_label_definitions_spec_check CHECK (
    jsonb_typeof(settlement_spec) = 'object'
  ),
  CONSTRAINT hl_label_definitions_key_unique
    UNIQUE (label_set_id, label_key),
  CONSTRAINT hl_label_definitions_market_line_unique
    UNIQUE NULLS NOT DISTINCT (
      label_set_id,
      market_family,
      line_value
    )
);

ALTER TABLE public.hl_match_labels
  ADD COLUMN IF NOT EXISTS label_set_id uuid,
  ADD COLUMN IF NOT EXISTS lineage jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.hl_match_labels'::regclass
      AND conname = 'hl_match_labels_label_set_id_fkey'
  ) THEN
    ALTER TABLE public.hl_match_labels
      ADD CONSTRAINT hl_match_labels_label_set_id_fkey
      FOREIGN KEY (label_set_id)
      REFERENCES public.hl_label_sets(id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.hl_match_labels'::regclass
      AND conname = 'hl_match_labels_lineage_check'
  ) THEN
    ALTER TABLE public.hl_match_labels
      ADD CONSTRAINT hl_match_labels_lineage_check
      CHECK (jsonb_typeof(lineage) = 'object');
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS idx_hl_label_sets_sport_status
  ON public.hl_label_sets (sport_id, status, is_enabled);
CREATE INDEX IF NOT EXISTS idx_hl_label_definitions_catalog
  ON public.hl_label_definitions (
    label_set_id,
    market_family,
    line_value
  );
CREATE INDEX IF NOT EXISTS idx_hl_match_labels_label_set_outcome
  ON public.hl_match_labels (
    label_set_id,
    outcome_at DESC,
    match_id
  )
  WHERE label_set_id IS NOT NULL;

ALTER TABLE public.hl_label_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_label_definitions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hl_label_sets
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hl_label_definitions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hl_label_sets TO authenticated;
GRANT SELECT ON TABLE public.hl_label_definitions TO authenticated;
GRANT ALL ON TABLE public.hl_label_sets TO service_role;
GRANT ALL ON TABLE public.hl_label_definitions TO service_role;

DROP POLICY IF EXISTS admin_read_hl_label_sets
  ON public.hl_label_sets;
CREATE POLICY admin_read_hl_label_sets
  ON public.hl_label_sets
  FOR SELECT
  TO authenticated
  USING (
    (
      SELECT public.has_role(
        (SELECT auth.uid()),
        'admin'::public.app_role
      )
    )
  );

DROP POLICY IF EXISTS admin_read_hl_label_definitions
  ON public.hl_label_definitions;
CREATE POLICY admin_read_hl_label_definitions
  ON public.hl_label_definitions
  FOR SELECT
  TO authenticated
  USING (
    (
      SELECT public.has_role(
        (SELECT auth.uid()),
        'admin'::public.app_role
      )
    )
  );

DROP TRIGGER IF EXISTS trg_hl_label_sets_touch_updated_at
  ON public.hl_label_sets;
CREATE TRIGGER trg_hl_label_sets_touch_updated_at
  BEFORE UPDATE ON public.hl_label_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_hl_label_definitions_touch_updated_at
  ON public.hl_label_definitions;
CREATE TRIGGER trg_hl_label_definitions_touch_updated_at
  BEFORE UPDATE ON public.hl_label_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

WITH football AS (
  SELECT id
  FROM public.sports
  WHERE code = 'football'
)
INSERT INTO public.hl_label_sets (
  sport_id,
  code,
  version,
  status,
  is_enabled,
  outcome_policy
)
SELECT
  football.id,
  'highlightly_football_postmatch',
  '1.0.0',
  'draft',
  false,
  jsonb_build_object(
    'contract_version', 'phase8g.0',
    'eligible_match_statuses', jsonb_build_array('finished'),
    'ineligible_match_statuses', jsonb_build_array(
      'scheduled',
      'live',
      'paused',
      'postponed',
      'cancelled',
      'unknown'
    ),
    'requires_ended_at', true,
    'requires_home_and_away_participants', true,
    'requires_final_score', true,
    'awarded_matches_policy', 'manual_review',
    'abandoned_matches_policy', 'reject',
    'corrections_policy', 'new_label_set_version',
    'automatic_generation', false,
    'automatic_training', false,
    'automatic_predictions', false
  )
FROM football
ON CONFLICT (sport_id, code, version) DO UPDATE SET
  status = 'draft',
  is_enabled = false,
  outcome_policy = EXCLUDED.outcome_policy,
  updated_at = now();

WITH target AS (
  SELECT label_set.id
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport
    ON sport.id = label_set.sport_id
   AND sport.code = 'football'
  WHERE label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0'
),
definitions AS (
  SELECT
    'full_time_result'::text AS label_key,
    'full_time_result'::text AS market_family,
    'Resultado final'::text AS display_name,
    NULL::numeric AS line_value,
    ARRAY['home', 'draw', 'away']::text[] AS outcome_domain,
    ARRAY[
      'sports_matches.status',
      'sports_matches.ended_at',
      'sports_match_participants.score_data'
    ]::text[] AS required_sources,
    jsonb_build_object(
      'perspective', 'home',
      'settlement', 'compare_final_goals'
    ) AS settlement_spec
  UNION ALL
  SELECT
    'total_goals_' || replace(line_value::text, '.', '_'),
    'total_goals',
    'Total de gols ' || line_value::text,
    line_value,
    ARRAY['over', 'under']::text[],
    ARRAY[
      'sports_matches.status',
      'sports_matches.ended_at',
      'sports_match_participants.score_data'
    ]::text[],
    jsonb_build_object(
      'settlement', 'compare_total_final_goals',
      'line', line_value
    )
  FROM (
    SELECT generate_series(1, 19, 2)::numeric / 2 AS line_value
  ) AS goal_lines
  UNION ALL
  SELECT
    'both_teams_to_score',
    'both_teams_to_score',
    'Ambas as equipes marcam',
    NULL::numeric,
    ARRAY['yes', 'no']::text[],
    ARRAY[
      'sports_matches.status',
      'sports_matches.ended_at',
      'sports_match_participants.score_data'
    ]::text[],
    jsonb_build_object(
      'settlement', 'both_final_goal_totals_above_zero'
    )
  UNION ALL
  SELECT
    'first_team_to_score',
    'first_team_to_score',
    'Primeira equipe a marcar',
    NULL::numeric,
    ARRAY['home', 'away', 'none']::text[],
    ARRAY[
      'sports_matches.status',
      'sports_matches.ended_at',
      'sports_match_events.event_type',
      'sports_match_events.team_id',
      'sports_match_events.elapsed_seconds'
    ]::text[],
    jsonb_build_object(
      'settlement', 'first_chronological_valid_goal_event',
      'tie_breaker', 'sequence_key',
      'scoreless_outcome', 'none'
    )
  UNION ALL
  SELECT
    'asian_handicap_home_'
      || CASE WHEN line_value < 0 THEN 'minus_' ELSE 'plus_' END
      || replace(abs(line_value)::text, '.', '_'),
    'asian_handicap',
    'Handicap asiático mandante '
      || CASE WHEN line_value > 0 THEN '+' ELSE '' END
      || line_value::text,
    line_value,
    ARRAY['home_cover', 'away_cover']::text[],
    ARRAY[
      'sports_matches.status',
      'sports_matches.ended_at',
      'sports_match_participants.score_data'
    ]::text[],
    jsonb_build_object(
      'perspective', 'home',
      'settlement', 'compare_home_goal_difference_plus_line',
      'push_policy', 'not_applicable_to_half_lines',
      'line', line_value
    )
  FROM (
    VALUES
      (-0.5::numeric),
      (0.5::numeric),
      (-1.5::numeric),
      (1.5::numeric),
      (2.5::numeric),
      (-3.5::numeric)
  ) AS handicap_lines(line_value)
  UNION ALL
  SELECT
    'total_corners_' || replace(line_value::text, '.', '_'),
    'total_corners',
    'Total de escanteios ' || line_value::text,
    line_value,
    ARRAY['over', 'under']::text[],
    ARRAY[
      'sports_matches.status',
      'sports_matches.ended_at',
      'sports_match_team_stats.numeric_value',
      'hl_metric_definitions.canonical_key'
    ]::text[],
    jsonb_build_object(
      'settlement', 'compare_total_full_time_corners',
      'line', line_value,
      'accepted_metric_keys', jsonb_build_array(
        'corners',
        'corner_kicks',
        'total_corners'
      )
    )
  FROM (
    SELECT generate_series(13, 27, 2)::numeric / 2 AS line_value
  ) AS corner_lines
)
INSERT INTO public.hl_label_definitions (
  label_set_id,
  label_key,
  market_family,
  display_name,
  line_value,
  outcome_domain,
  required_sources,
  settlement_spec,
  status
)
SELECT
  target.id,
  definitions.label_key,
  definitions.market_family,
  definitions.display_name,
  definitions.line_value,
  definitions.outcome_domain,
  definitions.required_sources,
  definitions.settlement_spec,
  'draft'
FROM target
CROSS JOIN definitions
ON CONFLICT (label_set_id, label_key) DO UPDATE SET
  market_family = EXCLUDED.market_family,
  display_name = EXCLUDED.display_name,
  line_value = EXCLUDED.line_value,
  outcome_domain = EXCLUDED.outcome_domain,
  required_sources = EXCLUDED.required_sources,
  settlement_spec = EXCLUDED.settlement_spec,
  status = 'draft',
  updated_at = now();

CREATE OR REPLACE FUNCTION public.get_highlightly_label_contract_report_v1(
  p_sport text DEFAULT 'football',
  p_days integer DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'label contract days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;
  IF p_sport IS DISTINCT FROM 'football' THEN
    RAISE EXCEPTION 'Phase 8G.0 currently supports Football only'
      USING ERRCODE = '22023';
  END IF;
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role(
         (SELECT auth.uid()),
         'admin'::public.app_role
       )
     ) THEN
    RAISE EXCEPTION 'Highlightly label report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH target AS (
    SELECT
      label_set.id,
      label_set.code,
      label_set.version,
      label_set.status,
      label_set.is_enabled,
      label_set.outcome_policy
    FROM public.hl_label_sets AS label_set
    JOIN public.sports AS sport
      ON sport.id = label_set.sport_id
     AND sport.code = p_sport
    WHERE label_set.code = 'highlightly_football_postmatch'
      AND label_set.version = '1.0.0'
    LIMIT 1
  ),
  family_summary AS (
    SELECT
      definition.market_family,
      count(*)::integer AS definitions,
      COALESCE(
        jsonb_agg(
          definition.line_value
          ORDER BY definition.line_value
        ) FILTER (WHERE definition.line_value IS NOT NULL),
        '[]'::jsonb
      ) AS lines,
      jsonb_agg(
        jsonb_build_object(
          'label_key', definition.label_key,
          'display_name', definition.display_name,
          'line_value', definition.line_value,
          'status', definition.status,
          'outcome_domain', definition.outcome_domain,
          'required_sources', definition.required_sources,
          'settlement_spec', definition.settlement_spec
        )
        ORDER BY definition.line_value NULLS FIRST, definition.label_key
      ) AS labels
    FROM target
    JOIN public.hl_label_definitions AS definition
      ON definition.label_set_id = target.id
    GROUP BY definition.market_family
  ),
  finalized AS (
    SELECT match_row.id
    FROM public.sports_matches AS match_row
    JOIN public.sports AS sport
      ON sport.id = match_row.sport_id
     AND sport.code = p_sport
    WHERE match_row.status = 'finished'
      AND match_row.ended_at IS NOT NULL
      AND match_row.ended_at
        >= statement_timestamp() - make_interval(days => p_days)
  ),
  readiness AS (
    SELECT
      count(*)::integer AS finalized_matches,
      count(*) FILTER (
        WHERE (
          SELECT count(DISTINCT participant.role)
          FROM public.sports_match_participants AS participant
          WHERE participant.match_id = finalized.id
            AND participant.role IN ('home', 'away')
        ) = 2
      )::integer AS matches_with_two_participants,
      count(*) FILTER (
        WHERE (
          SELECT count(*)
          FROM public.sports_match_participants AS participant
          WHERE participant.match_id = finalized.id
            AND participant.role IN ('home', 'away')
            AND participant.score_data <> '{}'::jsonb
        ) = 2
      )::integer AS matches_with_nonempty_scores,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM public.sports_match_events AS event
          WHERE event.match_id = finalized.id
            AND lower(event.event_type) IN (
              'goal',
              'penalty_goal',
              'own_goal'
            )
            AND event.team_id IS NOT NULL
        )
      )::integer AS matches_with_goal_events,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM public.sports_match_team_stats AS team_stat
          JOIN public.hl_metric_definitions AS metric
            ON metric.id = team_stat.metric_definition_id
          WHERE team_stat.match_id = finalized.id
            AND team_stat.numeric_value IS NOT NULL
            AND metric.canonical_key IN (
              'corners',
              'corner_kicks',
              'total_corners'
            )
        )
      )::integer AS matches_with_corner_stats
    FROM finalized
  ),
  label_summary AS (
    SELECT
      count(label.id)::integer AS stored_labels,
      count(label.id) FILTER (
        WHERE label.quality_status = 'valid'
      )::integer AS valid_labels,
      count(label.id) FILTER (
        WHERE label.quality_status = 'quarantined'
      )::integer AS quarantined_labels,
      count(label.id) FILTER (
        WHERE label.quality_status = 'rejected'
      )::integer AS rejected_labels
    FROM target
    LEFT JOIN public.hl_match_labels AS label
      ON label.label_set_id = target.id
     AND label.outcome_at
       >= statement_timestamp() - make_interval(days => p_days)
  )
  SELECT jsonb_build_object(
    'phase', '8G.0',
    'quality_contract_version', 'phase8g.0',
    'sport', p_sport,
    'window_days', p_days,
    'label_set', jsonb_build_object(
      'code', target.code,
      'version', target.version,
      'status', target.status,
      'is_enabled', target.is_enabled,
      'outcome_policy', target.outcome_policy
    ),
    'definition_count', (
      SELECT count(*)::integer
      FROM public.hl_label_definitions AS definition
      WHERE definition.label_set_id = target.id
    ),
    'market_families', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(family_summary)
          ORDER BY family_summary.market_family
        )
        FROM family_summary
      ),
      '[]'::jsonb
    ),
    'readiness', to_jsonb(readiness),
    'labels', to_jsonb(label_summary),
    'safeguards', jsonb_build_object(
      'finished_matches_only', true,
      'provider_calls', 0,
      'automatic_generation', false,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN target.id IS NULL THEN 'label_contract_missing'
      WHEN target.is_enabled THEN 'unexpected_enabled_label_set'
      WHEN (
        SELECT count(*)
        FROM public.hl_label_definitions AS definition
        WHERE definition.label_set_id = target.id
      ) <> 27 THEN 'review_label_catalog'
      ELSE 'ready_for_label_readiness_review'
    END
  )
  INTO result
  FROM target
  CROSS JOIN readiness
  CROSS JOIN label_summary;

  RETURN COALESCE(
    result,
    jsonb_build_object(
      'phase', '8G.0',
      'sport', p_sport,
      'recommendation', 'label_contract_missing'
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_label_contract_report_v1(
  text,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_label_contract_report_v1(
  text,
  integer
) TO authenticated, service_role;

COMMENT ON TABLE public.hl_label_sets IS
  'Versioned post-match label contracts. Phase 8G.0 seeds Football 1.0.0 as draft and disabled.';
COMMENT ON TABLE public.hl_label_definitions IS
  'Deterministic market, line, outcome-domain and source requirements for each post-match label.';
COMMENT ON COLUMN public.hl_match_labels.label_set_id IS
  'Versioned contract that governs how the stored post-match labels were settled.';
COMMENT ON COLUMN public.hl_match_labels.lineage IS
  'Source lineage and deterministic settlement evidence for a stored label payload.';
COMMENT ON FUNCTION public.get_highlightly_label_contract_report_v1(
  text,
  integer
) IS
  'Read-only Phase 8G.0 Football label catalog and stored-data readiness report; generates no labels.';

NOTIFY pgrst, 'reload schema';
