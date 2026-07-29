CREATE INDEX IF NOT EXISTS idx_sports_matches_finished_schedule
  ON public.sports_matches (sport_id, kickoff_at DESC, id)
  WHERE status = 'finished';

CREATE OR REPLACE FUNCTION public.get_highlightly_label_settlement_preview_v1(
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
  result jsonb;
BEGIN
  IF p_sport IS DISTINCT FROM 'football' THEN
    RAISE EXCEPTION 'Phase 8G.1 currently supports Football only'
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

  WITH target AS (
    SELECT
      label_set.id,
      label_set.code,
      label_set.version,
      label_set.status,
      label_set.is_enabled
    FROM public.hl_label_sets AS label_set
    JOIN public.sports AS sport
      ON sport.id = label_set.sport_id
     AND sport.code = p_sport
    WHERE label_set.code = 'highlightly_football_postmatch'
      AND label_set.version = '1.0.0'
    LIMIT 1
  ),
  candidate AS (
    SELECT
      match_row.id AS match_id,
      match_row.competition_id,
      competition.name AS competition_name,
      match_row.kickoff_at,
      match_row.ended_at,
      match_row.status,
      match_row.provider_status,
      match_row.score_data,
      home_participant.team_id AS home_team_id,
      home_team.name AS home_team_name,
      away_participant.team_id AS away_team_id,
      away_team.name AS away_team_name
    FROM public.sports_matches AS match_row
    JOIN public.sports AS sport
      ON sport.id = match_row.sport_id
     AND sport.code = p_sport
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
    ORDER BY match_row.kickoff_at DESC, match_row.id
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
  corner_by_team AS (
    SELECT
      candidate.match_id,
      team_stat.team_id,
      max(team_stat.numeric_value) AS corners
    FROM candidate
    JOIN public.sports_match_team_stats AS team_stat
      ON team_stat.match_id = candidate.match_id
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
    GROUP BY candidate.match_id, team_stat.team_id
  ),
  corner_totals AS (
    SELECT
      corner_by_team.match_id,
      count(*) FILTER (
        WHERE corner_by_team.corners IS NOT NULL
          AND corner_by_team.corners >= 0
          AND corner_by_team.corners = trunc(corner_by_team.corners)
      )::integer AS valid_corner_teams,
      sum(corner_by_team.corners) AS total_corners
    FROM corner_by_team
    GROUP BY corner_by_team.match_id
  ),
  goal_events AS (
    SELECT
      candidate.match_id,
      event.team_id,
      event.elapsed_seconds,
      event.sequence_key
    FROM candidate
    JOIN public.sports_match_events AS event
      ON event.match_id = candidate.match_id
     AND lower(trim(event.event_type)) = 'goal'
  ),
  goal_summary AS (
    SELECT
      goal_event.match_id,
      count(*)::integer AS goal_event_count
    FROM goal_events AS goal_event
    GROUP BY goal_event.match_id
  ),
  first_goal AS (
    SELECT DISTINCT ON (goal_event.match_id)
      goal_event.match_id,
      goal_event.team_id AS first_goal_team_id,
      goal_event.elapsed_seconds AS first_goal_elapsed_seconds,
      goal_event.sequence_key AS first_goal_sequence_key
    FROM goal_events AS goal_event
    ORDER BY
      goal_event.match_id,
      goal_event.elapsed_seconds NULLS LAST,
      goal_event.sequence_key
  ),
  base_assessment AS (
    SELECT
      scored.*,
      scored.home_score + scored.away_score AS total_goals,
      scored.home_score - scored.away_score AS home_goal_difference,
      COALESCE(goal_summary.goal_event_count, 0)
        AS goal_event_count,
      first_goal.first_goal_team_id,
      first_goal.first_goal_elapsed_seconds,
      first_goal.first_goal_sequence_key,
      COALESCE(corner_totals.valid_corner_teams, 0)
        AS valid_corner_teams,
      corner_totals.total_corners,
      CASE
        WHEN scored.terminal_state_requires_review
          OR scored.penalties_present
          THEN 'terminal_state_requires_manual_review'
        WHEN scored.ended_at IS NULL
          THEN 'ended_at_missing'
        WHEN scored.home_team_id IS NULL
          OR scored.away_team_id IS NULL
          THEN 'participants_missing'
        WHEN scored.home_team_id = scored.away_team_id
          THEN 'participant_identity_collision'
        WHEN scored.home_score IS NULL
          OR scored.away_score IS NULL
          THEN 'score_missing_or_invalid'
        ELSE NULL
      END AS base_block_reason
    FROM scored
    LEFT JOIN goal_summary
      ON goal_summary.match_id = scored.match_id
    LEFT JOIN first_goal
      ON first_goal.match_id = scored.match_id
    LEFT JOIN corner_totals
      ON corner_totals.match_id = scored.match_id
  ),
  assessed AS (
    SELECT
      base_assessment.*,
      CASE
        WHEN base_assessment.base_block_reason IS NOT NULL
          THEN base_assessment.base_block_reason
        WHEN base_assessment.total_goals = 0
          AND base_assessment.goal_event_count = 0
          THEN NULL
        WHEN base_assessment.goal_event_count
          <> base_assessment.total_goals
          THEN 'goal_event_count_mismatch'
        WHEN base_assessment.first_goal_team_id IS NULL
          THEN 'first_goal_team_missing'
        WHEN base_assessment.first_goal_team_id NOT IN (
          base_assessment.home_team_id,
          base_assessment.away_team_id
        ) THEN 'first_goal_team_identity_mismatch'
        ELSE NULL
      END AS first_goal_block_reason,
      CASE
        WHEN base_assessment.base_block_reason IS NOT NULL
          THEN base_assessment.base_block_reason
        WHEN base_assessment.valid_corner_teams <> 2
          THEN 'corners_missing_for_one_or_both_teams'
        WHEN base_assessment.total_corners IS NULL
          OR base_assessment.total_corners < 0
          OR base_assessment.total_corners
            <> trunc(base_assessment.total_corners)
          THEN 'corners_total_invalid'
        ELSE NULL
      END AS corners_block_reason
    FROM base_assessment
  ),
  label_rows AS (
    SELECT
      assessed.match_id,
      definition.label_key,
      definition.market_family,
      definition.display_name,
      definition.line_value,
      CASE
        WHEN assessed.base_block_reason IS NOT NULL
          THEN 'blocked'
        WHEN definition.market_family = 'first_team_to_score'
          AND assessed.first_goal_block_reason IS NOT NULL
          THEN 'incomplete'
        WHEN definition.market_family = 'total_corners'
          AND assessed.corners_block_reason IS NOT NULL
          THEN 'incomplete'
        ELSE 'ready'
      END AS settlement_status,
      CASE
        WHEN assessed.base_block_reason IS NOT NULL
          THEN assessed.base_block_reason
        WHEN definition.market_family = 'first_team_to_score'
          THEN assessed.first_goal_block_reason
        WHEN definition.market_family = 'total_corners'
          THEN assessed.corners_block_reason
        ELSE NULL
      END AS reason,
      CASE
        WHEN assessed.base_block_reason IS NOT NULL
          THEN NULL
        WHEN definition.market_family = 'first_team_to_score'
          AND assessed.first_goal_block_reason IS NOT NULL
          THEN NULL
        WHEN definition.market_family = 'total_corners'
          AND assessed.corners_block_reason IS NOT NULL
          THEN NULL
        WHEN definition.market_family = 'full_time_result' THEN
          CASE
            WHEN assessed.home_score > assessed.away_score THEN 'home'
            WHEN assessed.home_score < assessed.away_score THEN 'away'
            ELSE 'draw'
          END
        WHEN definition.market_family = 'total_goals' THEN
          CASE
            WHEN assessed.total_goals > definition.line_value
              THEN 'over'
            ELSE 'under'
          END
        WHEN definition.market_family = 'both_teams_to_score' THEN
          CASE
            WHEN assessed.home_score > 0 AND assessed.away_score > 0
              THEN 'yes'
            ELSE 'no'
          END
        WHEN definition.market_family = 'first_team_to_score' THEN
          CASE
            WHEN assessed.total_goals = 0 THEN 'none'
            WHEN assessed.first_goal_team_id = assessed.home_team_id
              THEN 'home'
            WHEN assessed.first_goal_team_id = assessed.away_team_id
              THEN 'away'
          END
        WHEN definition.market_family = 'asian_handicap' THEN
          CASE
            WHEN assessed.home_goal_difference + definition.line_value > 0
              THEN 'home_cover'
            ELSE 'away_cover'
          END
        WHEN definition.market_family = 'total_corners' THEN
          CASE
            WHEN assessed.total_corners > definition.line_value
              THEN 'over'
            ELSE 'under'
          END
      END AS outcome
    FROM assessed
    CROSS JOIN target
    JOIN public.hl_label_definitions AS definition
      ON definition.label_set_id = target.id
  ),
  family_by_match AS (
    SELECT
      label_row.match_id,
      label_row.market_family,
      count(*)::integer AS definitions,
      count(*) FILTER (
        WHERE label_row.settlement_status = 'ready'
      )::integer AS ready_definitions,
      min(label_row.reason) FILTER (
        WHERE label_row.reason IS NOT NULL
      ) AS reason,
      CASE
        WHEN bool_and(label_row.settlement_status = 'ready')
          THEN 'ready'
        WHEN bool_or(label_row.settlement_status = 'incomplete')
          THEN 'incomplete'
        ELSE 'blocked'
      END AS status
    FROM label_rows AS label_row
    GROUP BY label_row.match_id, label_row.market_family
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
      label_row.match_id,
      count(*) FILTER (
        WHERE label_row.settlement_status = 'ready'
      )::integer AS ready_definitions,
      jsonb_agg(
        jsonb_build_object(
          'label_key', label_row.label_key,
          'market_family', label_row.market_family,
          'display_name', label_row.display_name,
          'line_value', label_row.line_value,
          'status', label_row.settlement_status,
          'reason', label_row.reason,
          'outcome', label_row.outcome
        )
        ORDER BY
          label_row.market_family,
          label_row.line_value NULLS FIRST,
          label_row.label_key
      ) AS labels_preview
    FROM label_rows AS label_row
    GROUP BY label_row.match_id
  ),
  match_payload AS (
    SELECT
      assessed.match_id,
      assessed.competition_id,
      assessed.competition_name,
      assessed.kickoff_at,
      assessed.ended_at,
      assessed.provider_status,
      assessed.home_team_id,
      assessed.home_team_name,
      assessed.away_team_id,
      assessed.away_team_name,
      assessed.home_score,
      assessed.away_score,
      assessed.total_goals,
      assessed.goal_event_count,
      assessed.first_goal_team_id,
      assessed.first_goal_elapsed_seconds,
      assessed.total_corners,
      assessed.base_block_reason,
      labels_by_match.ready_definitions,
      CASE
        WHEN assessed.base_block_reason IS NOT NULL THEN 'blocked'
        WHEN labels_by_match.ready_definitions = 27 THEN 'ready'
        WHEN labels_by_match.ready_definitions > 0 THEN 'partial'
        ELSE 'blocked'
      END AS overall_status,
      family_payload_by_match.family_readiness,
      labels_by_match.labels_preview
    FROM assessed
    JOIN labels_by_match
      ON labels_by_match.match_id = assessed.match_id
    JOIN family_payload_by_match
      ON family_payload_by_match.match_id = assessed.match_id
  ),
  family_summary_base AS (
    SELECT
      label_row.market_family,
      count(DISTINCT label_row.match_id)::integer
        AS sampled_matches,
      count(DISTINCT label_row.match_id) FILTER (
        WHERE label_row.settlement_status = 'ready'
      )::integer AS ready_matches,
      count(DISTINCT label_row.match_id) FILTER (
        WHERE label_row.settlement_status = 'incomplete'
      )::integer AS incomplete_matches,
      count(DISTINCT label_row.match_id) FILTER (
        WHERE label_row.settlement_status = 'blocked'
      )::integer AS blocked_matches
    FROM label_rows AS label_row
    GROUP BY label_row.market_family
  ),
  reason_summary AS (
    SELECT
      label_row.market_family,
      label_row.reason,
      count(DISTINCT label_row.match_id)::integer AS matches
    FROM label_rows AS label_row
    WHERE label_row.reason IS NOT NULL
    GROUP BY label_row.market_family, label_row.reason
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
        WHEN summary.ready_matches = summary.sampled_matches THEN 'ready'
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
      (SELECT count(*)::integer FROM candidate) AS sampled_matches,
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
  SELECT jsonb_build_object(
    'phase', '8G.1',
    'quality_contract_version', 'phase8g.1',
    'sport', p_sport,
    'window_days', p_days,
    'sample_limit', p_limit,
    'sampled_matches', totals.sampled_matches,
    'score_ready_matches', totals.score_ready_matches,
    'score_family_minimum_ready_pct',
      totals.score_family_minimum_ready_pct,
    'label_set', jsonb_build_object(
      'code', target.code,
      'version', target.version,
      'status', target.status,
      'is_enabled', target.is_enabled
    ),
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
          to_jsonb(match_row)
          ORDER BY match_row.kickoff_at DESC, match_row.match_id
        )
        FROM match_payload AS match_row
      ),
      '[]'::jsonb
    ),
    'stored_labels', (
      SELECT count(*)::integer
      FROM public.hl_match_labels AS label
      WHERE label.label_set_id = target.id
    ),
    'safeguards', jsonb_build_object(
      'read_only', true,
      'finished_matches_only', true,
      'provider_calls', 0,
      'labels_written', 0,
      'automatic_generation', false,
      'automatic_training', false,
      'automatic_predictions', false
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
  INTO result
  FROM target
  CROSS JOIN totals;

  RETURN COALESCE(
    result,
    jsonb_build_object(
      'phase', '8G.1',
      'sport', p_sport,
      'recommendation', 'label_contract_missing'
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_label_settlement_preview_v1(
  text,
  integer,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.get_highlightly_label_settlement_preview_v1(
    text,
    integer,
    integer
  )
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_label_settlement_preview_v1(
  text,
  integer,
  integer
) IS
  'Read-only Phase 8G.1 Football settlement preview over stored finalized matches; writes no labels and performs no provider calls.';

NOTIFY pgrst, 'reload schema';
