CREATE INDEX IF NOT EXISTS idx_sports_matches_finished_keyset
  ON public.sports_matches (
    sport_id,
    kickoff_at DESC,
    id DESC
  )
  WHERE status = 'finished';

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_hl_training_accumulation_runs_cycle_key
  ON public.hl_training_accumulation_runs (
    (diagnostics ->> 'cycle_key')
  )
  WHERE diagnostics ? 'cycle_key';

CREATE OR REPLACE FUNCTION
  public.get_highlightly_score_label_batch_preview_v1(
    p_days integer DEFAULT 365,
    p_limit integer DEFAULT 20,
    p_before_at timestamptz DEFAULT NULL,
    p_before_id uuid DEFAULT NULL
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
    RAISE EXCEPTION 'batch preview days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'batch preview limit must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;
  IF (p_before_at IS NULL) IS DISTINCT FROM (p_before_id IS NULL) THEN
    RAISE EXCEPTION
      'batch preview cursor requires both timestamp and match id'
      USING ERRCODE = '22023';
  END IF;

  WITH football AS (
    SELECT sport.id
    FROM public.sports AS sport
    WHERE sport.code = 'football'
  ),
  target AS (
    SELECT label_set.*
    FROM public.hl_label_sets AS label_set
    JOIN football
      ON football.id = label_set.sport_id
    WHERE label_set.code = 'highlightly_football_postmatch'
      AND label_set.version = '1.0.0'
      AND label_set.status = 'draft'
      AND NOT label_set.is_enabled
    LIMIT 1
  ),
  candidate AS MATERIALIZED (
    SELECT
      match_row.id AS match_id,
      match_row.competition_id,
      competition.name AS competition_name,
      match_row.kickoff_at,
      match_row.ended_at,
      match_row.provider_status,
      match_row.score_data,
      home_participant.team_id AS home_team_id,
      home_team.name AS home_team_name,
      away_participant.team_id AS away_team_id,
      away_team.name AS away_team_name
    FROM public.sports_matches AS match_row
    JOIN football
      ON football.id = match_row.sport_id
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN public.sports_match_participants AS home_participant
      ON home_participant.match_id = match_row.id
     AND home_participant.role = 'home'
    LEFT JOIN public.sports_teams AS home_team
      ON home_team.id = home_participant.team_id
    LEFT JOIN public.sports_match_participants AS away_participant
      ON away_participant.match_id = match_row.id
     AND away_participant.role = 'away'
    LEFT JOIN public.sports_teams AS away_team
      ON away_team.id = away_participant.team_id
    WHERE match_row.status = 'finished'
      AND match_row.kickoff_at IS NOT NULL
      AND match_row.kickoff_at <= statement_timestamp()
      AND match_row.kickoff_at
        >= statement_timestamp() - make_interval(days => p_days)
      AND (
        p_before_at IS NULL
        OR (match_row.kickoff_at, match_row.id)
          < (p_before_at, p_before_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.hl_match_labels AS label
        WHERE label.match_id = match_row.id
          AND label.label_version
            = 'highlightly_football_postmatch.score.1.0.0'
      )
    ORDER BY match_row.kickoff_at DESC, match_row.id DESC
    LIMIT p_limit
  ),
  parsed AS (
    SELECT
      candidate.*,
      score_match.parts AS score_parts,
      COALESCE(
        NULLIF(candidate.score_data ->> 'penalties', ''),
        ''
      ) <> '' AS penalties_present,
      lower(COALESCE(candidate.provider_status, '')) ~
        '(awarded|abandon|penalt|extra[[:space:]]+time)'
        AS terminal_state_requires_review
    FROM candidate
    CROSS JOIN LATERAL (
      SELECT regexp_match(
        COALESCE(candidate.score_data ->> 'current', ''),
        '^[[:space:]]*([0-9]+)[[:space:]]*-[[:space:]]*'
          || '([0-9]+)[[:space:]]*$'
      ) AS parts
    ) AS score_match
  ),
  scored AS (
    SELECT
      parsed.*,
      CASE
        WHEN parsed.score_parts IS NOT NULL
          THEN parsed.score_parts[1]::integer
      END AS home_score,
      CASE
        WHEN parsed.score_parts IS NOT NULL
          THEN parsed.score_parts[2]::integer
      END AS away_score
    FROM parsed
  ),
  assessed AS (
    SELECT
      scored.*,
      provider_observation.last_seen_at
        AS provider_finished_observed_at,
      COALESCE(
        scored.ended_at,
        provider_observation.last_seen_at
      ) AS terminal_observed_at,
      CASE
        WHEN scored.ended_at IS NOT NULL
          THEN 'lifecycle_ended_at'
        WHEN provider_observation.last_seen_at IS NOT NULL
          THEN 'provider_finished_observation'
      END AS terminal_observation_source,
      CASE
        WHEN scored.terminal_state_requires_review
          OR scored.penalties_present
          THEN 'terminal_state_requires_manual_review'
        WHEN scored.home_team_id IS NULL
          OR scored.away_team_id IS NULL
          THEN 'participants_missing'
        WHEN scored.home_team_id = scored.away_team_id
          THEN 'participant_identity_collision'
        WHEN scored.home_score IS NULL
          OR scored.away_score IS NULL
          THEN 'score_missing_or_invalid'
        WHEN COALESCE(
          scored.ended_at,
          provider_observation.last_seen_at
        ) IS NULL
          THEN 'terminal_observation_missing'
        ELSE NULL
      END AS block_reason
    FROM scored
    LEFT JOIN LATERAL (
      SELECT provider_entity.last_seen_at
      FROM public.sports_provider_entities AS provider_entity
      JOIN public.sports_providers AS provider
        ON provider.id = provider_entity.provider_id
       AND provider.code = 'highlightly'
      WHERE provider_entity.canonical_id = scored.match_id
        AND provider_entity.entity_type = 'match'
        AND lower(
          COALESCE(
            provider_entity.provider_payload
              #>> '{state,description}',
            ''
          )
        ) = 'finished'
        AND regexp_replace(
          COALESCE(
            provider_entity.provider_payload
              #>> '{state,score,current}',
            ''
          ),
          '[[:space:]]',
          '',
          'g'
        ) = scored.home_score::text || '-' || scored.away_score::text
        AND provider_entity.last_seen_at >= scored.kickoff_at
      ORDER BY provider_entity.last_seen_at DESC
      LIMIT 1
    ) AS provider_observation ON true
  ),
  label_rows AS (
    SELECT
      assessed.match_id,
      definition.label_key,
      definition.market_family,
      definition.display_name,
      definition.line_value,
      CASE
        WHEN assessed.block_reason IS NOT NULL THEN NULL
        WHEN definition.market_family = 'full_time_result' THEN
          CASE
            WHEN assessed.home_score > assessed.away_score THEN 'home'
            WHEN assessed.home_score < assessed.away_score THEN 'away'
            ELSE 'draw'
          END
        WHEN definition.market_family = 'total_goals' THEN
          CASE
            WHEN assessed.home_score + assessed.away_score
              > definition.line_value THEN 'over'
            ELSE 'under'
          END
        WHEN definition.market_family = 'both_teams_to_score' THEN
          CASE
            WHEN assessed.home_score > 0 AND assessed.away_score > 0
              THEN 'yes'
            ELSE 'no'
          END
        WHEN definition.market_family = 'asian_handicap' THEN
          CASE
            WHEN assessed.home_score - assessed.away_score
              + definition.line_value > 0 THEN 'home_cover'
            ELSE 'away_cover'
          END
      END AS outcome
    FROM assessed
    CROSS JOIN target
    JOIN public.hl_label_definitions AS definition
      ON definition.label_set_id = target.id
     AND definition.market_family IN (
       'full_time_result',
       'total_goals',
       'both_teams_to_score',
       'asian_handicap'
     )
  ),
  labels_by_match AS (
    SELECT
      label_row.match_id,
      count(*)::integer AS definition_count,
      jsonb_agg(
        jsonb_build_object(
          'label_key', label_row.label_key,
          'market_family', label_row.market_family,
          'display_name', label_row.display_name,
          'line_value', label_row.line_value,
          'outcome', label_row.outcome
        )
        ORDER BY
          label_row.market_family,
          label_row.line_value NULLS FIRST,
          label_row.label_key
      ) AS labels
    FROM label_rows AS label_row
    GROUP BY label_row.match_id
  ),
  payload AS (
    SELECT
      assessed.match_id,
      assessed.competition_id,
      assessed.competition_name,
      assessed.kickoff_at,
      assessed.home_team_id,
      assessed.home_team_name,
      assessed.away_team_id,
      assessed.away_team_name,
      assessed.home_score,
      assessed.away_score,
      assessed.terminal_observed_at,
      assessed.terminal_observation_source,
      assessed.block_reason,
      COALESCE(labels_by_match.definition_count, 0)
        AS definition_count,
      COALESCE(labels_by_match.labels, '[]'::jsonb) AS labels
    FROM assessed
    LEFT JOIN labels_by_match
      ON labels_by_match.match_id = assessed.match_id
  ),
  page_tail AS (
    SELECT candidate.kickoff_at, candidate.match_id
    FROM candidate
    ORDER BY candidate.kickoff_at, candidate.match_id
    LIMIT 1
  ),
  page_summary AS (
    SELECT
      count(*)::integer AS candidates_considered,
      count(*) FILTER (
        WHERE payload.block_reason IS NULL
          AND payload.definition_count = 18
      )::integer AS candidates_eligible,
      count(*) FILTER (
        WHERE payload.block_reason IS NOT NULL
          OR payload.definition_count <> 18
      )::integer AS candidates_blocked
    FROM payload
  ),
  more AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.sports_matches AS match_row
      JOIN football
        ON football.id = match_row.sport_id
      CROSS JOIN page_tail
      WHERE match_row.status = 'finished'
        AND match_row.kickoff_at IS NOT NULL
        AND match_row.kickoff_at
          >= statement_timestamp() - make_interval(days => p_days)
        AND (match_row.kickoff_at, match_row.id)
          < (page_tail.kickoff_at, page_tail.match_id)
        AND NOT EXISTS (
          SELECT 1
          FROM public.hl_match_labels AS label
          WHERE label.match_id = match_row.id
            AND label.label_version
              = 'highlightly_football_postmatch.score.1.0.0'
        )
    ) AS has_more
  )
  SELECT jsonb_build_object(
    'phase', '8G.4.2',
    'quality_contract_version', 'phase8g.4.2',
    'mode', 'dry-run',
    'sport', 'football',
    'window_days', p_days,
    'batch_limit', p_limit,
    'cursor_before', CASE
      WHEN p_before_at IS NULL THEN NULL
      ELSE jsonb_build_object(
        'kickoff_at', p_before_at,
        'match_id', p_before_id
      )
    END,
    'next_cursor', CASE
      WHEN COALESCE(more.has_more, false) THEN
        jsonb_build_object(
          'kickoff_at', page_tail.kickoff_at,
          'match_id', page_tail.match_id
        )
      ELSE NULL
    END,
    'has_more', COALESCE(more.has_more, false),
    'candidates_considered', page_summary.candidates_considered,
    'candidates_eligible', page_summary.candidates_eligible,
    'candidates_blocked', page_summary.candidates_blocked,
    'matches', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(payload)
          ORDER BY payload.kickoff_at DESC, payload.match_id DESC
        )
        FROM payload
      ),
      '[]'::jsonb
    ),
    'safeguards', jsonb_build_object(
      'read_only', true,
      'stored_data_only', true,
      'provider_calls', 0,
      'labels_written', 0,
      'cursor_pagination', true,
      'existing_labels_excluded', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN page_summary.candidates_considered = 0
        THEN 'batch_window_exhausted'
      WHEN page_summary.candidates_eligible = 0
        THEN 'advance_cursor_past_blocked_batch'
      ELSE 'ready_for_batched_label_materialization'
    END
  )
  INTO result
  FROM page_summary
  LEFT JOIN page_tail ON true
  LEFT JOIN more ON true;

  RETURN COALESCE(
    result,
    jsonb_build_object(
      'phase', '8G.4.2',
      'quality_contract_version', 'phase8g.4.2',
      'mode', 'dry-run',
      'sport', 'football',
      'candidates_considered', 0,
      'candidates_eligible', 0,
      'candidates_blocked', 0,
      'matches', '[]'::jsonb,
      'has_more', false,
      'next_cursor', NULL,
      'recommendation', 'batch_window_exhausted'
    )
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.get_highlightly_score_label_batch_preview_v1(
      integer,
      integer,
      timestamptz,
      uuid
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.get_highlightly_score_label_batch_preview_v1(
      integer,
      integer,
      timestamptz,
      uuid
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.materialize_highlightly_football_score_labels_v2(
    p_days integer DEFAULT 365,
    p_limit integer DEFAULT 20,
    p_before_at timestamptz DEFAULT NULL,
    p_before_id uuid DEFAULT NULL
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  target public.hl_label_sets%ROWTYPE;
  provider_enabled boolean;
  preview jsonb;
  target_run_id uuid;
  considered_count integer := 0;
  eligible_count integer := 0;
  inserted_count integer := 0;
  blocked_count integer := 0;
  target_label_version constant text :=
    'highlightly_football_postmatch.score.1.0.0';
BEGIN
  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must be disabled before label batching'
      USING ERRCODE = '55000';
  END IF;

  SELECT label_set.*
  INTO target
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport
    ON sport.id = label_set.sport_id
   AND sport.code = 'football'
  WHERE label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0'
    AND label_set.status = 'draft'
    AND NOT label_set.is_enabled
  LIMIT 1;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Football label set 1.0.0 must be installed'
      USING ERRCODE = '55000';
  END IF;

  preview := public.get_highlightly_score_label_batch_preview_v1(
    p_days,
    p_limit,
    p_before_at,
    p_before_id
  );
  considered_count :=
    COALESCE((preview ->> 'candidates_considered')::integer, 0);
  eligible_count :=
    COALESCE((preview ->> 'candidates_eligible')::integer, 0);
  blocked_count :=
    COALESCE((preview ->> 'candidates_blocked')::integer, 0);

  INSERT INTO public.hl_label_materialization_runs (
    label_set_id,
    sport_id,
    label_version,
    window_days,
    sample_limit,
    diagnostics
  )
  VALUES (
    target.id,
    target.sport_id,
    target_label_version,
    p_days,
    p_limit,
    jsonb_build_object(
      'phase', '8G.4.2',
      'quality_contract_version', 'phase8g.4.2',
      'generation_mode', 'cursor_batch',
      'cursor_before', preview -> 'cursor_before',
      'next_cursor', preview -> 'next_cursor',
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  )
  RETURNING id INTO target_run_id;

  WITH source_matches AS (
    SELECT
      match_value,
      (match_value ->> 'match_id')::uuid AS match_id,
      (match_value ->> 'terminal_observed_at')::timestamptz
        AS terminal_observed_at,
      match_value ->> 'terminal_observation_source'
        AS terminal_observation_source,
      match_value ->> 'block_reason' AS block_reason,
      (match_value ->> 'definition_count')::integer
        AS definition_count
    FROM jsonb_array_elements(
      COALESCE(preview -> 'matches', '[]'::jsonb)
    ) AS match_value
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
      source.match_id,
      target.id,
      target_label_version,
      source.terminal_observed_at,
      statement_timestamp(),
      jsonb_build_object(
        'contract_version', 'phase8g.4.2',
        'scope', 'score_based',
        'definition_count', source.definition_count,
        'values', source.match_value -> 'labels'
      ),
      'valid',
      source.terminal_observed_at,
      jsonb_build_object(
        'phase', '8G.4.2',
        'quality_contract_version', 'phase8g.4.2',
        'materialization_run_id', target_run_id,
        'label_set_code', target.code,
        'label_set_version', target.version,
        'terminal_observation_source',
          source.terminal_observation_source,
        'terminal_observed_at', source.terminal_observed_at,
        'generation_mode', 'cursor_batch',
        'provider_calls', 0,
        'automatic_training', false,
        'automatic_predictions', false
      )
    FROM source_matches AS source
    WHERE NULLIF(source.block_reason, '') IS NULL
      AND source.terminal_observed_at IS NOT NULL
      AND source.definition_count = 18
    ON CONFLICT (match_id, label_version) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer
  INTO inserted_count
  FROM inserted;

  UPDATE public.hl_label_materialization_runs AS run
  SET
    status = CASE
      WHEN blocked_count > 0
        THEN 'completed_with_exceptions'
      ELSE 'completed'
    END,
    matches_considered = considered_count,
    matches_eligible = eligible_count,
    labels_inserted = inserted_count,
    labels_skipped = greatest(eligible_count - inserted_count, 0),
    labels_blocked = blocked_count,
    provider_calls = 0,
    finished_at = statement_timestamp(),
    diagnostics = run.diagnostics || jsonb_build_object(
      'labels_written', inserted_count,
      'labels_blocked', blocked_count,
      'has_more', COALESCE((preview ->> 'has_more')::boolean, false)
    )
  WHERE run.id = target_run_id;

  RETURN jsonb_build_object(
    'phase', '8G.4.2',
    'quality_contract_version', 'phase8g.4.2',
    'run_id', target_run_id,
    'sport', 'football',
    'window_days', p_days,
    'batch_limit', p_limit,
    'cursor_before', preview -> 'cursor_before',
    'next_cursor', preview -> 'next_cursor',
    'has_more', COALESCE((preview ->> 'has_more')::boolean, false),
    'candidates_considered', considered_count,
    'candidates_eligible', eligible_count,
    'candidates_blocked', blocked_count,
    'labels_inserted', inserted_count,
    'labels_skipped', greatest(eligible_count - inserted_count, 0),
    'safeguards', jsonb_build_object(
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'stored_data_only', true,
      'cursor_pagination', true,
      'immutable_labels', true,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN considered_count = 0 THEN 'batch_window_exhausted'
      WHEN COALESCE((preview ->> 'has_more')::boolean, false)
        THEN 'continue_next_cursor'
      ELSE 'rebuild_feature_overlap_and_dataset'
    END
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.materialize_highlightly_football_score_labels_v2(
      integer,
      integer,
      timestamptz,
      uuid
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.materialize_highlightly_football_score_labels_v2(
      integer,
      integer,
      timestamptz,
      uuid
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.start_highlightly_training_accumulation_cycle_v2(
    p_cycle_key text,
    p_days integer DEFAULT 365,
    p_batch_limit integer DEFAULT 20,
    p_feature_limit integer DEFAULT 20,
    p_max_candidates_per_kickoff integer DEFAULT 20,
    p_dataset_limit integer DEFAULT 500,
    p_max_batches integer DEFAULT 5
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  football_id uuid;
  provider_enabled boolean;
  existing_run public.hl_training_accumulation_runs%ROWTYPE;
  target_run_id uuid;
BEGIN
  IF p_cycle_key IS NULL
     OR p_cycle_key !~ '^phase8g42:[a-z0-9:_-]{1,96}$' THEN
    RAISE EXCEPTION 'invalid Phase 8G.4.2 cycle key'
      USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650
     OR p_batch_limit IS NULL OR p_batch_limit < 1 OR p_batch_limit > 50
     OR p_feature_limit IS NULL OR p_feature_limit < 1
       OR p_feature_limit > 50
     OR p_max_candidates_per_kickoff IS NULL
       OR p_max_candidates_per_kickoff < 1
       OR p_max_candidates_per_kickoff > 100
     OR p_dataset_limit IS NULL OR p_dataset_limit < 1
       OR p_dataset_limit > 5000
     OR p_max_batches IS NULL OR p_max_batches < 1
       OR p_max_batches > 20 THEN
    RAISE EXCEPTION 'invalid Phase 8G.4.2 bounded limits'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must be disabled before accumulation cycle'
      USING ERRCODE = '55000';
  END IF;

  SELECT sport.id
  INTO football_id
  FROM public.sports AS sport
  WHERE sport.code = 'football';
  IF football_id IS NULL THEN
    RAISE EXCEPTION 'Football sport must be installed'
      USING ERRCODE = '55000';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('highlightly:phase8g42:' || p_cycle_key, 0)
  );

  SELECT accumulation.*
  INTO existing_run
  FROM public.hl_training_accumulation_runs AS accumulation
  WHERE accumulation.diagnostics ->> 'cycle_key' = p_cycle_key
  LIMIT 1;
  IF existing_run.id IS NOT NULL THEN
    IF existing_run.window_days <> p_days
       OR existing_run.label_limit <> p_batch_limit
       OR existing_run.feature_limit <> p_feature_limit
       OR existing_run.max_candidates_per_kickoff
         <> p_max_candidates_per_kickoff
       OR existing_run.dataset_limit <> p_dataset_limit
       OR COALESCE(
         (existing_run.diagnostics ->> 'max_batches')::integer,
         -1
       ) <> p_max_batches THEN
      RAISE EXCEPTION
        'Phase 8G.4.2 cycle key already exists with different limits'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'phase', '8G.4.2',
      'quality_contract_version', 'phase8g.4.2',
      'run_id', existing_run.id,
      'status', existing_run.status,
      'idempotent', true,
      'cycle_key', p_cycle_key,
      'batches_completed',
        COALESCE(
          (existing_run.diagnostics ->> 'batches_completed')::integer,
          0
        ),
      'max_batches',
        COALESCE(
          (existing_run.diagnostics ->> 'max_batches')::integer,
          p_max_batches
        ),
      'cursor_state',
        COALESCE(
          existing_run.diagnostics -> 'cursor_state',
          '{}'::jsonb
        ),
      'label_result', existing_run.label_result,
      'feature_result', existing_run.feature_result,
      'finished_at', existing_run.finished_at
    );
  END IF;

  INSERT INTO public.hl_training_accumulation_runs (
    sport_id,
    window_days,
    label_limit,
    feature_limit,
    max_candidates_per_kickoff,
    dataset_limit,
    diagnostics
  )
  VALUES (
    football_id,
    p_days,
    p_batch_limit,
    p_feature_limit,
    p_max_candidates_per_kickoff,
    p_dataset_limit,
    jsonb_build_object(
      'phase', '8G.4.2',
      'quality_contract_version', 'phase8g.4.2',
      'cycle_key', p_cycle_key,
      'max_batches', p_max_batches,
      'batching_mode', 'cursor_keyset',
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  )
  RETURNING id INTO target_run_id;

  RETURN jsonb_build_object(
    'phase', '8G.4.2',
    'quality_contract_version', 'phase8g.4.2',
    'run_id', target_run_id,
    'status', 'running',
    'idempotent', false,
    'cycle_key', p_cycle_key,
    'max_batches', p_max_batches
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.start_highlightly_training_accumulation_cycle_v2(
      text,
      integer,
      integer,
      integer,
      integer,
      integer,
      integer
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.start_highlightly_training_accumulation_cycle_v2(
      text,
      integer,
      integer,
      integer,
      integer,
      integer,
      integer
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.checkpoint_highlightly_training_accumulation_cycle_v2(
    p_run_id uuid,
    p_batches integer,
    p_label_result jsonb,
    p_feature_result jsonb,
    p_cursor_state jsonb
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  provider_enabled boolean;
  target_run public.hl_training_accumulation_runs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL
     OR p_batches IS NULL OR p_batches < 0 OR p_batches > 20
     OR jsonb_typeof(COALESCE(p_label_result, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_feature_result, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_cursor_state, '{}'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid Phase 8G.4.2 checkpoint payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must remain disabled during checkpoint'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.hl_training_accumulation_runs AS accumulation
  SET
    label_result = COALESCE(p_label_result, '{}'::jsonb),
    feature_result = COALESCE(p_feature_result, '{}'::jsonb),
    diagnostics = accumulation.diagnostics || jsonb_build_object(
      'batches_completed', p_batches,
      'cursor_state', COALESCE(p_cursor_state, '{}'::jsonb),
      'last_checkpoint_at', statement_timestamp(),
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  WHERE accumulation.id = p_run_id
    AND accumulation.status = 'running'
    AND accumulation.diagnostics ->> 'phase' = '8G.4.2'
  RETURNING accumulation.* INTO target_run;

  IF target_run.id IS NULL THEN
    RAISE EXCEPTION
      'running Phase 8G.4.2 accumulation cycle not found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'phase', '8G.4.2',
    'quality_contract_version', 'phase8g.4.2',
    'run_id', target_run.id,
    'status', target_run.status,
    'batches_completed', p_batches,
    'cursor_state', p_cursor_state,
    'checkpointed_at',
      target_run.diagnostics -> 'last_checkpoint_at',
    'safeguards', jsonb_build_object(
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.checkpoint_highlightly_training_accumulation_cycle_v2(
      uuid,
      integer,
      jsonb,
      jsonb,
      jsonb
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.checkpoint_highlightly_training_accumulation_cycle_v2(
      uuid,
      integer,
      jsonb,
      jsonb,
      jsonb
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.finish_highlightly_training_accumulation_cycle_v2(
    p_run_id uuid,
    p_status text,
    p_batches integer,
    p_label_result jsonb,
    p_feature_result jsonb,
    p_dataset_result jsonb,
    p_readiness_result jsonb,
    p_cursor_state jsonb DEFAULT '{}'::jsonb,
    p_error_summary jsonb DEFAULT '{}'::jsonb
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  provider_enabled boolean;
  target_run public.hl_training_accumulation_runs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL
     OR p_status NOT IN (
       'completed',
       'completed_with_exceptions',
       'failed'
     )
     OR p_batches IS NULL OR p_batches < 0 OR p_batches > 20
     OR jsonb_typeof(COALESCE(p_label_result, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_feature_result, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_dataset_result, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_readiness_result, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_cursor_state, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_error_summary, '{}'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid Phase 8G.4.2 finalization payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must remain disabled during finalization'
      USING ERRCODE = '55000';
  END IF;

  SELECT accumulation.*
  INTO target_run
  FROM public.hl_training_accumulation_runs AS accumulation
  WHERE accumulation.id = p_run_id
  FOR UPDATE;
  IF target_run.id IS NULL
     OR target_run.diagnostics ->> 'phase' <> '8G.4.2' THEN
    RAISE EXCEPTION 'Phase 8G.4.2 accumulation run not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF target_run.status <> 'running' THEN
    RETURN jsonb_build_object(
      'phase', '8G.4.2',
      'quality_contract_version', 'phase8g.4.2',
      'run_id', target_run.id,
      'status', target_run.status,
      'idempotent', true,
      'finished_at', target_run.finished_at
    );
  END IF;

  UPDATE public.hl_training_accumulation_runs AS accumulation
  SET
    status = p_status,
    label_result = COALESCE(p_label_result, '{}'::jsonb),
    feature_result = COALESCE(p_feature_result, '{}'::jsonb),
    dataset_result = COALESCE(p_dataset_result, '{}'::jsonb),
    readiness_result = COALESCE(p_readiness_result, '{}'::jsonb),
    provider_calls = 0,
    automatic_training = false,
    automatic_predictions = false,
    finished_at = statement_timestamp(),
    diagnostics = accumulation.diagnostics || jsonb_build_object(
      'batches_completed', p_batches,
      'cursor_state', COALESCE(p_cursor_state, '{}'::jsonb),
      'error_summary', COALESCE(p_error_summary, '{}'::jsonb),
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  WHERE accumulation.id = p_run_id
  RETURNING accumulation.* INTO target_run;

  RETURN jsonb_build_object(
    'phase', '8G.4.2',
    'quality_contract_version', 'phase8g.4.2',
    'run_id', target_run.id,
    'status', target_run.status,
    'idempotent', false,
    'batches_completed', p_batches,
    'finished_at', target_run.finished_at,
    'safeguards', jsonb_build_object(
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.finish_highlightly_training_accumulation_cycle_v2(
      uuid,
      text,
      integer,
      jsonb,
      jsonb,
      jsonb,
      jsonb,
      jsonb,
      jsonb
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.finish_highlightly_training_accumulation_cycle_v2(
      uuid,
      text,
      integer,
      jsonb,
      jsonb,
      jsonb,
      jsonb,
      jsonb,
      jsonb
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.get_highlightly_training_accumulation_report_v2(
    p_days integer DEFAULT 30
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  base_report jsonb;
  batch_report jsonb;
BEGIN
  base_report :=
    public.get_highlightly_training_accumulation_report_v1(p_days);

  WITH football AS (
    SELECT sport.id
    FROM public.sports AS sport
    WHERE sport.code = 'football'
  ),
  recent AS (
    SELECT accumulation.*
    FROM public.hl_training_accumulation_runs AS accumulation
    JOIN football
      ON football.id = accumulation.sport_id
    WHERE accumulation.diagnostics ->> 'phase' = '8G.4.2'
      AND accumulation.started_at
        >= statement_timestamp() - make_interval(days => p_days)
  ),
  summary AS (
    SELECT
      count(*)::integer AS cycles,
      count(*) FILTER (
        WHERE status = 'running'
      )::integer AS running_cycles,
      count(*) FILTER (
        WHERE status = 'completed'
      )::integer AS completed_cycles,
      count(*) FILTER (
        WHERE status = 'completed_with_exceptions'
      )::integer AS completed_with_exceptions_cycles,
      count(*) FILTER (
        WHERE status = 'failed'
      )::integer AS failed_cycles,
      COALESCE(
        sum(
          COALESCE(
            (diagnostics ->> 'batches_completed')::integer,
            0
          )
        ),
        0
      )::integer AS batches_completed,
      max(finished_at) AS last_finished_at
    FROM recent
  ),
  latest AS (
    SELECT recent.*
    FROM recent
    ORDER BY recent.started_at DESC, recent.id DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'summary', to_jsonb(summary),
    'latest_cycle', CASE
      WHEN latest.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', latest.id,
        'cycle_key', latest.diagnostics ->> 'cycle_key',
        'status', latest.status,
        'batch_limit', latest.label_limit,
        'feature_limit', latest.feature_limit,
        'dataset_limit', latest.dataset_limit,
        'max_batches', latest.diagnostics -> 'max_batches',
        'batches_completed',
          latest.diagnostics -> 'batches_completed',
        'cursor_state', latest.diagnostics -> 'cursor_state',
        'error_summary', latest.diagnostics -> 'error_summary',
        'started_at', latest.started_at,
        'finished_at', latest.finished_at
      )
    END
  )
  INTO batch_report
  FROM summary
  LEFT JOIN latest ON true;

  RETURN base_report || jsonb_build_object(
    'phase', '8G.4.2',
    'quality_contract_version', 'phase8g.4.2',
    'batching', COALESCE(batch_report, '{}'::jsonb),
    'safeguards',
      COALESCE(base_report -> 'safeguards', '{}'::jsonb)
      || jsonb_build_object(
        'cursor_pagination', true,
        'maximum_batch_size', 50,
        'maximum_batches_per_cycle', 20,
        'automatic_training', false,
        'automatic_predictions', false
      )
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.get_highlightly_training_accumulation_report_v2(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION
    public.get_highlightly_training_accumulation_report_v2(integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION
  public.get_highlightly_score_label_batch_preview_v1(
    integer,
    integer,
    timestamptz,
    uuid
  ) IS
  'Read-only Phase 8G.4.2 keyset batch preview excluding already labeled Football matches.';
COMMENT ON FUNCTION
  public.materialize_highlightly_football_score_labels_v2(
    integer,
    integer,
    timestamptz,
    uuid
  ) IS
  'Stored-data-only Phase 8G.4.2 Football score label materializer with bounded keyset pagination.';
COMMENT ON FUNCTION
  public.start_highlightly_training_accumulation_cycle_v2(
    text,
    integer,
    integer,
    integer,
    integer,
    integer,
    integer
  ) IS
  'Starts one idempotent Phase 8G.4.2 accumulation cycle after provider and limit gates.';
COMMENT ON FUNCTION
  public.checkpoint_highlightly_training_accumulation_cycle_v2(
    uuid,
    integer,
    jsonb,
    jsonb,
    jsonb
  ) IS
  'Persists a resumable Phase 8G.4.2 cursor checkpoint after each bounded batch.';
COMMENT ON FUNCTION
  public.finish_highlightly_training_accumulation_cycle_v2(
    uuid,
    text,
    integer,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    jsonb
  ) IS
  'Finalizes one Phase 8G.4.2 cycle with auditable results and no provider calls.';
COMMENT ON FUNCTION
  public.get_highlightly_training_accumulation_report_v2(integer) IS
  'Admin report for keyset-batched Phase 8G.4.2 training-data accumulation cycles.';

NOTIFY pgrst, 'reload schema';
