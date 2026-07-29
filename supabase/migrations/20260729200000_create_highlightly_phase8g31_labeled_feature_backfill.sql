CREATE OR REPLACE FUNCTION
  public.get_highlightly_labeled_feature_backfill_preview_v1(
    p_limit integer DEFAULT 20
  )
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  provider_enabled boolean;
  result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'labeled feature preview limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';

  WITH target AS (
    SELECT
      feature_set.id AS feature_set_id,
      feature_set.status AS feature_set_status,
      feature_set.is_enabled AS feature_set_enabled,
      label_set.id AS label_set_id,
      label_set.status AS label_set_status,
      label_set.is_enabled AS label_set_enabled,
      sport.id AS sport_id
    FROM public.sports AS sport
    JOIN public.hl_feature_sets AS feature_set
      ON feature_set.sport_id = sport.id
     AND feature_set.code = 'highlightly_football_prematch'
     AND feature_set.version = '1.2.0'
    JOIN public.hl_label_sets AS label_set
      ON label_set.sport_id = sport.id
     AND label_set.code = 'highlightly_football_postmatch'
     AND label_set.version = '1.0.0'
    WHERE sport.code = 'football'
    LIMIT 1
  ),
  candidates AS (
    SELECT
      match_row.id AS match_id,
      match_row.kickoff_at,
      competition.name AS competition_name,
      country.name AS country_name,
      COALESCE(
        policy.profile_key,
        public.classify_highlightly_football_competition(
          competition.name,
          competition.competition_type
        )
      ) AS competition_profile
    FROM target
    JOIN public.hl_match_labels AS label
      ON label.label_set_id = target.label_set_id
     AND label.label_version
       = 'highlightly_football_postmatch.score.1.0.0'
     AND label.quality_status = 'valid'
    JOIN public.sports_matches AS match_row
      ON match_row.id = label.match_id
     AND match_row.sport_id = target.sport_id
     AND match_row.kickoff_at IS NOT NULL
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN public.sports_countries AS country
      ON country.id = competition.country_id
    LEFT JOIN public.hl_competition_feature_policies AS policy
      ON policy.competition_id = match_row.competition_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.hl_match_feature_snapshots AS snapshot
      WHERE snapshot.feature_set_id = target.feature_set_id
        AND snapshot.match_id = match_row.id
        AND snapshot.horizon_key = 't24h'
        AND snapshot.kickoff_at = match_row.kickoff_at
    )
    ORDER BY match_row.kickoff_at, match_row.id
    LIMIT p_limit
  ),
  summary AS (
    SELECT
      count(*)::integer AS matches_missing_snapshot,
      min(kickoff_at) AS first_kickoff_at,
      max(kickoff_at) AS last_kickoff_at
    FROM candidates
  ),
  profiles AS (
    SELECT
      competition_profile,
      count(*)::integer AS matches
    FROM candidates
    GROUP BY competition_profile
  )
  SELECT jsonb_build_object(
    'phase', '8G.3.1',
    'quality_contract_version', 'phase8g.3.1',
    'sport', 'football',
    'feature_set', 'highlightly_football_prematch@1.2.0',
    'label_version',
      'highlightly_football_postmatch.score.1.0.0',
    'horizon', 't24h',
    'sample_limit', p_limit,
    'matches_missing_snapshot', summary.matches_missing_snapshot,
    'first_kickoff_at', summary.first_kickoff_at,
    'last_kickoff_at', summary.last_kickoff_at,
    'competition_profiles', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(profile)
          ORDER BY profile.matches DESC, profile.competition_profile
        )
        FROM profiles AS profile
      ),
      '[]'::jsonb
    ),
    'contracts', jsonb_build_object(
      'feature_set_status', target.feature_set_status,
      'feature_set_enabled', target.feature_set_enabled,
      'label_set_status', target.label_set_status,
      'label_set_enabled', target.label_set_enabled
    ),
    'safeguards', jsonb_build_object(
      'read_only', true,
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'stored_data_only', true,
      'labels_generated', 0,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN provider_enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      WHEN target.feature_set_status <> 'draft'
        OR target.feature_set_enabled
        OR target.label_set_status <> 'draft'
        OR target.label_set_enabled
        THEN 'restore_draft_disabled_contracts'
      WHEN summary.matches_missing_snapshot = 0
        THEN 'rerun_phase8g3_dataset_preview'
      ELSE 'ready_for_labeled_feature_backfill_canary'
    END
  )
  INTO result
  FROM target
  CROSS JOIN summary;

  RETURN COALESCE(
    result,
    jsonb_build_object(
      'phase', '8G.3.1',
      'sport', 'football',
      'recommendation', 'feature_or_label_contract_missing'
    )
  );
END
$function$;

REVOKE ALL
  ON FUNCTION public.get_highlightly_labeled_feature_backfill_preview_v1(
    integer
  )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.get_highlightly_labeled_feature_backfill_preview_v1(
    integer
  )
  TO service_role;

CREATE OR REPLACE FUNCTION
  public.backfill_highlightly_football_labeled_features_v1(
    p_limit integer DEFAULT 20
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  provider_enabled boolean;
  target_feature_set public.hl_feature_sets%ROWTYPE;
  target_label_set public.hl_label_sets%ROWTYPE;
  candidate record;
  candidate_ids uuid[] := ARRAY[]::uuid[];
  considered_count integer := 0;
  processed_count integer := 0;
  failed_count integer := 0;
  snapshots_created integer := 0;
  model_eligible_count integer := 0;
  failures jsonb := '[]'::jsonb;
  materialization_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'labeled feature backfill limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Highlightly provider must be disabled before labeled feature backfill'
      USING ERRCODE = '55000';
  END IF;

  SELECT feature_set.*
  INTO target_feature_set
  FROM public.hl_feature_sets AS feature_set
  JOIN public.sports AS sport
    ON sport.id = feature_set.sport_id
   AND sport.code = 'football'
  WHERE feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.2.0'
  LIMIT 1;

  SELECT label_set.*
  INTO target_label_set
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport
    ON sport.id = label_set.sport_id
   AND sport.code = 'football'
  WHERE label_set.code = 'highlightly_football_postmatch'
    AND label_set.version = '1.0.0'
  LIMIT 1;

  IF target_feature_set.id IS NULL OR target_label_set.id IS NULL THEN
    RAISE EXCEPTION 'Football feature and label contracts must be installed'
      USING ERRCODE = '55000';
  END IF;
  IF target_feature_set.status IS DISTINCT FROM 'draft'
     OR target_feature_set.is_enabled
     OR target_label_set.status IS DISTINCT FROM 'draft'
     OR target_label_set.is_enabled THEN
    RAISE EXCEPTION
      'Labeled feature backfill requires draft, disabled contracts'
      USING ERRCODE = '55000';
  END IF;

  FOR candidate IN
    SELECT
      match_row.id AS match_id,
      match_row.kickoff_at
    FROM public.hl_match_labels AS label
    JOIN public.sports_matches AS match_row
      ON match_row.id = label.match_id
     AND match_row.sport_id = target_feature_set.sport_id
     AND match_row.kickoff_at IS NOT NULL
    WHERE label.label_set_id = target_label_set.id
      AND label.label_version
        = 'highlightly_football_postmatch.score.1.0.0'
      AND label.quality_status = 'valid'
      AND NOT EXISTS (
        SELECT 1
        FROM public.hl_match_feature_snapshots AS snapshot
        WHERE snapshot.feature_set_id = target_feature_set.id
          AND snapshot.match_id = match_row.id
          AND snapshot.horizon_key = 't24h'
          AND snapshot.kickoff_at = match_row.kickoff_at
      )
    ORDER BY match_row.kickoff_at, match_row.id
    LIMIT p_limit
  LOOP
    considered_count := considered_count + 1;
    candidate_ids := array_append(candidate_ids, candidate.match_id);

    BEGIN
      materialization_result :=
        public.materialize_highlightly_football_features_v3(
          candidate.kickoff_at,
          candidate.kickoff_at + interval '1 millisecond',
          't24h',
          1
        );
      processed_count := processed_count + 1;
    EXCEPTION
      WHEN OTHERS THEN
        failed_count := failed_count + 1;
        failures := failures || jsonb_build_array(
          jsonb_build_object(
            'match_id', candidate.match_id,
            'kickoff_at', candidate.kickoff_at,
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
  INTO snapshots_created, model_eligible_count
  FROM public.hl_match_feature_snapshots AS snapshot
  JOIN public.sports_matches AS match_row
    ON match_row.id = snapshot.match_id
   AND match_row.kickoff_at = snapshot.kickoff_at
  WHERE snapshot.feature_set_id = target_feature_set.id
    AND snapshot.match_id = ANY(candidate_ids)
    AND snapshot.horizon_key = 't24h';

  RETURN jsonb_build_object(
    'phase', '8G.3.1',
    'quality_contract_version', 'phase8g.3.1',
    'sport', 'football',
    'feature_set', jsonb_build_object(
      'code', target_feature_set.code,
      'version', target_feature_set.version,
      'status', target_feature_set.status,
      'is_enabled', target_feature_set.is_enabled
    ),
    'label_version',
      'highlightly_football_postmatch.score.1.0.0',
    'horizon', 't24h',
    'sample_limit', p_limit,
    'matches_considered', considered_count,
    'matches_processed', processed_count,
    'matches_failed', failed_count,
    'snapshots_created', COALESCE(snapshots_created, 0),
    'model_eligible_snapshots', COALESCE(model_eligible_count, 0),
    'remaining_missing_snapshots',
      greatest(considered_count - COALESCE(snapshots_created, 0), 0),
    'failures', failures,
    'safeguards', jsonb_build_object(
      'provider_enabled', provider_enabled,
      'provider_calls', 0,
      'stored_data_only', true,
      'labels_generated', 0,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN considered_count = 0
        THEN 'rerun_phase8g3_dataset_preview'
      WHEN failed_count > 0
        THEN 'review_feature_backfill_failures'
      WHEN COALESCE(snapshots_created, 0) = 0
        THEN 'review_stored_feature_sources'
      ELSE 'rerun_phase8g3_dataset_preview'
    END
  );
END
$function$;

REVOKE ALL
  ON FUNCTION public.backfill_highlightly_football_labeled_features_v1(
    integer
  )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.backfill_highlightly_football_labeled_features_v1(
    integer
  )
  TO service_role;

COMMENT ON FUNCTION
  public.get_highlightly_labeled_feature_backfill_preview_v1(integer) IS
  'Read-only Phase 8G.3.1 preview of valid labeled Football matches missing an exact T-24h feature snapshot.';
COMMENT ON FUNCTION
  public.backfill_highlightly_football_labeled_features_v1(integer) IS
  'Manual Phase 8G.3.1 stored-data-only feature backfill targeted to valid labeled Football matches, with zero provider calls.';

NOTIFY pgrst, 'reload schema';
