INSERT INTO public.hl_feature_sets (
  sport_id,
  code,
  version,
  status,
  is_enabled,
  cutoff_policy,
  feature_spec
)
SELECT
  sport.id,
  'highlightly_football_prematch',
  '1.1.0',
  'draft',
  false,
  'Every source timestamp must be less than or equal to kickoff minus the requested horizon.',
  jsonb_build_object(
    'horizons', jsonb_build_array('t24h', 't6h', 't60m'),
    'components', jsonb_build_array(
      'identity',
      'home_recent_form',
      'away_recent_form',
      'home_standings',
      'away_standings',
      'team_season_metrics',
      'prematch_odds_consensus',
      'lineup_availability'
    ),
    'component_policy', jsonb_build_object(
      't24h', jsonb_build_object(
        'required', jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings'
        ),
        'optional', jsonb_build_array('prematch_odds', 'lineups')
      ),
      't6h', jsonb_build_object(
        'required', jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings',
          'prematch_odds'
        ),
        'optional', jsonb_build_array('lineups')
      ),
      't60m', jsonb_build_object(
        'required', jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings',
          'prematch_odds',
          'lineups'
        ),
        'optional', '[]'::jsonb
      )
    ),
    'coverage_policy_version', 'phase8f.2',
    'stored_coverage_denominator', 6,
    'policy_adjusted_coverage', true,
    'targets_separated', true,
    'target_match_facts_forbidden', jsonb_build_array(
      'sports_match_team_stats',
      'sports_match_events',
      'sports_player_box_scores',
      'sports_match_period_scores',
      'sports_matches.score_data'
    )
  )
FROM public.sports AS sport
WHERE sport.code = 'football'
ON CONFLICT (sport_id, code, version) DO UPDATE SET
  status = 'draft',
  is_enabled = false,
  cutoff_policy = EXCLUDED.cutoff_policy,
  feature_spec = EXCLUDED.feature_spec,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.materialize_highlightly_football_features_v2(
  p_from timestamptz,
  p_to timestamptz,
  p_horizon_key text DEFAULT 't24h',
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  source_feature_set public.hl_feature_sets%ROWTYPE;
  target_feature_set public.hl_feature_sets%ROWTYPE;
  source_result jsonb;
  materialization_run_id uuid;
  considered integer := 0;
  inserted integer := 0;
  skipped integer := 0;
  blocked integer := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'feature window must be ordered'
      USING ERRCODE = '22023';
  END IF;
  IF p_to > p_from + interval '31 days' THEN
    RAISE EXCEPTION 'feature window must not exceed 31 days'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'feature snapshot limit must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;
  IF p_horizon_key IS NULL
     OR p_horizon_key NOT IN ('t24h', 't6h', 't60m') THEN
    RAISE EXCEPTION 'unsupported feature horizon: %', p_horizon_key
      USING ERRCODE = '22023';
  END IF;

  SELECT feature_set.*
  INTO source_feature_set
  FROM public.hl_feature_sets AS feature_set
  JOIN public.sports AS sport ON sport.id = feature_set.sport_id
  WHERE sport.code = 'football'
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.0.0'
  LIMIT 1;

  SELECT feature_set.*
  INTO target_feature_set
  FROM public.hl_feature_sets AS feature_set
  JOIN public.sports AS sport ON sport.id = feature_set.sport_id
  WHERE sport.code = 'football'
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.1.0'
  LIMIT 1;

  IF source_feature_set.id IS NULL OR target_feature_set.id IS NULL THEN
    RAISE EXCEPTION 'football feature sets 1.0.0 and 1.1.0 must be installed';
  END IF;

  /*
   * The v1 builder remains the point-in-time source of truth. Calling it here
   * is idempotent and bounded; the 1.1 snapshot is then derived in the same
   * transaction without provider calls or labels.
   */
  source_result := public.materialize_highlightly_football_features(
    p_from,
    p_to,
    p_horizon_key,
    p_limit
  );

  INSERT INTO public.hl_feature_materialization_runs (
    feature_set_id,
    sport_id,
    horizon_key,
    window_from,
    window_to,
    diagnostics
  )
  VALUES (
    target_feature_set.id,
    target_feature_set.sport_id,
    p_horizon_key,
    p_from,
    p_to,
    jsonb_build_object(
      'coverage_policy_version', 'phase8f.2',
      'source_feature_set_version', '1.0.0'
    )
  )
  RETURNING id INTO materialization_run_id;

  WITH source_snapshots AS (
    SELECT source_snapshot.*
    FROM public.hl_match_feature_snapshots AS source_snapshot
    WHERE source_snapshot.feature_set_id = source_feature_set.id
      AND source_snapshot.horizon_key = p_horizon_key
      AND source_snapshot.kickoff_at >= p_from
      AND source_snapshot.kickoff_at < p_to
    ORDER BY source_snapshot.kickoff_at, source_snapshot.match_id
    LIMIT p_limit
  ),
  scored AS (
    SELECT
      source_snapshot.*,
      CASE p_horizon_key
        WHEN 't24h' THEN jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings'
        )
        WHEN 't6h' THEN jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings',
          'prematch_odds'
        )
        ELSE jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings',
          'prematch_odds',
          'lineups'
        )
      END AS required_components,
      CASE p_horizon_key
        WHEN 't24h' THEN jsonb_build_array('prematch_odds', 'lineups')
        WHEN 't6h' THEN jsonb_build_array('lineups')
        ELSE '[]'::jsonb
      END AS optional_components,
      (
        CASE WHEN COALESCE(
          (source_snapshot.quality ->> 'home_history_available')::boolean,
          false
        ) THEN 1 ELSE 0 END
        + CASE WHEN COALESCE(
          (source_snapshot.quality ->> 'away_history_available')::boolean,
          false
        ) THEN 1 ELSE 0 END
        + CASE WHEN COALESCE(
          (source_snapshot.quality ->> 'home_standings_available')::boolean,
          false
        ) THEN 1 ELSE 0 END
        + CASE WHEN COALESCE(
          (source_snapshot.quality ->> 'away_standings_available')::boolean,
          false
        ) THEN 1 ELSE 0 END
        + CASE
          WHEN p_horizon_key IN ('t6h', 't60m')
            AND COALESCE(
              (source_snapshot.quality ->> 'odds_available')::boolean,
              false
            )
          THEN 1 ELSE 0
        END
        + CASE
          WHEN p_horizon_key = 't60m'
            AND COALESCE(
              (source_snapshot.quality ->> 'lineups_available')::boolean,
              false
            )
          THEN 1 ELSE 0
        END
      ) AS required_available,
      CASE p_horizon_key
        WHEN 't24h' THEN 4
        WHEN 't6h' THEN 5
        ELSE 6
      END AS required_expected
    FROM source_snapshots AS source_snapshot
  ),
  inserted_rows AS (
    INSERT INTO public.hl_match_feature_snapshots (
      feature_set_id,
      match_id,
      horizon_key,
      cutoff_at,
      kickoff_at,
      generated_at,
      features,
      lineage,
      quality,
      coverage_pct,
      leakage_status
    )
    SELECT
      target_feature_set.id,
      scored.match_id,
      scored.horizon_key,
      scored.cutoff_at,
      scored.kickoff_at,
      statement_timestamp(),
      jsonb_set(
        scored.features,
        '{schema_version}',
        to_jsonb(target_feature_set.version),
        true
      ) || jsonb_build_object(
        'coverage_policy_version',
        'phase8f.2'
      ),
      scored.lineage || jsonb_build_object(
        'derived_from_feature_snapshot_id',
        scored.id,
        'source_feature_set_version',
        '1.0.0',
        'coverage_policy_version',
        'phase8f.2',
        'target_match_facts_used',
        false
      ),
      scored.quality || jsonb_build_object(
        'required_components',
        scored.required_components,
        'optional_components',
        scored.optional_components,
        'required_available',
        scored.required_available,
        'required_expected',
        scored.required_expected,
        'stored_coverage_pct',
        scored.coverage_pct,
        'policy_adjusted_coverage_pct',
        round(
          100.0 * scored.required_available
            / NULLIF(scored.required_expected, 0),
          2
        )
      ),
      round(
        100.0 * scored.required_available
          / NULLIF(scored.required_expected, 0),
        2
      ),
      scored.leakage_status
    FROM scored
    ON CONFLICT (feature_set_id, match_id, horizon_key, cutoff_at)
    DO NOTHING
    RETURNING leakage_status
  )
  SELECT
    (SELECT count(*)::integer FROM source_snapshots),
    count(*)::integer,
    count(*) FILTER (
      WHERE inserted_rows.leakage_status = 'blocked'
    )::integer
  INTO considered, inserted, blocked
  FROM inserted_rows;

  skipped := GREATEST(considered - inserted, 0);

  UPDATE public.hl_feature_materialization_runs
  SET
    status = CASE
      WHEN blocked > 0 THEN 'completed_with_exceptions'
      ELSE 'completed'
    END,
    matches_considered = considered,
    snapshots_inserted = inserted,
    snapshots_skipped = skipped,
    snapshots_blocked = blocked,
    finished_at = statement_timestamp(),
    diagnostics = diagnostics || jsonb_build_object(
      'provider_calls', 0,
      'labels_generated', 0,
      'feature_set_enabled', target_feature_set.is_enabled,
      'source_materializer_result', source_result
    )
  WHERE id = materialization_run_id;

  RETURN jsonb_build_object(
    'run_id', materialization_run_id,
    'feature_set', target_feature_set.code,
    'version', target_feature_set.version,
    'source_version', source_feature_set.version,
    'horizon', p_horizon_key,
    'matches_considered', considered,
    'snapshots_inserted', inserted,
    'snapshots_skipped', skipped,
    'snapshots_blocked', blocked,
    'provider_calls', 0,
    'labels_generated', 0,
    'automatic_training', false,
    'automatic_predictions', false
  );
EXCEPTION
  WHEN OTHERS THEN
    IF materialization_run_id IS NOT NULL THEN
      UPDATE public.hl_feature_materialization_runs
      SET
        status = 'failed',
        finished_at = statement_timestamp(),
        diagnostics = diagnostics || jsonb_build_object(
          'sqlstate', SQLSTATE,
          'error', SQLERRM,
          'provider_calls', 0,
          'labels_generated', 0
        )
      WHERE id = materialization_run_id;
    END IF;
    RAISE;
END
$function$;

REVOKE ALL ON FUNCTION public.materialize_highlightly_football_features_v2(
  timestamptz,
  timestamptz,
  text,
  integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_highlightly_football_features_v2(
  timestamptz,
  timestamptz,
  text,
  integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_feature_store_report_v4(
  p_sport text DEFAULT 'football',
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
  feature_set_report jsonb;
  catalog_report jsonb;
  component_report jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'feature report days must be between 1 and 365'
      USING ERRCODE = '22023';
  END IF;
  IF p_sport IS DISTINCT FROM 'football' THEN
    RAISE EXCEPTION 'Phase 8F.2 horizon policy currently supports Football only'
      USING ERRCODE = '22023';
  END IF;
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'Highlightly feature report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  base_report := public.get_highlightly_feature_store_report_v3(
    p_sport,
    p_days
  );

  WITH target AS (
    SELECT
      feature_set.id,
      feature_set.code,
      feature_set.version,
      feature_set.status,
      feature_set.is_enabled,
      feature_set.cutoff_policy,
      feature_set.feature_spec
    FROM public.hl_feature_sets AS feature_set
    JOIN public.sports AS sport ON sport.id = feature_set.sport_id
    WHERE sport.code = p_sport
  ),
  snapshots AS (
    SELECT
      snapshot.*,
      target.code,
      target.version,
      target.status AS feature_set_status,
      target.is_enabled
    FROM target
    JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.feature_set_id = target.id
    WHERE snapshot.kickoff_at
      >= statement_timestamp() - make_interval(days => p_days)
  ),
  component_rows AS (
    SELECT
      snapshot.id AS snapshot_id,
      snapshot.code,
      snapshot.version,
      snapshot.feature_set_status,
      snapshot.is_enabled,
      snapshot.horizon_key,
      snapshot.coverage_pct AS stored_coverage_pct,
      snapshot.leakage_status,
      snapshot.kickoff_at,
      component_value.component_key,
      component_value.available,
      CASE snapshot.horizon_key
        WHEN 't24h' THEN component_value.component_key IN (
          'home_history',
          'away_history',
          'home_standings',
          'away_standings'
        )
        WHEN 't6h' THEN component_value.component_key <> 'lineups'
        WHEN 't60m' THEN true
        ELSE false
      END AS required_for_horizon
    FROM snapshots AS snapshot
    CROSS JOIN LATERAL (
      VALUES
        (
          'home_history',
          COALESCE(
            (snapshot.quality ->> 'home_history_available')::boolean,
            false
          )
        ),
        (
          'away_history',
          COALESCE(
            (snapshot.quality ->> 'away_history_available')::boolean,
            false
          )
        ),
        (
          'home_standings',
          COALESCE(
            (snapshot.quality ->> 'home_standings_available')::boolean,
            false
          )
        ),
        (
          'away_standings',
          COALESCE(
            (snapshot.quality ->> 'away_standings_available')::boolean,
            false
          )
        ),
        (
          'prematch_odds',
          COALESCE(
            (snapshot.quality ->> 'odds_available')::boolean,
            false
          )
        ),
        (
          'lineups',
          COALESCE(
            (snapshot.quality ->> 'lineups_available')::boolean,
            false
          )
        )
    ) AS component_value(component_key, available)
  ),
  snapshot_scores AS (
    SELECT
      component.snapshot_id,
      component.code,
      component.version,
      component.feature_set_status,
      component.is_enabled,
      component.horizon_key,
      component.stored_coverage_pct,
      component.leakage_status,
      component.kickoff_at,
      count(*) FILTER (
        WHERE component.required_for_horizon
      )::integer AS required_components,
      count(*) FILTER (
        WHERE component.required_for_horizon
          AND component.available
      )::integer AS required_available,
      round(
        100.0 * count(*) FILTER (
          WHERE component.required_for_horizon
            AND component.available
        ) / NULLIF(
          count(*) FILTER (WHERE component.required_for_horizon),
          0
        ),
        2
      ) AS policy_adjusted_coverage_pct
    FROM component_rows AS component
    GROUP BY
      component.snapshot_id,
      component.code,
      component.version,
      component.feature_set_status,
      component.is_enabled,
      component.horizon_key,
      component.stored_coverage_pct,
      component.leakage_status,
      component.kickoff_at
  ),
  feature_set_summary AS (
    SELECT
      score.code,
      score.version,
      score.feature_set_status AS status,
      score.is_enabled,
      score.horizon_key,
      count(*)::integer AS snapshots,
      round(avg(score.stored_coverage_pct), 2)
        AS stored_average_coverage_pct,
      round(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY score.stored_coverage_pct
        )::numeric,
        2
      ) AS stored_median_coverage_pct,
      round(avg(score.policy_adjusted_coverage_pct), 2)
        AS policy_adjusted_average_coverage_pct,
      round(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY score.policy_adjusted_coverage_pct
        )::numeric,
        2
      ) AS policy_adjusted_median_coverage_pct,
      min(score.policy_adjusted_coverage_pct)
        AS policy_adjusted_minimum_coverage_pct,
      max(score.policy_adjusted_coverage_pct)
        AS policy_adjusted_maximum_coverage_pct,
      max(score.required_components)::integer AS required_components,
      count(*) FILTER (
        WHERE score.leakage_status = 'clean'
      )::integer AS clean_snapshots,
      count(*) FILTER (
        WHERE score.leakage_status = 'review'
      )::integer AS review_snapshots,
      count(*) FILTER (
        WHERE score.leakage_status = 'blocked'
      )::integer AS blocked_snapshots,
      min(score.kickoff_at) AS first_kickoff_at,
      max(score.kickoff_at) AS last_kickoff_at
    FROM snapshot_scores AS score
    GROUP BY
      score.code,
      score.version,
      score.feature_set_status,
      score.is_enabled,
      score.horizon_key
  ),
  feature_set_scored AS (
    SELECT
      summary.*,
      CASE
        WHEN summary.blocked_snapshots > 0 THEN 'blocked_by_leakage'
        WHEN summary.snapshots < 20 THEN 'insufficient_sample'
        WHEN summary.policy_adjusted_average_coverage_pct < 70
          THEN 'improve_required_coverage'
        WHEN summary.snapshots < 100 THEN 'ready_for_100_match_canary'
        ELSE 'ready_for_feature_review'
      END AS recommendation
    FROM feature_set_summary AS summary
  ),
  component_summary AS (
    SELECT
      component.code,
      component.version,
      component.horizon_key,
      component.component_key AS component,
      CASE
        WHEN component.required_for_horizon THEN 'required'
        ELSE 'optional'
      END AS requirement,
      count(*)::integer AS snapshots,
      count(*) FILTER (
        WHERE component.available
      )::integer AS available_snapshots,
      count(*) FILTER (
        WHERE NOT component.available
      )::integer AS missing_snapshots,
      round(
        100.0 * count(*) FILTER (WHERE component.available)
          / NULLIF(count(*), 0),
        2
      ) AS availability_pct,
      CASE
        WHEN NOT component.required_for_horizon THEN 'optional'
        WHEN count(*) < 20 THEN 'insufficient_sample'
        WHEN 100.0 * count(*) FILTER (WHERE component.available)
          / NULLIF(count(*), 0) < 50 THEN 'critical_gap'
        WHEN 100.0 * count(*) FILTER (WHERE component.available)
          / NULLIF(count(*), 0) < 70 THEN 'coverage_gap'
        ELSE 'acceptable'
      END AS status
    FROM component_rows AS component
    GROUP BY
      component.code,
      component.version,
      component.horizon_key,
      component.component_key,
      component.required_for_horizon
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(scored)
          ORDER BY scored.code, scored.version, scored.horizon_key
        )
        FROM feature_set_scored AS scored
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'code', target.code,
            'version', target.version,
            'status', target.status,
            'is_enabled', target.is_enabled,
            'cutoff_policy', target.cutoff_policy,
            'coverage_policy_version',
              target.feature_spec ->> 'coverage_policy_version',
            'component_policy',
              target.feature_spec -> 'component_policy',
            'targets_separated',
              COALESCE(
                (target.feature_spec ->> 'targets_separated')::boolean,
                false
              )
          )
          ORDER BY target.code, target.version
        )
        FROM target
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(component)
          ORDER BY
            component.code,
            component.version,
            component.horizon_key,
            component.component
        )
        FROM component_summary AS component
      ),
      '[]'::jsonb
    )
  INTO feature_set_report, catalog_report, component_report;

  RETURN base_report || jsonb_build_object(
    'quality_contract_version', 'phase8f.2',
    'coverage_semantics', jsonb_build_object(
      'stored', 'All six components are equally weighted.',
      'policy_adjusted',
        'Only components required for the requested horizon are weighted.'
    ),
    'horizon_policies', jsonb_build_object(
      't24h', jsonb_build_object(
        'required', jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings'
        ),
        'optional', jsonb_build_array('prematch_odds', 'lineups')
      ),
      't6h', jsonb_build_object(
        'required', jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings',
          'prematch_odds'
        ),
        'optional', jsonb_build_array('lineups')
      ),
      't60m', jsonb_build_object(
        'required', jsonb_build_array(
          'home_history',
          'away_history',
          'home_standings',
          'away_standings',
          'prematch_odds',
          'lineups'
        ),
        'optional', '[]'::jsonb
      )
    ),
    'stored_feature_sets', COALESCE(
      base_report -> 'feature_sets',
      '[]'::jsonb
    ),
    'feature_sets', feature_set_report,
    'feature_set_catalog', catalog_report,
    'components', component_report,
    'automatic_training', false,
    'automatic_predictions', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_feature_store_report_v4(
  text,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_feature_store_report_v4(
  text,
  integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.materialize_highlightly_football_features_v2(
  timestamptz,
  timestamptz,
  text,
  integer
) IS
  'Phase 8F.2 service-role materializer for Football 1.1.0. Derives immutable horizon-adjusted snapshots from the point-in-time v1 builder without provider calls or labels.';

COMMENT ON FUNCTION public.get_highlightly_feature_store_report_v4(
  text,
  integer
) IS
  'Phase 8F.2 admin report comparing stored six-component coverage with required-component coverage adjusted by horizon.';

NOTIFY pgrst, 'reload schema';
