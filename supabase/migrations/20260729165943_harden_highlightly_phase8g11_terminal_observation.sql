UPDATE public.hl_label_sets AS label_set
SET
  outcome_policy = (
    label_set.outcome_policy - 'requires_ended_at'
  ) || jsonb_build_object(
    'requires_ended_at', false,
    'requires_terminal_observation_at', true,
    'terminal_observation_sources', jsonb_build_array(
      'sports_matches.ended_at',
      'sports_provider_entities.last_seen_at'
    ),
    'provider_observation_requirements', jsonb_build_object(
      'entity_type', 'match',
      'provider', 'highlightly',
      'state_description', 'Finished',
      'score_must_match_canonical', true,
      'observed_at_must_follow_kickoff', true
    )
  ),
  updated_at = now()
FROM public.sports AS sport
WHERE sport.id = label_set.sport_id
  AND sport.code = 'football'
  AND label_set.code = 'highlightly_football_postmatch'
  AND label_set.version = '1.0.0'
  AND label_set.status = 'draft'
  AND NOT label_set.is_enabled;

CREATE OR REPLACE FUNCTION
  public.get_highlightly_label_settlement_preview_v2(
    p_sport text DEFAULT 'football',
    p_days integer DEFAULT 365,
    p_limit integer DEFAULT 100
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  base_report jsonb;
  corrected_report jsonb;
BEGIN
  IF p_sport IS DISTINCT FROM 'football' THEN
    RAISE EXCEPTION 'Phase 8G.1.1 currently supports Football only'
      USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'settlement preview days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'settlement preview limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role(
         (SELECT auth.uid()),
         'admin'::public.app_role
       )
     ) THEN
    RAISE EXCEPTION 'Highlightly settlement preview requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  base_report :=
    public.get_highlightly_label_settlement_preview_v1(
      p_sport,
      p_days,
      p_limit
    );

  WITH source_matches AS (
    SELECT
      match_value AS match_payload,
      (match_value ->> 'match_id')::uuid AS match_id,
      NULLIF(match_value ->> 'home_team_id', '')::uuid
        AS home_team_id,
      NULLIF(match_value ->> 'away_team_id', '')::uuid
        AS away_team_id,
      (match_value ->> 'home_score')::integer AS home_score,
      (match_value ->> 'away_score')::integer AS away_score,
      (match_value ->> 'total_goals')::integer AS total_goals,
      (match_value ->> 'goal_event_count')::integer
        AS goal_event_count,
      NULLIF(match_value ->> 'first_goal_team_id', '')::uuid
        AS first_goal_team_id,
      (match_value ->> 'total_corners')::numeric
        AS total_corners,
      NULLIF(match_value ->> 'base_block_reason', '')
        AS original_base_block_reason,
      (match_value ->> 'kickoff_at')::timestamptz AS kickoff_at,
      NULLIF(match_value ->> 'ended_at', '')::timestamptz
        AS ended_at
    FROM jsonb_array_elements(
      COALESCE(base_report -> 'matches', '[]'::jsonb)
    ) AS match_value
  ),
  provider_observations AS (
    SELECT
      source_match.match_id,
      provider_observation.last_seen_at
        AS provider_finished_observed_at
    FROM source_matches AS source_match
    LEFT JOIN LATERAL (
      SELECT provider_entity.last_seen_at
      FROM public.sports_provider_entities AS provider_entity
      JOIN public.sports_providers AS provider
        ON provider.id = provider_entity.provider_id
       AND provider.code = 'highlightly'
      WHERE provider_entity.canonical_id = source_match.match_id
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
        ) = source_match.home_score::text
          || '-'
          || source_match.away_score::text
        AND provider_entity.last_seen_at >= source_match.kickoff_at
      ORDER BY provider_entity.last_seen_at DESC
      LIMIT 1
    ) AS provider_observation ON true
  ),
  corner_by_team AS (
    SELECT
      source_match.match_id,
      team_stat.team_id,
      max(team_stat.numeric_value) AS corners
    FROM source_matches AS source_match
    JOIN public.sports_match_team_stats AS team_stat
      ON team_stat.match_id = source_match.match_id
     AND team_stat.period_key IN ('', 'full_time')
    JOIN public.hl_metric_definitions AS metric
      ON metric.id = team_stat.metric_definition_id
     AND metric.resource = 'match_statistics'
     AND metric.canonical_key IN (
       'corners',
       'corner_kicks',
       'total_corners'
     )
    JOIN public.sports_providers AS provider
      ON provider.id = metric.provider_id
     AND provider.code = 'highlightly'
    GROUP BY source_match.match_id, team_stat.team_id
  ),
  corner_readiness AS (
    SELECT
      corner_by_team.match_id,
      count(*) FILTER (
        WHERE corner_by_team.corners IS NOT NULL
          AND corner_by_team.corners >= 0
          AND corner_by_team.corners = trunc(corner_by_team.corners)
      )::integer AS valid_corner_teams
    FROM corner_by_team
    GROUP BY corner_by_team.match_id
  ),
  assessed AS (
    SELECT
      source_match.*,
      COALESCE(
        source_match.ended_at,
        provider_observation.provider_finished_observed_at
      ) AS terminal_observed_at,
      CASE
        WHEN source_match.ended_at IS NOT NULL
          THEN 'lifecycle_ended_at'
        WHEN provider_observation.provider_finished_observed_at
          IS NOT NULL
          THEN 'provider_finished_observation'
      END AS terminal_observation_source,
      CASE
        WHEN source_match.original_base_block_reason
          = 'ended_at_missing'
          AND provider_observation.provider_finished_observed_at
            IS NOT NULL
          THEN NULL
        WHEN source_match.original_base_block_reason
          = 'ended_at_missing'
          THEN 'terminal_observation_missing'
        ELSE source_match.original_base_block_reason
      END AS base_block_reason,
      COALESCE(corner_readiness.valid_corner_teams, 0)
        AS valid_corner_teams
    FROM source_matches AS source_match
    LEFT JOIN provider_observations AS provider_observation
      ON provider_observation.match_id = source_match.match_id
    LEFT JOIN corner_readiness
      ON corner_readiness.match_id = source_match.match_id
  ),
  resource_assessment AS (
    SELECT
      assessed.*,
      CASE
        WHEN assessed.base_block_reason IS NOT NULL
          THEN assessed.base_block_reason
        WHEN assessed.total_goals = 0
          AND assessed.goal_event_count = 0
          THEN NULL
        WHEN assessed.goal_event_count <> assessed.total_goals
          THEN 'goal_event_count_mismatch'
        WHEN assessed.first_goal_team_id IS NULL
          THEN 'first_goal_team_missing'
        WHEN assessed.first_goal_team_id NOT IN (
          assessed.home_team_id,
          assessed.away_team_id
        ) THEN 'first_goal_team_identity_mismatch'
        ELSE NULL
      END AS first_goal_block_reason,
      CASE
        WHEN assessed.base_block_reason IS NOT NULL
          THEN assessed.base_block_reason
        WHEN assessed.valid_corner_teams <> 2
          THEN 'corners_missing_for_one_or_both_teams'
        WHEN assessed.total_corners IS NULL
          OR assessed.total_corners < 0
          OR assessed.total_corners <> trunc(assessed.total_corners)
          THEN 'corners_total_invalid'
        ELSE NULL
      END AS corners_block_reason
    FROM assessed
  ),
  source_labels AS (
    SELECT
      resource_assessment.*,
      label_value AS original_label,
      label_value ->> 'label_key' AS label_key,
      label_value ->> 'market_family' AS market_family,
      (label_value ->> 'line_value')::numeric AS line_value
    FROM resource_assessment
    CROSS JOIN LATERAL jsonb_array_elements(
      resource_assessment.match_payload -> 'labels_preview'
    ) AS label_value
  ),
  corrected_labels AS (
    SELECT
      source_label.match_id,
      source_label.market_family,
      source_label.label_key,
      source_label.line_value,
      CASE
        WHEN source_label.base_block_reason IS NOT NULL
          THEN 'blocked'
        WHEN source_label.market_family = 'first_team_to_score'
          AND source_label.first_goal_block_reason IS NOT NULL
          THEN 'incomplete'
        WHEN source_label.market_family = 'total_corners'
          AND source_label.corners_block_reason IS NOT NULL
          THEN 'incomplete'
        ELSE 'ready'
      END AS settlement_status,
      CASE
        WHEN source_label.base_block_reason IS NOT NULL
          THEN source_label.base_block_reason
        WHEN source_label.market_family = 'first_team_to_score'
          THEN source_label.first_goal_block_reason
        WHEN source_label.market_family = 'total_corners'
          THEN source_label.corners_block_reason
        ELSE NULL
      END AS reason,
      CASE
        WHEN source_label.base_block_reason IS NOT NULL
          THEN NULL
        WHEN source_label.market_family = 'first_team_to_score'
          AND source_label.first_goal_block_reason IS NOT NULL
          THEN NULL
        WHEN source_label.market_family = 'total_corners'
          AND source_label.corners_block_reason IS NOT NULL
          THEN NULL
        WHEN source_label.market_family = 'full_time_result' THEN
          CASE
            WHEN source_label.home_score > source_label.away_score
              THEN 'home'
            WHEN source_label.home_score < source_label.away_score
              THEN 'away'
            ELSE 'draw'
          END
        WHEN source_label.market_family = 'total_goals' THEN
          CASE
            WHEN source_label.total_goals > source_label.line_value
              THEN 'over'
            ELSE 'under'
          END
        WHEN source_label.market_family = 'both_teams_to_score' THEN
          CASE
            WHEN source_label.home_score > 0
              AND source_label.away_score > 0
              THEN 'yes'
            ELSE 'no'
          END
        WHEN source_label.market_family = 'first_team_to_score' THEN
          CASE
            WHEN source_label.total_goals = 0 THEN 'none'
            WHEN source_label.first_goal_team_id
              = source_label.home_team_id
              THEN 'home'
            WHEN source_label.first_goal_team_id
              = source_label.away_team_id
              THEN 'away'
          END
        WHEN source_label.market_family = 'asian_handicap' THEN
          CASE
            WHEN (
              source_label.home_score
              - source_label.away_score
              + source_label.line_value
            ) > 0 THEN 'home_cover'
            ELSE 'away_cover'
          END
        WHEN source_label.market_family = 'total_corners' THEN
          CASE
            WHEN source_label.total_corners > source_label.line_value
              THEN 'over'
            ELSE 'under'
          END
      END AS outcome,
      source_label.original_label
    FROM source_labels AS source_label
  ),
  family_by_match AS (
    SELECT
      corrected_label.match_id,
      corrected_label.market_family,
      count(*)::integer AS definitions,
      count(*) FILTER (
        WHERE corrected_label.settlement_status = 'ready'
      )::integer AS ready_definitions,
      min(corrected_label.reason) FILTER (
        WHERE corrected_label.reason IS NOT NULL
      ) AS reason,
      CASE
        WHEN bool_and(
          corrected_label.settlement_status = 'ready'
        ) THEN 'ready'
        WHEN bool_or(
          corrected_label.settlement_status = 'incomplete'
        ) THEN 'incomplete'
        ELSE 'blocked'
      END AS status
    FROM corrected_labels AS corrected_label
    GROUP BY corrected_label.match_id, corrected_label.market_family
  ),
  family_payload_by_match AS (
    SELECT
      family.match_id,
      jsonb_object_agg(
        family.market_family,
        jsonb_build_object(
          'status', family.status,
          'reason', family.reason,
          'definitions', family.definitions,
          'ready_definitions', family.ready_definitions
        )
        ORDER BY family.market_family
      ) AS family_readiness
    FROM family_by_match AS family
    GROUP BY family.match_id
  ),
  labels_by_match AS (
    SELECT
      corrected_label.match_id,
      count(*) FILTER (
        WHERE corrected_label.settlement_status = 'ready'
      )::integer AS ready_definitions,
      jsonb_agg(
        corrected_label.original_label
        || jsonb_build_object(
          'status', corrected_label.settlement_status,
          'reason', corrected_label.reason,
          'outcome', corrected_label.outcome
        )
        ORDER BY
          corrected_label.market_family,
          corrected_label.line_value NULLS FIRST,
          corrected_label.label_key
      ) AS labels_preview
    FROM corrected_labels AS corrected_label
    GROUP BY corrected_label.match_id
  ),
  match_payload AS (
    SELECT
      resource.match_id,
      (
        resource.match_payload
        || jsonb_build_object(
          'terminal_observed_at', resource.terminal_observed_at,
          'terminal_observation_source',
            resource.terminal_observation_source,
          'base_block_reason', resource.base_block_reason,
          'ready_definitions', labels.ready_definitions,
          'overall_status', CASE
            WHEN resource.base_block_reason IS NOT NULL
              THEN 'blocked'
            WHEN labels.ready_definitions = 27 THEN 'ready'
            WHEN labels.ready_definitions > 0 THEN 'partial'
            ELSE 'blocked'
          END,
          'family_readiness', family.family_readiness,
          'labels_preview', labels.labels_preview
        )
      ) AS payload,
      (resource.match_payload ->> 'kickoff_at')::timestamptz
        AS kickoff_at,
      resource.base_block_reason,
      labels.ready_definitions
    FROM resource_assessment AS resource
    JOIN labels_by_match AS labels
      ON labels.match_id = resource.match_id
    JOIN family_payload_by_match AS family
      ON family.match_id = resource.match_id
  ),
  family_summary_base AS (
    SELECT
      corrected_label.market_family,
      count(DISTINCT corrected_label.match_id)::integer
        AS sampled_matches,
      count(DISTINCT corrected_label.match_id) FILTER (
        WHERE corrected_label.settlement_status = 'ready'
      )::integer AS ready_matches,
      count(DISTINCT corrected_label.match_id) FILTER (
        WHERE corrected_label.settlement_status = 'incomplete'
      )::integer AS incomplete_matches,
      count(DISTINCT corrected_label.match_id) FILTER (
        WHERE corrected_label.settlement_status = 'blocked'
      )::integer AS blocked_matches
    FROM corrected_labels AS corrected_label
    GROUP BY corrected_label.market_family
  ),
  reason_summary AS (
    SELECT
      corrected_label.market_family,
      corrected_label.reason,
      count(DISTINCT corrected_label.match_id)::integer AS matches
    FROM corrected_labels AS corrected_label
    WHERE corrected_label.reason IS NOT NULL
    GROUP BY corrected_label.market_family, corrected_label.reason
  ),
  family_summary AS (
    SELECT
      summary.market_family,
      summary.sampled_matches,
      summary.ready_matches,
      summary.incomplete_matches,
      summary.blocked_matches,
      round(
        100.0 * summary.ready_matches
          / NULLIF(summary.sampled_matches, 0),
        2
      ) AS ready_pct,
      CASE
        WHEN summary.sampled_matches = 0 THEN 'no_sample'
        WHEN summary.ready_matches = summary.sampled_matches
          THEN 'ready'
        WHEN summary.ready_matches = 0 THEN 'blocked'
        ELSE 'partial'
      END AS status,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'reason', reason.reason,
              'matches', reason.matches
            )
            ORDER BY reason.matches DESC, reason.reason
          )
          FROM reason_summary AS reason
          WHERE reason.market_family = summary.market_family
        ),
        '[]'::jsonb
      ) AS reasons
    FROM family_summary_base AS summary
  ),
  totals AS (
    SELECT
      (SELECT count(*)::integer FROM match_payload)
        AS sampled_matches,
      (
        SELECT count(*)::integer
        FROM match_payload
        WHERE base_block_reason IS NULL
      ) AS score_ready_matches,
      (
        SELECT min(summary.ready_pct)
        FROM family_summary AS summary
        WHERE summary.market_family IN (
          'full_time_result',
          'total_goals',
          'both_teams_to_score',
          'asian_handicap'
        )
      ) AS score_family_minimum_ready_pct
  )
  SELECT
    base_report
    || jsonb_build_object(
      'phase', '8G.1.1',
      'quality_contract_version', 'phase8g.1.1',
      'sampled_matches', totals.sampled_matches,
      'score_ready_matches', totals.score_ready_matches,
      'score_family_minimum_ready_pct',
        totals.score_family_minimum_ready_pct,
      'family_summary', COALESCE(
        (
          SELECT jsonb_agg(
            to_jsonb(summary)
            ORDER BY summary.market_family
          )
          FROM family_summary AS summary
        ),
        '[]'::jsonb
      ),
      'matches', COALESCE(
        (
          SELECT jsonb_agg(
            match_row.payload
            ORDER BY match_row.kickoff_at DESC, match_row.match_id
          )
          FROM match_payload AS match_row
        ),
        '[]'::jsonb
      ),
      'safeguards', COALESCE(
        base_report -> 'safeguards',
        '{}'::jsonb
      ) || jsonb_build_object(
        'terminal_observation_policy',
          'ended_at_or_verified_provider_finished_observation',
        'provider_calls', 0,
        'labels_written', 0
      ),
      'recommendation', CASE
        WHEN totals.sampled_matches = 0
          THEN 'no_finished_matches_in_window'
        WHEN totals.score_ready_matches = 0
          THEN 'resolve_score_contract'
        WHEN totals.sampled_matches >= 20
          AND totals.score_family_minimum_ready_pct >= 90
          THEN 'ready_for_score_based_label_canary'
        ELSE 'review_settlement_gaps'
      END
    )
  INTO corrected_report
  FROM totals;

  RETURN corrected_report;
END
$function$;

REVOKE ALL ON FUNCTION
  public.get_highlightly_label_settlement_preview_v2(
    text,
    integer,
    integer
  )
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.get_highlightly_label_settlement_preview_v2(
    text,
    integer,
    integer
  )
  TO authenticated, service_role;

COMMENT ON FUNCTION
  public.get_highlightly_label_settlement_preview_v2(
    text,
    integer,
    integer
  ) IS
  'Read-only Phase 8G.1.1 settlement preview. Missing ended_at is accepted only with a matching stored Highlightly Finished observation; no provider calls or label writes.';

NOTIFY pgrst, 'reload schema';
