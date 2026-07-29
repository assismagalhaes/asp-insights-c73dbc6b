CREATE OR REPLACE FUNCTION
  public.get_highlightly_labeled_feature_backfill_preview_v2(
    p_limit integer DEFAULT 20,
    p_max_candidates_per_kickoff integer DEFAULT 200
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_provider_enabled boolean;
  v_football_id uuid;
  v_feature_set_id uuid;
  v_feature_set_status text;
  v_feature_set_enabled boolean;
  v_label_set_id uuid;
  v_label_set_status text;
  v_label_set_enabled boolean;
  v_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'grouped backfill preview limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;
  IF p_max_candidates_per_kickoff IS NULL
     OR p_max_candidates_per_kickoff < 1
     OR p_max_candidates_per_kickoff > 500 THEN
    RAISE EXCEPTION
      'maximum candidates per kickoff must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO v_provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';

  SELECT sport.id
  INTO v_football_id
  FROM public.sports AS sport
  WHERE sport.code = 'football';

  SELECT
    feature_set.id,
    feature_set.status,
    feature_set.is_enabled
  INTO
    v_feature_set_id,
    v_feature_set_status,
    v_feature_set_enabled
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = v_football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.2.0'
  LIMIT 1;

  SELECT
    label_set.id,
    label_set.status,
    label_set.is_enabled
  INTO
    v_label_set_id,
    v_label_set_status,
    v_label_set_enabled
  FROM public.hl_label_sets AS label_set
  WHERE label_set.sport_id = v_football_id
    AND label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0'
  LIMIT 1;

  IF v_football_id IS NULL
     OR v_feature_set_id IS NULL
     OR v_label_set_id IS NULL THEN
    RETURN jsonb_build_object(
      'phase', '8G.3.3',
      'quality_contract_version', 'phase8g.3.3',
      'sport', 'football',
      'recommendation', 'install_missing_feature_or_label_contract'
    );
  END IF;

  WITH missing_labeled AS (
    SELECT
      match_row.id AS match_id,
      match_row.kickoff_at,
      competition.name AS competition_name,
      country.name AS country_name
    FROM public.hl_match_labels AS label
    JOIN public.sports_matches AS match_row
      ON match_row.id = label.match_id
     AND match_row.sport_id = v_football_id
     AND match_row.kickoff_at IS NOT NULL
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN public.sports_countries AS country
      ON country.id = competition.country_id
    WHERE label.label_set_id = v_label_set_id
      AND label.label_version
        = 'highlightly_football_postmatch.score.1.0.0'
      AND label.quality_status = 'valid'
      AND NOT EXISTS (
        SELECT 1
        FROM public.hl_match_feature_snapshots AS snapshot
        WHERE snapshot.feature_set_id = v_feature_set_id
          AND snapshot.match_id = match_row.id
          AND snapshot.horizon_key = 't24h'
          AND snapshot.kickoff_at = match_row.kickoff_at
      )
    ORDER BY match_row.kickoff_at, match_row.id
    LIMIT p_limit
  ),
  grouped AS (
    SELECT
      missing.kickoff_at,
      count(*)::integer AS labeled_matches,
      jsonb_agg(
        jsonb_build_object(
          'match_id', missing.match_id,
          'competition_name', missing.competition_name,
          'country_name', missing.country_name
        )
        ORDER BY missing.match_id
      ) AS labeled_match_details
    FROM missing_labeled AS missing
    GROUP BY missing.kickoff_at
  ),
  assessed_groups AS (
    SELECT
      grouped.*,
      (
        SELECT count(*)::integer
        FROM public.sports_matches AS candidate
        JOIN public.sports_match_participants AS home
          ON home.match_id = candidate.id
         AND home.role = 'home'
        JOIN public.sports_match_participants AS away
          ON away.match_id = candidate.id
         AND away.role = 'away'
        WHERE candidate.sport_id = v_football_id
          AND candidate.kickoff_at = grouped.kickoff_at
          AND candidate.status IN ('scheduled', 'finished')
          AND candidate.kickoff_at - interval '24 hours'
            <= statement_timestamp()
      ) AS materializer_candidates
    FROM grouped
  ),
  summary AS (
    SELECT
      COALESCE(sum(assessed.labeled_matches), 0)::integer
        AS labeled_matches,
      count(*)::integer AS kickoff_groups,
      COALESCE(sum(assessed.materializer_candidates), 0)::integer
        AS materializer_candidates,
      count(*) FILTER (
        WHERE assessed.materializer_candidates
          > p_max_candidates_per_kickoff
      )::integer AS groups_over_limit,
      max(assessed.materializer_candidates)::integer
        AS largest_kickoff_group
    FROM assessed_groups AS assessed
  )
  SELECT jsonb_build_object(
    'phase', '8G.3.3',
    'quality_contract_version', 'phase8g.3.3',
    'sport', 'football',
    'feature_set', 'highlightly_football_prematch@1.2.0',
    'label_version',
      'highlightly_football_postmatch.score.1.0.0',
    'horizon', 't24h',
    'sample_limit', p_limit,
    'max_candidates_per_kickoff', p_max_candidates_per_kickoff,
    'missing_labeled_matches', summary.labeled_matches,
    'kickoff_groups', summary.kickoff_groups,
    'materializer_candidates', summary.materializer_candidates,
    'potential_collateral_matches', greatest(
      summary.materializer_candidates - summary.labeled_matches,
      0
    ),
    'groups_over_limit', summary.groups_over_limit,
    'largest_kickoff_group', summary.largest_kickoff_group,
    'groups', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'kickoff_at', assessed.kickoff_at,
            'labeled_matches', assessed.labeled_matches,
            'materializer_candidates',
              assessed.materializer_candidates,
            'within_limit',
              assessed.materializer_candidates
                <= p_max_candidates_per_kickoff,
            'labeled_match_details',
              assessed.labeled_match_details
          )
          ORDER BY assessed.kickoff_at
        )
        FROM assessed_groups AS assessed
      ),
      '[]'::jsonb
    ),
    'contracts', jsonb_build_object(
      'feature_set_status', v_feature_set_status,
      'feature_set_enabled', v_feature_set_enabled,
      'label_set_status', v_label_set_status,
      'label_set_enabled', v_label_set_enabled
    ),
    'safeguards', jsonb_build_object(
      'provider_enabled', v_provider_enabled,
      'provider_calls', 0,
      'stored_data_only', true,
      'labels_generated', 0,
      'automatic_training', false,
      'automatic_predictions', false,
      'grouped_by_kickoff', true,
      'bounded_candidates_per_kickoff', true
    ),
    'recommendation', CASE
      WHEN v_provider_enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      WHEN v_feature_set_status <> 'draft'
        OR v_feature_set_enabled
        OR v_label_set_status <> 'draft'
        OR v_label_set_enabled
        THEN 'restore_draft_disabled_contracts'
      WHEN summary.labeled_matches = 0
        THEN 'rebuild_phase8g3_dataset'
      WHEN summary.groups_over_limit > 0
        THEN 'reduce_scope_or_review_large_kickoff_group'
      ELSE 'ready_for_grouped_backfill_canary'
    END
  )
  INTO v_result
  FROM summary;

  RETURN v_result;
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.get_highlightly_labeled_feature_backfill_preview_v2(
      integer,
      integer
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.get_highlightly_labeled_feature_backfill_preview_v2(
      integer,
      integer
    )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.backfill_highlightly_football_labeled_features_v2(
    p_limit integer DEFAULT 20,
    p_max_candidates_per_kickoff integer DEFAULT 200
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_provider_enabled boolean;
  v_football_id uuid;
  v_feature_set public.hl_feature_sets%ROWTYPE;
  v_label_set public.hl_label_sets%ROWTYPE;
  v_group record;
  v_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_labeled_matches integer := 0;
  v_groups_considered integer := 0;
  v_groups_processed integer := 0;
  v_groups_failed integer := 0;
  v_materializer_candidates integer := 0;
  v_snapshots_before integer := 0;
  v_snapshots_after integer := 0;
  v_all_target_snapshots_created integer := 0;
  v_labeled_snapshots_created integer := 0;
  v_model_eligible_count integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_materialization_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'grouped backfill limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;
  IF p_max_candidates_per_kickoff IS NULL
     OR p_max_candidates_per_kickoff < 1
     OR p_max_candidates_per_kickoff > 500 THEN
    RAISE EXCEPTION
      'maximum candidates per kickoff must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO v_provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';
  IF v_provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must be disabled before grouped backfill'
      USING ERRCODE = '55000';
  END IF;

  SELECT sport.id
  INTO v_football_id
  FROM public.sports AS sport
  WHERE sport.code = 'football';

  SELECT feature_set.*
  INTO v_feature_set
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = v_football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.2.0'
  LIMIT 1;

  SELECT label_set.*
  INTO v_label_set
  FROM public.hl_label_sets AS label_set
  WHERE label_set.sport_id = v_football_id
    AND label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0'
  LIMIT 1;

  IF v_feature_set.id IS NULL OR v_label_set.id IS NULL THEN
    RAISE EXCEPTION 'Football feature and label contracts must be installed'
      USING ERRCODE = '55000';
  END IF;
  IF v_feature_set.status IS DISTINCT FROM 'draft'
     OR v_feature_set.is_enabled
     OR v_label_set.status IS DISTINCT FROM 'draft'
     OR v_label_set.is_enabled THEN
    RAISE EXCEPTION
      'Grouped backfill requires draft, disabled contracts'
      USING ERRCODE = '55000';
  END IF;

  WITH missing_labeled AS (
    SELECT
      match_row.id AS match_id,
      match_row.kickoff_at
    FROM public.hl_match_labels AS label
    JOIN public.sports_matches AS match_row
      ON match_row.id = label.match_id
     AND match_row.sport_id = v_football_id
     AND match_row.kickoff_at IS NOT NULL
    WHERE label.label_set_id = v_label_set.id
      AND label.label_version
        = 'highlightly_football_postmatch.score.1.0.0'
      AND label.quality_status = 'valid'
      AND NOT EXISTS (
        SELECT 1
        FROM public.hl_match_feature_snapshots AS snapshot
        WHERE snapshot.feature_set_id = v_feature_set.id
          AND snapshot.match_id = match_row.id
          AND snapshot.horizon_key = 't24h'
          AND snapshot.kickoff_at = match_row.kickoff_at
      )
    ORDER BY match_row.kickoff_at, match_row.id
    LIMIT p_limit
  )
  SELECT
    COALESCE(array_agg(missing.match_id), ARRAY[]::uuid[]),
    count(*)::integer
  INTO
    v_candidate_ids,
    v_labeled_matches
  FROM missing_labeled AS missing;

  FOR v_group IN
    SELECT
      match_row.kickoff_at,
      count(*)::integer AS labeled_matches,
      (
        SELECT count(*)::integer
        FROM public.sports_matches AS peer
        JOIN public.sports_match_participants AS home
          ON home.match_id = peer.id
         AND home.role = 'home'
        JOIN public.sports_match_participants AS away
          ON away.match_id = peer.id
         AND away.role = 'away'
        WHERE peer.sport_id = v_football_id
          AND peer.kickoff_at = match_row.kickoff_at
          AND peer.status IN ('scheduled', 'finished')
          AND peer.kickoff_at - interval '24 hours'
            <= statement_timestamp()
      ) AS materializer_candidates
    FROM public.sports_matches AS match_row
    WHERE match_row.id = ANY(v_candidate_ids)
    GROUP BY match_row.kickoff_at
    ORDER BY match_row.kickoff_at
  LOOP
    v_groups_considered := v_groups_considered + 1;

    IF v_group.materializer_candidates < 1
       OR v_group.materializer_candidates
         > p_max_candidates_per_kickoff THEN
      v_groups_failed := v_groups_failed + 1;
      v_failures := v_failures || jsonb_build_array(
        jsonb_build_object(
          'kickoff_at', v_group.kickoff_at,
          'labeled_matches', v_group.labeled_matches,
          'materializer_candidates',
            v_group.materializer_candidates,
          'reason', CASE
            WHEN v_group.materializer_candidates < 1
              THEN 'no_materializer_candidates'
            ELSE 'kickoff_group_exceeds_limit'
          END
        )
      );
      CONTINUE;
    END IF;

    SELECT count(*)::integer
    INTO v_snapshots_before
    FROM public.hl_match_feature_snapshots AS snapshot
    WHERE snapshot.feature_set_id = v_feature_set.id
      AND snapshot.horizon_key = 't24h'
      AND snapshot.kickoff_at = v_group.kickoff_at;

    BEGIN
      v_materialization_result :=
        public.materialize_highlightly_football_features_v3(
          v_group.kickoff_at,
          v_group.kickoff_at + interval '1 millisecond',
          't24h',
          v_group.materializer_candidates
        );

      SELECT count(*)::integer
      INTO v_snapshots_after
      FROM public.hl_match_feature_snapshots AS snapshot
      WHERE snapshot.feature_set_id = v_feature_set.id
        AND snapshot.horizon_key = 't24h'
        AND snapshot.kickoff_at = v_group.kickoff_at;

      v_groups_processed := v_groups_processed + 1;
      v_materializer_candidates :=
        v_materializer_candidates + v_group.materializer_candidates;
      v_all_target_snapshots_created :=
        v_all_target_snapshots_created
        + greatest(v_snapshots_after - v_snapshots_before, 0);
    EXCEPTION
      WHEN OTHERS THEN
        v_groups_failed := v_groups_failed + 1;
        v_failures := v_failures || jsonb_build_array(
          jsonb_build_object(
            'kickoff_at', v_group.kickoff_at,
            'labeled_matches', v_group.labeled_matches,
            'materializer_candidates',
              v_group.materializer_candidates,
            'sqlstate', SQLSTATE,
            'error', SQLERRM
          )
        );
    END;
  END LOOP;

  SELECT
    count(DISTINCT snapshot.match_id)::integer,
    count(DISTINCT snapshot.match_id) FILTER (
      WHERE COALESCE(
        (snapshot.quality ->> 'model_eligible')::boolean,
        false
      )
    )::integer
  INTO
    v_labeled_snapshots_created,
    v_model_eligible_count
  FROM public.hl_match_feature_snapshots AS snapshot
  JOIN public.sports_matches AS match_row
    ON match_row.id = snapshot.match_id
   AND match_row.kickoff_at = snapshot.kickoff_at
  WHERE snapshot.feature_set_id = v_feature_set.id
    AND snapshot.match_id = ANY(v_candidate_ids)
    AND snapshot.horizon_key = 't24h';

  RETURN jsonb_build_object(
    'phase', '8G.3.3',
    'quality_contract_version', 'phase8g.3.3',
    'sport', 'football',
    'feature_set', jsonb_build_object(
      'code', v_feature_set.code,
      'version', v_feature_set.version,
      'status', v_feature_set.status,
      'is_enabled', v_feature_set.is_enabled
    ),
    'label_version',
      'highlightly_football_postmatch.score.1.0.0',
    'horizon', 't24h',
    'sample_limit', p_limit,
    'max_candidates_per_kickoff', p_max_candidates_per_kickoff,
    'labeled_matches_considered', v_labeled_matches,
    'kickoff_groups_considered', v_groups_considered,
    'kickoff_groups_processed', v_groups_processed,
    'kickoff_groups_failed', v_groups_failed,
    'materializer_candidates_processed', v_materializer_candidates,
    'all_target_snapshots_created', v_all_target_snapshots_created,
    'labeled_snapshots_created', v_labeled_snapshots_created,
    'collateral_snapshots_created', greatest(
      v_all_target_snapshots_created - v_labeled_snapshots_created,
      0
    ),
    'model_eligible_labeled_snapshots', v_model_eligible_count,
    'remaining_missing_labeled_snapshots', greatest(
      v_labeled_matches - v_labeled_snapshots_created,
      0
    ),
    'failures', v_failures,
    'safeguards', jsonb_build_object(
      'provider_enabled', v_provider_enabled,
      'provider_calls', 0,
      'stored_data_only', true,
      'labels_generated', 0,
      'automatic_training', false,
      'automatic_predictions', false,
      'grouped_by_kickoff', true,
      'bounded_candidates_per_kickoff', true
    ),
    'recommendation', CASE
      WHEN v_groups_failed > 0
        THEN 'review_grouped_backfill_failures'
      WHEN v_labeled_matches = 0
        THEN 'rebuild_phase8g3_dataset'
      WHEN v_labeled_snapshots_created < v_labeled_matches
        THEN 'rerun_phase8g32_overlap_diagnostics'
      ELSE 'rebuild_phase8g3_dataset'
    END
  );
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.backfill_highlightly_football_labeled_features_v2(
      integer,
      integer
    )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.backfill_highlightly_football_labeled_features_v2(
      integer,
      integer
    )
  TO service_role;

COMMENT ON FUNCTION
  public.get_highlightly_labeled_feature_backfill_preview_v2(
    integer,
    integer
  ) IS
  'Read-only Phase 8G.3.3 preview that groups missing labeled Football features by shared kickoff and enforces a bounded fan-out.';
COMMENT ON FUNCTION
  public.backfill_highlightly_football_labeled_features_v2(
    integer,
    integer
  ) IS
  'Manual Phase 8G.3.3 stored-data-only grouped Football feature backfill that avoids LIMIT 1 kickoff collisions.';

NOTIFY pgrst, 'reload schema';
