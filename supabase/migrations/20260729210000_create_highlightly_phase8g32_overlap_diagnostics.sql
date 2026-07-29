CREATE OR REPLACE FUNCTION
  public.get_highlightly_labeled_feature_overlap_diagnostics_v2(
    p_limit integer DEFAULT 200
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
  v_label_set_id uuid;
  v_feature_set_v100_id uuid;
  v_feature_set_v110_id uuid;
  v_feature_set_v120_id uuid;
  v_feature_set_v120_status text;
  v_feature_set_v120_enabled boolean;
  v_label_set_status text;
  v_label_set_enabled boolean;
  result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'overlap diagnostic limit must be between 1 and 200'
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

  SELECT feature_set.id
  INTO v_feature_set_v100_id
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = v_football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.0.0'
  LIMIT 1;

  SELECT feature_set.id
  INTO v_feature_set_v110_id
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = v_football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.1.0'
  LIMIT 1;

  SELECT
    feature_set.id,
    feature_set.status,
    feature_set.is_enabled
  INTO
    v_feature_set_v120_id,
    v_feature_set_v120_status,
    v_feature_set_v120_enabled
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
     OR v_label_set_id IS NULL
     OR v_feature_set_v100_id IS NULL
     OR v_feature_set_v110_id IS NULL
     OR v_feature_set_v120_id IS NULL THEN
    RETURN jsonb_build_object(
      'phase', '8G.3.2',
      'quality_contract_version', 'phase8g.3.2',
      'sport', 'football',
      'recommendation', 'install_missing_feature_or_label_contract',
      'safeguards', jsonb_build_object(
        'read_only', true,
        'provider_enabled', v_provider_enabled,
        'provider_calls', 0,
        'database_writes', 0,
        'stored_data_only', true,
        'labels_generated', 0,
        'automatic_training', false,
        'automatic_predictions', false
      )
    );
  END IF;

  WITH labeled_matches AS (
    SELECT
      label.id AS label_id,
      label.match_id,
      label.outcome_at,
      label.label_available_at,
      label.quality_status AS label_quality_status,
      match_row.kickoff_at,
      match_row.status AS match_status,
      match_row.provider_status,
      match_row.ended_at,
      match_row.competition_id,
      competition.name AS competition_name,
      competition.competition_type,
      country.name AS country_name,
      policy.profile_key AS policy_profile_key,
      policy.is_model_eligible AS policy_model_eligible
    FROM public.hl_match_labels AS label
    JOIN public.sports_matches AS match_row
      ON match_row.id = label.match_id
     AND match_row.sport_id = v_football_id
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN public.sports_countries AS country
      ON country.id = competition.country_id
    LEFT JOIN public.hl_competition_feature_policies AS policy
      ON policy.competition_id = match_row.competition_id
    WHERE label.label_set_id = v_label_set_id
      AND label.label_version
        = 'highlightly_football_postmatch.score.1.0.0'
      AND label.quality_status = 'valid'
    ORDER BY
      match_row.kickoff_at NULLS FIRST,
      match_row.id
    LIMIT p_limit
  ),
  assessed AS (
    SELECT
      labeled_match.*,
      participant_counts.home_count,
      participant_counts.away_count,
      COALESCE(
        labeled_match.policy_profile_key,
        public.classify_highlightly_football_competition(
          labeled_match.competition_name,
          labeled_match.competition_type
        )
      ) AS competition_profile,
      COALESCE(
        labeled_match.policy_model_eligible,
        public.classify_highlightly_football_competition(
          labeled_match.competition_name,
          labeled_match.competition_type
        ) <> 'unknown'
      ) AS competition_model_eligible,
      snapshot_v100.id AS snapshot_v100_id,
      snapshot_v100.cutoff_at AS snapshot_v100_cutoff_at,
      snapshot_v100.coverage_pct AS snapshot_v100_coverage_pct,
      snapshot_v100.leakage_status AS snapshot_v100_leakage_status,
      snapshot_v110.id AS snapshot_v110_id,
      snapshot_v110.cutoff_at AS snapshot_v110_cutoff_at,
      snapshot_v110.coverage_pct AS snapshot_v110_coverage_pct,
      snapshot_v110.leakage_status AS snapshot_v110_leakage_status,
      snapshot_v120.id AS snapshot_v120_id,
      snapshot_v120.cutoff_at AS snapshot_v120_cutoff_at,
      snapshot_v120.coverage_pct AS snapshot_v120_coverage_pct,
      snapshot_v120.leakage_status AS snapshot_v120_leakage_status,
      snapshot_v120.quality AS snapshot_v120_quality,
      EXISTS (
        SELECT 1
        FROM public.hl_match_feature_snapshots AS stale
        WHERE stale.feature_set_id = v_feature_set_v100_id
          AND stale.match_id = labeled_match.match_id
          AND stale.horizon_key = 't24h'
          AND stale.kickoff_at IS DISTINCT FROM labeled_match.kickoff_at
      ) AS snapshot_v100_kickoff_mismatch,
      EXISTS (
        SELECT 1
        FROM public.hl_match_feature_snapshots AS stale
        WHERE stale.feature_set_id = v_feature_set_v110_id
          AND stale.match_id = labeled_match.match_id
          AND stale.horizon_key = 't24h'
          AND stale.kickoff_at IS DISTINCT FROM labeled_match.kickoff_at
      ) AS snapshot_v110_kickoff_mismatch,
      EXISTS (
        SELECT 1
        FROM public.hl_match_feature_snapshots AS stale
        WHERE stale.feature_set_id = v_feature_set_v120_id
          AND stale.match_id = labeled_match.match_id
          AND stale.horizon_key = 't24h'
          AND stale.kickoff_at IS DISTINCT FROM labeled_match.kickoff_at
      ) AS snapshot_v120_kickoff_mismatch
    FROM labeled_matches AS labeled_match
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE participant.role = 'home')::integer
          AS home_count,
        count(*) FILTER (WHERE participant.role = 'away')::integer
          AS away_count
      FROM public.sports_match_participants AS participant
      WHERE participant.match_id = labeled_match.match_id
    ) AS participant_counts ON true
    LEFT JOIN LATERAL (
      SELECT
        snapshot.id,
        snapshot.cutoff_at,
        snapshot.coverage_pct,
        snapshot.leakage_status
      FROM public.hl_match_feature_snapshots AS snapshot
      WHERE snapshot.feature_set_id = v_feature_set_v100_id
        AND snapshot.match_id = labeled_match.match_id
        AND snapshot.horizon_key = 't24h'
        AND snapshot.kickoff_at = labeled_match.kickoff_at
      ORDER BY snapshot.created_at DESC, snapshot.id
      LIMIT 1
    ) AS snapshot_v100 ON true
    LEFT JOIN LATERAL (
      SELECT
        snapshot.id,
        snapshot.cutoff_at,
        snapshot.coverage_pct,
        snapshot.leakage_status
      FROM public.hl_match_feature_snapshots AS snapshot
      WHERE snapshot.feature_set_id = v_feature_set_v110_id
        AND snapshot.match_id = labeled_match.match_id
        AND snapshot.horizon_key = 't24h'
        AND snapshot.kickoff_at = labeled_match.kickoff_at
      ORDER BY snapshot.created_at DESC, snapshot.id
      LIMIT 1
    ) AS snapshot_v110 ON true
    LEFT JOIN LATERAL (
      SELECT
        snapshot.id,
        snapshot.cutoff_at,
        snapshot.coverage_pct,
        snapshot.leakage_status,
        snapshot.quality
      FROM public.hl_match_feature_snapshots AS snapshot
      WHERE snapshot.feature_set_id = v_feature_set_v120_id
        AND snapshot.match_id = labeled_match.match_id
        AND snapshot.horizon_key = 't24h'
        AND snapshot.kickoff_at = labeled_match.kickoff_at
      ORDER BY snapshot.created_at DESC, snapshot.id
      LIMIT 1
    ) AS snapshot_v120 ON true
  ),
  classified AS (
    SELECT
      assessed.*,
      CASE
        WHEN assessed.kickoff_at IS NULL
          THEN 'kickoff_missing'
        WHEN assessed.match_status NOT IN ('scheduled', 'finished')
          THEN 'canonical_status_not_supported'
        WHEN assessed.home_count <> 1 OR assessed.away_count <> 1
          THEN 'participants_incomplete'
        WHEN assessed.snapshot_v100_id IS NULL
          AND assessed.snapshot_v100_kickoff_mismatch
          THEN 'source_v100_kickoff_mismatch'
        WHEN assessed.snapshot_v100_id IS NULL
          THEN 'source_v100_snapshot_missing'
        WHEN assessed.snapshot_v110_id IS NULL
          AND assessed.snapshot_v110_kickoff_mismatch
          THEN 'source_v110_kickoff_mismatch'
        WHEN assessed.snapshot_v110_id IS NULL
          THEN 'source_v110_snapshot_missing'
        WHEN assessed.snapshot_v120_id IS NULL
          AND assessed.snapshot_v120_kickoff_mismatch
          THEN 'target_v120_kickoff_mismatch'
        WHEN assessed.snapshot_v120_id IS NULL
          THEN 'target_v120_snapshot_missing'
        WHEN assessed.snapshot_v120_leakage_status <> 'clean'
          THEN 'target_v120_leakage_not_clean'
        WHEN NOT COALESCE(
          (assessed.snapshot_v120_quality ->> 'model_eligible')::boolean,
          false
        ) THEN 'target_v120_not_model_eligible'
        ELSE 'eligible'
      END AS diagnostic_reason
    FROM assessed
  ),
  reason_counts AS (
    SELECT
      classified.diagnostic_reason,
      count(*)::integer AS matches
    FROM classified
    GROUP BY classified.diagnostic_reason
  ),
  status_counts AS (
    SELECT
      classified.match_status,
      classified.provider_status,
      count(*)::integer AS matches
    FROM classified
    GROUP BY
      classified.match_status,
      classified.provider_status
  ),
  profile_counts AS (
    SELECT
      classified.competition_profile,
      classified.competition_model_eligible,
      count(*)::integer AS matches
    FROM classified
    GROUP BY
      classified.competition_profile,
      classified.competition_model_eligible
  ),
  totals AS (
    SELECT
      count(*)::integer AS labeled_matches,
      count(*) FILTER (
        WHERE classified.snapshot_v100_id IS NOT NULL
      )::integer AS snapshot_v100_exact,
      count(*) FILTER (
        WHERE classified.snapshot_v110_id IS NOT NULL
      )::integer AS snapshot_v110_exact,
      count(*) FILTER (
        WHERE classified.snapshot_v120_id IS NOT NULL
      )::integer AS snapshot_v120_exact,
      count(*) FILTER (
        WHERE classified.snapshot_v100_kickoff_mismatch
      )::integer AS snapshot_v100_mismatch,
      count(*) FILTER (
        WHERE classified.snapshot_v110_kickoff_mismatch
      )::integer AS snapshot_v110_mismatch,
      count(*) FILTER (
        WHERE classified.snapshot_v120_kickoff_mismatch
      )::integer AS snapshot_v120_mismatch,
      count(*) FILTER (
        WHERE classified.diagnostic_reason = 'eligible'
      )::integer AS eligible_matches,
      count(*) FILTER (
        WHERE classified.diagnostic_reason <> 'eligible'
      )::integer AS blocked_matches
    FROM classified
  )
  SELECT jsonb_build_object(
    'phase', '8G.3.2',
    'quality_contract_version', 'phase8g.3.2',
    'generated_at', statement_timestamp(),
    'sport', 'football',
    'feature_set', 'highlightly_football_prematch@1.2.0',
    'label_version',
      'highlightly_football_postmatch.score.1.0.0',
    'horizon', 't24h',
    'sample_limit', p_limit,
    'totals', jsonb_build_object(
      'labeled_matches', totals.labeled_matches,
      'eligible_matches', totals.eligible_matches,
      'blocked_matches', totals.blocked_matches
    ),
    'stages', jsonb_build_object(
      'v1.0.0', jsonb_build_object(
        'exact_snapshots', totals.snapshot_v100_exact,
        'kickoff_mismatches', totals.snapshot_v100_mismatch
      ),
      'v1.1.0', jsonb_build_object(
        'exact_snapshots', totals.snapshot_v110_exact,
        'kickoff_mismatches', totals.snapshot_v110_mismatch
      ),
      'v1.2.0', jsonb_build_object(
        'exact_snapshots', totals.snapshot_v120_exact,
        'kickoff_mismatches', totals.snapshot_v120_mismatch
      )
    ),
    'reasons', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'reason', reason_count.diagnostic_reason,
            'matches', reason_count.matches
          )
          ORDER BY reason_count.matches DESC, reason_count.diagnostic_reason
        )
        FROM reason_counts AS reason_count
      ),
      '[]'::jsonb
    ),
    'statuses', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'match_status', status_count.match_status,
            'provider_status', status_count.provider_status,
            'matches', status_count.matches
          )
          ORDER BY
            status_count.matches DESC,
            status_count.match_status,
            status_count.provider_status
        )
        FROM status_counts AS status_count
      ),
      '[]'::jsonb
    ),
    'competition_profiles', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'profile', profile_count.competition_profile,
            'policy_model_eligible',
              profile_count.competition_model_eligible,
            'matches', profile_count.matches
          )
          ORDER BY
            profile_count.matches DESC,
            profile_count.competition_profile
        )
        FROM profile_counts AS profile_count
      ),
      '[]'::jsonb
    ),
    'matches', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_strip_nulls(
            jsonb_build_object(
              'match_id', classified.match_id,
              'label_id', classified.label_id,
              'kickoff_at', classified.kickoff_at,
              'outcome_at', classified.outcome_at,
              'ended_at', classified.ended_at,
              'match_status', classified.match_status,
              'provider_status', classified.provider_status,
              'competition_id', classified.competition_id,
              'competition_name', classified.competition_name,
              'country_name', classified.country_name,
              'competition_profile', classified.competition_profile,
              'competition_model_eligible',
                classified.competition_model_eligible,
              'participants', jsonb_build_object(
                'home', classified.home_count,
                'away', classified.away_count
              ),
              'snapshots', jsonb_build_object(
                'v1.0.0', jsonb_build_object(
                  'exact', classified.snapshot_v100_id IS NOT NULL,
                  'kickoff_mismatch',
                    classified.snapshot_v100_kickoff_mismatch,
                  'snapshot_id', classified.snapshot_v100_id,
                  'cutoff_at', classified.snapshot_v100_cutoff_at,
                  'coverage_pct',
                    classified.snapshot_v100_coverage_pct,
                  'leakage_status',
                    classified.snapshot_v100_leakage_status
                ),
                'v1.1.0', jsonb_build_object(
                  'exact', classified.snapshot_v110_id IS NOT NULL,
                  'kickoff_mismatch',
                    classified.snapshot_v110_kickoff_mismatch,
                  'snapshot_id', classified.snapshot_v110_id,
                  'cutoff_at', classified.snapshot_v110_cutoff_at,
                  'coverage_pct',
                    classified.snapshot_v110_coverage_pct,
                  'leakage_status',
                    classified.snapshot_v110_leakage_status
                ),
                'v1.2.0', jsonb_build_object(
                  'exact', classified.snapshot_v120_id IS NOT NULL,
                  'kickoff_mismatch',
                    classified.snapshot_v120_kickoff_mismatch,
                  'snapshot_id', classified.snapshot_v120_id,
                  'cutoff_at', classified.snapshot_v120_cutoff_at,
                  'coverage_pct',
                    classified.snapshot_v120_coverage_pct,
                  'leakage_status',
                    classified.snapshot_v120_leakage_status,
                  'model_eligible', COALESCE(
                    (
                      classified.snapshot_v120_quality
                        ->> 'model_eligible'
                    )::boolean,
                    false
                  ),
                  'eligibility_reason',
                    classified.snapshot_v120_quality
                      ->> 'eligibility_reason'
                )
              ),
              'diagnostic_reason', classified.diagnostic_reason
            )
          )
          ORDER BY
            classified.kickoff_at NULLS FIRST,
            classified.match_id
        )
        FROM classified
      ),
      '[]'::jsonb
    ),
    'contracts', jsonb_build_object(
      'feature_set_status', v_feature_set_v120_status,
      'feature_set_enabled', v_feature_set_v120_enabled,
      'label_set_status', v_label_set_status,
      'label_set_enabled', v_label_set_enabled
    ),
    'safeguards', jsonb_build_object(
      'read_only', true,
      'provider_enabled', v_provider_enabled,
      'provider_calls', 0,
      'database_writes', 0,
      'stored_data_only', true,
      'labels_generated', 0,
      'automatic_training', false,
      'automatic_predictions', false
    ),
    'recommendation', CASE
      WHEN v_provider_enabled IS DISTINCT FROM false
        THEN 'disable_provider'
      WHEN v_feature_set_v120_status <> 'draft'
        OR v_feature_set_v120_enabled
        OR v_label_set_status <> 'draft'
        OR v_label_set_enabled
        THEN 'restore_draft_disabled_contracts'
      WHEN totals.blocked_matches = 0
        THEN 'rebuild_phase8g3_dataset'
      WHEN EXISTS (
        SELECT 1
        FROM classified
        WHERE classified.diagnostic_reason = 'participants_incomplete'
      ) THEN 'repair_participants_before_rematerialization'
      WHEN EXISTS (
        SELECT 1
        FROM classified
        WHERE classified.diagnostic_reason LIKE '%kickoff_mismatch'
      ) THEN 'reconcile_kickoff_before_rematerialization'
      WHEN EXISTS (
        SELECT 1
        FROM classified
        WHERE classified.diagnostic_reason
          = 'source_v100_snapshot_missing'
      ) THEN 'rematerialize_v100_then_v110_then_v120'
      WHEN EXISTS (
        SELECT 1
        FROM classified
        WHERE classified.diagnostic_reason
          = 'source_v110_snapshot_missing'
      ) THEN 'rematerialize_v110_then_v120'
      WHEN EXISTS (
        SELECT 1
        FROM classified
        WHERE classified.diagnostic_reason
          = 'target_v120_snapshot_missing'
      ) THEN 'rematerialize_v120'
      ELSE 'review_blocked_snapshot_quality'
    END
  )
  INTO result
  FROM totals;

  RETURN result;
END
$function$;

REVOKE ALL
  ON FUNCTION
    public.get_highlightly_labeled_feature_overlap_diagnostics_v2(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION
    public.get_highlightly_labeled_feature_overlap_diagnostics_v2(integer)
  TO service_role;

COMMENT ON FUNCTION
  public.get_highlightly_labeled_feature_overlap_diagnostics_v2(integer) IS
  'Read-only Phase 8G.3.2 diagnosis of valid Football labels across exact T-24h feature snapshot versions, with zero provider calls or writes.';

NOTIFY pgrst, 'reload schema';
