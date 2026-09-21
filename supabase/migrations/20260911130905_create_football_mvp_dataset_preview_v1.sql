-- Fase 3 / F3-031
-- Preview read-only por liga e motivo. Nao persiste snapshots, labels ou dataset.

CREATE OR REPLACE FUNCTION public.get_football_mvp_dataset_preview_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer DEFAULT 100,
  p_horizon_key text DEFAULT 't24h'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  target_spec public.hl_training_dataset_specs%ROWTYPE;
  candidate record;
  feature_payload jsonb;
  feature_state text;
  feature_codes jsonb;
  dataset_state text;
  dataset_codes jsonb;
  label_row record;
  preview_rows jsonb := '[]'::jsonb;
  result jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'preview window must satisfy p_from < p_to'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'preview limit must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;
  IF p_horizon_key NOT IN ('t24h', 't6h', 't60m') THEN
    RAISE EXCEPTION 'unsupported preview horizon: %', p_horizon_key
      USING ERRCODE = '22023';
  END IF;

  SELECT dataset_spec.* INTO target_spec
  FROM public.hl_training_dataset_specs AS dataset_spec
  JOIN public.sports AS sport
    ON sport.id = dataset_spec.sport_id
   AND sport.code = 'football'
  WHERE dataset_spec.code = 'football_mvp_pl_laliga_j1'
    AND dataset_spec.version = '1.0.0'
  LIMIT 1;

  IF target_spec.id IS NULL THEN
    RAISE EXCEPTION 'football MVP dataset spec 1.0.0 not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF target_spec.is_enabled OR target_spec.status <> 'draft' THEN
    RAISE EXCEPTION 'football MVP dataset preview requires draft disabled spec'
      USING ERRCODE = '55000';
  END IF;

  FOR candidate IN
    SELECT DISTINCT ON (match_row.id)
      match_row.id AS match_id,
      match_row.kickoff_at,
      match_row.status AS match_status,
      competition.id AS competition_id,
      competition.name AS competition_name,
      provider_entity.external_id AS competition_external_id
    FROM public.sports_matches AS match_row
    JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.entity_type = 'competition'
     AND provider_entity.canonical_id = competition.id
    JOIN public.sports_providers AS provider
      ON provider.id = provider_entity.provider_id
     AND provider.code = 'highlightly'
    WHERE match_row.sport_id = target_spec.sport_id
      AND match_row.kickoff_at >= p_from
      AND match_row.kickoff_at < p_to
      AND provider_entity.external_id IN ('33973', '119924', '84182')
    ORDER BY match_row.id, provider_entity.last_seen_at DESC
    LIMIT p_limit
  LOOP
    feature_payload := NULL;
    feature_state := 'MATCH_BLOCKED';
    feature_codes := '[]'::jsonb;
    dataset_codes := '[]'::jsonb;

    BEGIN
      feature_payload := public.preview_football_prematch_features_v2(
        candidate.match_id,
        p_horizon_key
      );
      feature_state := COALESCE(
        feature_payload #>> '{quality,match_state}',
        'MATCH_BLOCKED'
      );
      feature_codes := COALESCE(
        feature_payload #> '{quality,codes}',
        '[]'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      feature_codes := jsonb_build_array(
        'FEATURE_PREVIEW_ERROR_' || SQLSTATE
      );
    END;

    SELECT
      label.id,
      label.quality_status,
      label.outcome_at,
      label.label_available_at
    INTO label_row
    FROM public.hl_match_labels AS label
    WHERE label.match_id = candidate.match_id
      AND label.label_set_id = target_spec.label_set_id
      AND label.label_version = target_spec.label_version
    ORDER BY label.label_available_at DESC
    LIMIT 1;

    IF candidate.match_status NOT IN ('finished', 'ended', 'completed') THEN
      dataset_state := 'NOT_DUE';
      dataset_codes := dataset_codes || '"LABEL_NOT_DUE"'::jsonb;
    ELSIF feature_state = 'MATCH_BLOCKED' THEN
      dataset_state := 'MATCH_BLOCKED';
    ELSIF label_row.id IS NULL THEN
      dataset_state := 'LABEL_BLOCKED';
      dataset_codes := dataset_codes || '"LABEL_MISSING"'::jsonb;
    ELSIF label_row.quality_status <> 'valid' THEN
      dataset_state := 'LABEL_BLOCKED';
      dataset_codes := dataset_codes || '"LABEL_NOT_VALID"'::jsonb;
    ELSIF feature_state = 'DEGRADED' THEN
      dataset_state := 'DEGRADED';
    ELSE
      dataset_state := 'READY';
    END IF;

    preview_rows := preview_rows || jsonb_build_array(jsonb_build_object(
      'match_id', candidate.match_id,
      'kickoff_at', candidate.kickoff_at,
      'match_status', candidate.match_status,
      'competition_id', candidate.competition_id,
      'competition_name', candidate.competition_name,
      'competition_external_id', candidate.competition_external_id,
      'feature_state', feature_state,
      'dataset_state', dataset_state,
      'codes', feature_codes || dataset_codes,
      'cutoff_at', feature_payload #>> '{cutoff,cutoff_at}',
      'source_max_at', feature_payload #>> '{cutoff,source_max_at}',
      'quote_count', COALESCE(
        (feature_payload #>> '{markets,quote_count}')::integer,
        0
      ),
      'label_id', label_row.id,
      'label_quality_status', label_row.quality_status
    ));
  END LOOP;

  SELECT jsonb_build_object(
    'contract_version', 'football_mvp_dataset_preview@1.0.0',
    'dataset_spec', 'football_mvp_pl_laliga_j1@1.0.0',
    'window_from', p_from,
    'window_to', p_to,
    'horizon_key', p_horizon_key,
    'provider_calls', 0,
    'automatic_build', false,
    'total_matches', jsonb_array_length(preview_rows),
    'states', COALESCE((
      SELECT jsonb_object_agg(state_row.dataset_state, state_row.total)
      FROM (
        SELECT row_data ->> 'dataset_state' AS dataset_state,
               count(*) AS total
        FROM jsonb_array_elements(preview_rows) AS rows(row_data)
        GROUP BY row_data ->> 'dataset_state'
      ) AS state_row
    ), '{}'::jsonb),
    'leagues', COALESCE((
      SELECT jsonb_agg(to_jsonb(league_row) ORDER BY league_row.competition_name)
      FROM (
        SELECT row_data ->> 'competition_name' AS competition_name,
               row_data ->> 'competition_external_id' AS competition_external_id,
               count(*) AS matches,
               count(*) FILTER (
                 WHERE row_data ->> 'dataset_state' = 'READY'
               ) AS ready,
               count(*) FILTER (
                 WHERE row_data ->> 'dataset_state' = 'DEGRADED'
               ) AS degraded,
               count(*) FILTER (
                 WHERE row_data ->> 'dataset_state' IN (
                   'MATCH_BLOCKED', 'LABEL_BLOCKED'
                 )
               ) AS blocked,
               count(*) FILTER (
                 WHERE row_data ->> 'dataset_state' = 'NOT_DUE'
               ) AS not_due
        FROM jsonb_array_elements(preview_rows) AS rows(row_data)
        GROUP BY row_data ->> 'competition_name',
                 row_data ->> 'competition_external_id'
      ) AS league_row
    ), '[]'::jsonb),
    'blocking_reasons', COALESCE((
      SELECT jsonb_object_agg(code_row.code, code_row.total)
      FROM (
        SELECT code_value #>> '{}' AS code, count(*) AS total
        FROM jsonb_array_elements(preview_rows) AS rows(row_data)
        CROSS JOIN LATERAL jsonb_array_elements(row_data -> 'codes')
          AS codes(code_value)
        GROUP BY code_value #>> '{}'
      ) AS code_row
    ), '{}'::jsonb),
    'rows', preview_rows
  ) INTO result;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.get_football_mvp_dataset_preview_v1(
  timestamptz, timestamptz, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_football_mvp_dataset_preview_v1(
  timestamptz, timestamptz, integer, text
) TO service_role;

COMMENT ON FUNCTION public.get_football_mvp_dataset_preview_v1(
  timestamptz, timestamptz, integer, text
) IS 'Read-only F3-031 preview by MVP league, state and blocking reason; performs zero provider calls and persists nothing.';
