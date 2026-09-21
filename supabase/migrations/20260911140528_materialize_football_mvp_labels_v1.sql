-- Fase 3: explicit-ID, stored-data-only materializer for the Football MVP label set.
-- It performs no provider calls and never scans without an explicit match list.

CREATE OR REPLACE FUNCTION public.materialize_football_mvp_labels_v1(
  p_match_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  target_set public.hl_label_sets%ROWTYPE;
  requested_count integer;
  eligible_count integer;
  inserted_count integer;
  target_label_version constant text :=
    'highlightly_football_postmatch_mvp.2.0.0';
BEGIN
  IF p_match_ids IS NULL
     OR cardinality(p_match_ids) < 1
     OR cardinality(p_match_ids) > 500 THEN
    RAISE EXCEPTION 'p_match_ids must contain between 1 and 500 IDs'
      USING ERRCODE = '22023';
  END IF;

  SELECT label_set.*
  INTO target_set
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport
    ON sport.id = label_set.sport_id
   AND sport.code = 'football'
  WHERE label_set.code = 'highlightly_football_postmatch_mvp'
    AND label_set.version = '2.0.0'
    AND label_set.status = 'draft'
    AND NOT label_set.is_enabled
  LIMIT 1;

  IF target_set.id IS NULL THEN
    RAISE EXCEPTION 'Football MVP label set 2.0.0 must be draft and disabled'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM public.hl_label_definitions AS definition
    WHERE definition.label_set_id = target_set.id
      AND definition.status = 'draft'
  ) <> 19 THEN
    RAISE EXCEPTION 'Football MVP label set must contain exactly 19 draft definitions'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer
  INTO requested_count
  FROM (SELECT DISTINCT unnest(p_match_ids) AS match_id) AS requested;

  WITH requested AS (
    SELECT DISTINCT unnest(p_match_ids) AS match_id
  ),
  eligible AS (
    SELECT
      match_row.id AS match_id,
      match_row.updated_at AS source_data_max_at,
      COALESCE(match_row.ended_at, match_row.updated_at) AS outcome_at,
      score_parts.parts[1]::integer AS home_goals,
      score_parts.parts[2]::integer AS away_goals
    FROM requested
    JOIN public.sports_matches AS match_row
      ON match_row.id = requested.match_id
     AND match_row.sport_id = target_set.sport_id
    JOIN public.sports_match_participants AS home
      ON home.match_id = match_row.id AND home.role = 'home'
    JOIN public.sports_match_participants AS away
      ON away.match_id = match_row.id AND away.role = 'away'
     AND away.team_id <> home.team_id
    JOIN public.sports_provider_entities AS competition_entity
      ON competition_entity.entity_type = 'competition'
     AND competition_entity.canonical_id = match_row.competition_id
     AND competition_entity.external_id IN ('33973', '119924', '84182')
    JOIN public.sports_providers AS provider
      ON provider.id = competition_entity.provider_id
     AND provider.code = 'highlightly'
    CROSS JOIN LATERAL (
      SELECT regexp_match(
        COALESCE(match_row.score_data ->> 'current', ''),
        '^[[:space:]]*([0-9]+)[[:space:]]*-[[:space:]]*([0-9]+)[[:space:]]*$'
      ) AS parts
    ) AS score_parts
    WHERE match_row.status = 'finished'
      AND match_row.updated_at IS NOT NULL
      AND match_row.updated_at <= statement_timestamp()
      AND COALESCE(match_row.ended_at, match_row.updated_at)
            <= statement_timestamp()
      AND score_parts.parts IS NOT NULL
  )
  SELECT count(*)::integer INTO eligible_count FROM eligible;

  WITH requested AS (
    SELECT DISTINCT unnest(p_match_ids) AS match_id
  ),
  eligible AS (
    SELECT
      match_row.id AS match_id,
      match_row.updated_at AS source_data_max_at,
      COALESCE(match_row.ended_at, match_row.updated_at) AS outcome_at,
      score_parts.parts[1]::integer AS home_goals,
      score_parts.parts[2]::integer AS away_goals
    FROM requested
    JOIN public.sports_matches AS match_row
      ON match_row.id = requested.match_id
     AND match_row.sport_id = target_set.sport_id
    JOIN public.sports_match_participants AS home
      ON home.match_id = match_row.id AND home.role = 'home'
    JOIN public.sports_match_participants AS away
      ON away.match_id = match_row.id AND away.role = 'away'
     AND away.team_id <> home.team_id
    JOIN public.sports_provider_entities AS competition_entity
      ON competition_entity.entity_type = 'competition'
     AND competition_entity.canonical_id = match_row.competition_id
     AND competition_entity.external_id IN ('33973', '119924', '84182')
    JOIN public.sports_providers AS provider
      ON provider.id = competition_entity.provider_id
     AND provider.code = 'highlightly'
    CROSS JOIN LATERAL (
      SELECT regexp_match(
        COALESCE(match_row.score_data ->> 'current', ''),
        '^[[:space:]]*([0-9]+)[[:space:]]*-[[:space:]]*([0-9]+)[[:space:]]*$'
      ) AS parts
    ) AS score_parts
    WHERE match_row.status = 'finished'
      AND match_row.updated_at IS NOT NULL
      AND match_row.updated_at <= statement_timestamp()
      AND COALESCE(match_row.ended_at, match_row.updated_at)
            <= statement_timestamp()
      AND score_parts.parts IS NOT NULL
  ),
  prepared AS (
    SELECT
      eligible.*,
      labels.values AS label_values
    FROM eligible
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'label_key', definition.label_key,
          'market_family', definition.market_family,
          'display_name', definition.display_name,
          'line_value', definition.line_value,
          'outcome', CASE definition.market_family
            WHEN 'full_time_result' THEN
              CASE
                WHEN eligible.home_goals > eligible.away_goals THEN 'home'
                WHEN eligible.home_goals < eligible.away_goals THEN 'away'
                ELSE 'draw'
              END
            WHEN 'both_teams_to_score' THEN
              CASE
                WHEN eligible.home_goals > 0 AND eligible.away_goals > 0
                  THEN 'yes'
                ELSE 'no'
              END
            WHEN 'total_goals' THEN
              CASE
                WHEN eligible.home_goals + eligible.away_goals
                       > definition.line_value THEN 'over'
                ELSE 'under'
              END
            WHEN 'asian_handicap' THEN
              CASE
                WHEN eligible.home_goals - eligible.away_goals
                       + definition.line_value > 0 THEN 'home_cover'
                ELSE 'away_cover'
              END
          END
        )
        ORDER BY definition.market_family,
                 definition.line_value NULLS FIRST,
                 definition.label_key
      ) AS values
      FROM public.hl_label_definitions AS definition
      WHERE definition.label_set_id = target_set.id
        AND definition.status = 'draft'
    ) AS labels
  ),
  inserted AS (
    INSERT INTO public.hl_match_labels (
      match_id,
      label_set_id,
      label_version,
      outcome_at,
      label_available_at,
      labels,
      quality_status,
      source_data_max_at,
      lineage
    )
    SELECT
      prepared.match_id,
      target_set.id,
      target_label_version,
      prepared.outcome_at,
      statement_timestamp(),
      jsonb_build_object(
        'contract_version', 'phase3.mvp.2.0.0',
        'scope', 'football_pregame_mvp',
        'definition_count', jsonb_array_length(prepared.label_values),
        'values', prepared.label_values
      ),
      'valid',
      prepared.source_data_max_at,
      jsonb_build_object(
        'phase', '3',
        'label_set_code', target_set.code,
        'label_set_version', target_set.version,
        'generation_mode', 'explicit_match_ids',
        'score_source', 'sports_matches.score_data.current',
        'terminal_observation_source',
          CASE
            WHEN prepared.outcome_at = prepared.source_data_max_at
              THEN 'provider_finished_updated_at_fallback'
            ELSE 'ended_at'
          END,
        'provider_calls', 0,
        'automatic_training', false,
        'automatic_predictions', false
      )
    FROM prepared
    ON CONFLICT (match_id, label_version) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer INTO inserted_count FROM inserted;

  RETURN jsonb_build_object(
    'contract_version', 'football_mvp_label_materializer@1.0.0',
    'label_version', target_label_version,
    'requested', requested_count,
    'eligible', eligible_count,
    'inserted', inserted_count,
    'already_present_or_skipped', eligible_count - inserted_count,
    'ineligible', requested_count - eligible_count,
    'provider_calls', 0,
    'automatic_training', false,
    'automatic_predictions', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.materialize_football_mvp_labels_v1(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_football_mvp_labels_v1(uuid[])
  TO service_role;

COMMENT ON FUNCTION public.materialize_football_mvp_labels_v1(uuid[]) IS
  'Explicit-ID, stored-data-only Football MVP label materializer. Generates exactly the versioned label definitions and performs zero provider calls.';
