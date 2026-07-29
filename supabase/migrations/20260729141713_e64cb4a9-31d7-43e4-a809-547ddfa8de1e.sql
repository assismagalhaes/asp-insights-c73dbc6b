CREATE INDEX IF NOT EXISTS idx_hl_match_feature_snapshots_report
  ON public.hl_match_feature_snapshots (
    feature_set_id,
    kickoff_at DESC,
    horizon_key
  );

CREATE OR REPLACE FUNCTION public.get_highlightly_feature_store_report_v7(
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
  stored_feature_set_report jsonb;
  stored_profile_report jsonb;
  stored_reason_report jsonb;
  stored_component_report jsonb;
  stored_overall_report jsonb;
  corrected_feature_sets jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'feature report days must be between 1 and 365'
      USING ERRCODE = '22023';
  END IF;
  IF p_sport IS DISTINCT FROM 'football' THEN
    RAISE EXCEPTION 'Phase 8F.3.2 currently supports Football only'
      USING ERRCODE = '22023';
  END IF;
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role(
         (SELECT auth.uid()),
         'admin'::public.app_role
       )
     ) THEN
    RAISE EXCEPTION 'Highlightly feature report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  base_report := public.get_highlightly_feature_store_report_v6(
    p_sport,
    p_days
  );

  WITH target AS (
    SELECT
      feature_set.id,
      feature_set.code,
      feature_set.version,
      feature_set.status,
      feature_set.is_enabled
    FROM public.hl_feature_sets AS feature_set
    JOIN public.sports AS sport
      ON sport.id = feature_set.sport_id
     AND sport.code = p_sport
    WHERE feature_set.code = 'highlightly_football_prematch'
      AND feature_set.version = '1.2.0'
    LIMIT 1
  ),
  snapshots AS (
    SELECT
      snapshot.*,
      target.code,
      target.version,
      target.status AS feature_set_status,
      target.is_enabled,
      COALESCE(
        NULLIF(snapshot.quality ->> 'competition_profile', ''),
        'unknown'
      ) AS profile_key,
      COALESCE(
        NULLIF(snapshot.quality ->> 'standings_policy', ''),
        CASE
          WHEN snapshot.quality ->> 'competition_profile' = 'league'
            THEN 'required'
          ELSE 'optional'
        END
      ) AS standings_policy,
      COALESCE(
        (snapshot.quality ->> 'model_eligible')::boolean,
        false
      ) AS model_eligible,
      CASE
        WHEN snapshot.leakage_status <> 'clean'
          THEN 'leakage_not_clean'
        WHEN COALESCE(
          (snapshot.quality ->> 'model_eligible')::boolean,
          false
        ) THEN 'eligible'
        ELSE COALESCE(
          NULLIF(snapshot.quality ->> 'eligibility_reason', ''),
          'missing_eligibility_reason'
        )
      END AS eligibility_reason,
      COALESCE(
        (
          snapshot.quality
            ->> 'policy_adjusted_coverage_pct'
        )::numeric,
        snapshot.coverage_pct
      ) AS competition_aware_coverage_pct
    FROM target
    JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.feature_set_id = target.id
    WHERE snapshot.kickoff_at
      >= statement_timestamp() - make_interval(days => p_days)
  ),
  feature_set_summary_base AS (
    SELECT
      snapshot.code,
      snapshot.version,
      snapshot.feature_set_status AS status,
      snapshot.is_enabled,
      snapshot.horizon_key,
      count(*)::integer AS snapshots,
      round(
        avg(snapshot.competition_aware_coverage_pct),
        2
      ) AS competition_aware_average_coverage_pct,
      round(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY snapshot.competition_aware_coverage_pct
        )::numeric,
        2
      ) AS competition_aware_median_coverage_pct,
      min(snapshot.competition_aware_coverage_pct)
        AS competition_aware_minimum_coverage_pct,
      max(snapshot.competition_aware_coverage_pct)
        AS competition_aware_maximum_coverage_pct,
      count(*) FILTER (
        WHERE snapshot.model_eligible
      )::integer AS model_eligible_snapshots,
      round(
        100.0 * count(*) FILTER (
          WHERE snapshot.model_eligible
        ) / NULLIF(count(*), 0),
        2
      ) AS model_eligible_pct,
      count(*) FILTER (
        WHERE snapshot.profile_key = 'unknown'
      )::integer AS unclassified_snapshots,
      count(*) FILTER (
        WHERE snapshot.leakage_status = 'clean'
      )::integer AS clean_snapshots,
      count(*) FILTER (
        WHERE snapshot.leakage_status = 'review'
      )::integer AS review_snapshots,
      count(*) FILTER (
        WHERE snapshot.leakage_status = 'blocked'
      )::integer AS blocked_snapshots,
      min(snapshot.kickoff_at) AS first_kickoff_at,
      max(snapshot.kickoff_at) AS last_kickoff_at
    FROM snapshots AS snapshot
    GROUP BY
      snapshot.code,
      snapshot.version,
      snapshot.feature_set_status,
      snapshot.is_enabled,
      snapshot.horizon_key
  ),
  feature_set_summary AS (
    SELECT
      summary.*,
      CASE
        WHEN summary.blocked_snapshots > 0
          THEN 'blocked_by_leakage'
        WHEN summary.snapshots < 20
          THEN 'insufficient_sample'
        WHEN summary.unclassified_snapshots > 0
          THEN 'review_unclassified_competitions'
        WHEN summary.model_eligible_pct < 70
          THEN 'improve_profile_coverage'
        WHEN summary.snapshots < 100
          THEN 'ready_for_100_match_canary'
        ELSE 'ready_for_feature_review'
      END AS recommendation
    FROM feature_set_summary_base AS summary
  ),
  profile_summary_base AS (
    SELECT
      snapshot.profile_key,
      snapshot.standings_policy,
      snapshot.horizon_key,
      count(*)::integer AS snapshots,
      round(
        avg(snapshot.competition_aware_coverage_pct),
        2
      ) AS average_coverage_pct,
      round(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY snapshot.competition_aware_coverage_pct
        )::numeric,
        2
      ) AS median_coverage_pct,
      count(*) FILTER (
        WHERE snapshot.model_eligible
      )::integer AS model_eligible_snapshots,
      round(
        100.0 * count(*) FILTER (
          WHERE snapshot.model_eligible
        ) / NULLIF(count(*), 0),
        2
      ) AS model_eligible_pct,
      count(*) FILTER (
        WHERE NOT snapshot.model_eligible
      )::integer AS ineligible_snapshots,
      count(*) FILTER (
        WHERE snapshot.leakage_status = 'blocked'
      )::integer AS leakage_blocked_snapshots
    FROM snapshots AS snapshot
    GROUP BY
      snapshot.profile_key,
      snapshot.standings_policy,
      snapshot.horizon_key
  ),
  profile_summary AS (
    SELECT
      profile.*,
      CASE
        WHEN profile.leakage_blocked_snapshots > 0
          THEN 'blocked_by_leakage'
        WHEN profile.profile_key = 'unknown'
          THEN 'profile_not_eligible'
        WHEN profile.model_eligible_pct < 70
          THEN 'coverage_gap'
        ELSE 'acceptable'
      END AS status
    FROM profile_summary_base AS profile
  ),
  reason_summary AS (
    SELECT
      snapshot.profile_key,
      snapshot.horizon_key,
      snapshot.eligibility_reason,
      count(*)::integer AS snapshots,
      round(
        avg(snapshot.competition_aware_coverage_pct),
        2
      ) AS average_coverage_pct,
      CASE
        WHEN snapshot.eligibility_reason = 'eligible'
          THEN 'eligible'
        ELSE 'ineligible'
      END AS status
    FROM snapshots AS snapshot
    GROUP BY
      snapshot.profile_key,
      snapshot.horizon_key,
      snapshot.eligibility_reason
  ),
  component_rows AS (
    SELECT
      snapshot.profile_key,
      snapshot.standings_policy,
      snapshot.horizon_key,
      component_value.component_key,
      component_value.available,
      CASE
        WHEN component_value.component_key IN (
          'home_history',
          'away_history'
        ) THEN true
        WHEN component_value.component_key IN (
          'home_standings',
          'away_standings'
        ) THEN snapshot.standings_policy = 'required'
        WHEN component_value.component_key = 'prematch_odds'
          THEN snapshot.horizon_key IN ('t6h', 't60m')
        WHEN component_value.component_key = 'lineups'
          THEN snapshot.horizon_key = 't60m'
        ELSE false
      END AS required_for_profile
    FROM snapshots AS snapshot
    CROSS JOIN LATERAL (
      VALUES
        (
          'home_history',
          COALESCE(
            (
              snapshot.quality
                ->> 'home_history_available'
            )::boolean,
            false
          )
        ),
        (
          'away_history',
          COALESCE(
            (
              snapshot.quality
                ->> 'away_history_available'
            )::boolean,
            false
          )
        ),
        (
          'home_standings',
          COALESCE(
            (
              snapshot.quality
                ->> 'home_standings_available'
            )::boolean,
            false
          )
        ),
        (
          'away_standings',
          COALESCE(
            (
              snapshot.quality
                ->> 'away_standings_available'
            )::boolean,
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
  component_summary_base AS (
    SELECT
      component.profile_key,
      component.standings_policy,
      component.horizon_key,
      component.component_key AS component,
      CASE
        WHEN component.required_for_profile THEN 'required'
        ELSE 'optional'
      END AS requirement,
      component.required_for_profile,
      count(*)::integer AS snapshots,
      count(*) FILTER (
        WHERE component.available
      )::integer AS available_snapshots,
      count(*) FILTER (
        WHERE NOT component.available
      )::integer AS missing_snapshots,
      round(
        100.0 * count(*) FILTER (
          WHERE component.available
        ) / NULLIF(count(*), 0),
        2
      ) AS availability_pct
    FROM component_rows AS component
    GROUP BY
      component.profile_key,
      component.standings_policy,
      component.horizon_key,
      component.component_key,
      component.required_for_profile
  ),
  component_summary AS (
    SELECT
      component.*,
      CASE
        WHEN NOT component.required_for_profile
          THEN 'optional'
        WHEN component.snapshots < 20
          THEN 'insufficient_sample'
        WHEN component.availability_pct < 50
          THEN 'critical_gap'
        WHEN component.availability_pct < 70
          THEN 'coverage_gap'
        ELSE 'acceptable'
      END AS status
    FROM component_summary_base AS component
  ),
  overall_summary_base AS (
    SELECT
      count(*)::integer AS snapshots,
      round(
        avg(snapshot.competition_aware_coverage_pct),
        2
      ) AS average_coverage_pct,
      count(*) FILTER (
        WHERE snapshot.model_eligible
      )::integer AS model_eligible_snapshots,
      round(
        100.0 * count(*) FILTER (
          WHERE snapshot.model_eligible
        ) / NULLIF(count(*), 0),
        2
      ) AS model_eligible_pct,
      count(*) FILTER (
        WHERE snapshot.profile_key = 'unknown'
      )::integer AS unclassified_snapshots,
      count(*) FILTER (
        WHERE snapshot.leakage_status = 'blocked'
      )::integer AS leakage_blocked_snapshots
    FROM snapshots AS snapshot
  ),
  overall_summary AS (
    SELECT
      overall.*,
      CASE
        WHEN overall.snapshots = 0
          THEN 'not_materialized'
        WHEN overall.leakage_blocked_snapshots > 0
          THEN 'blocked_by_leakage'
        WHEN overall.snapshots < 20
          THEN 'insufficient_sample'
        WHEN overall.unclassified_snapshots > 0
          THEN 'review_unclassified_competitions'
        WHEN overall.model_eligible_pct < 70
          THEN 'improve_profile_coverage'
        WHEN overall.snapshots < 100
          THEN 'ready_for_100_match_canary'
        ELSE 'ready_for_feature_review'
      END AS recommendation
    FROM overall_summary_base AS overall
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(feature_set)
          ORDER BY
            feature_set.code,
            feature_set.version,
            feature_set.horizon_key
        )
        FROM feature_set_summary AS feature_set
      ),
      (
        SELECT jsonb_build_array(
          jsonb_build_object(
            'code', target.code,
            'version', target.version,
            'status', target.status,
            'is_enabled', target.is_enabled,
            'horizon_key', NULL,
            'snapshots', 0,
            'model_eligible_snapshots', 0,
            'model_eligible_pct', 0,
            'recommendation', 'not_materialized'
          )
        )
        FROM target
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(profile)
          ORDER BY
            profile.profile_key,
            profile.horizon_key
        )
        FROM profile_summary AS profile
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(reason)
          ORDER BY
            reason.profile_key,
            reason.horizon_key,
            reason.eligibility_reason
        )
        FROM reason_summary AS reason
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(component)
          ORDER BY
            component.profile_key,
            component.horizon_key,
            component.component
        )
        FROM component_summary AS component
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT to_jsonb(overall) FROM overall_summary AS overall),
      jsonb_build_object(
        'snapshots', 0,
        'average_coverage_pct', 0,
        'model_eligible_snapshots', 0,
        'model_eligible_pct', 0,
        'unclassified_snapshots', 0,
        'leakage_blocked_snapshots', 0,
        'recommendation', 'not_materialized'
      )
    )
  INTO
    stored_feature_set_report,
    stored_profile_report,
    stored_reason_report,
    stored_component_report,
    stored_overall_report;

  WITH report_rows AS (
    SELECT payload
    FROM jsonb_array_elements(
      COALESCE(base_report -> 'feature_sets', '[]'::jsonb)
    ) AS existing_row(payload)
    WHERE existing_row.payload ->> 'version' <> '1.2.0'
    UNION ALL
    SELECT payload
    FROM jsonb_array_elements(
      stored_feature_set_report
    ) AS stored_row(payload)
  )
  SELECT COALESCE(
    jsonb_agg(
      report_row.payload
      ORDER BY
        report_row.payload ->> 'code',
        report_row.payload ->> 'version',
        report_row.payload ->> 'horizon_key'
    ),
    '[]'::jsonb
  )
  INTO corrected_feature_sets
  FROM report_rows AS report_row;

  RETURN base_report || jsonb_build_object(
    'quality_contract_version', 'phase8f.3.2',
    'recommendation_source', 'stored_v120_competition_aware',
    'feature_sets', corrected_feature_sets,
    'eligibility', stored_overall_report,
    'competition_profiles', stored_profile_report,
    'profile_components', stored_component_report,
    'eligibility_reasons', stored_reason_report,
    'stored_v120', jsonb_build_object(
      'feature_sets', stored_feature_set_report,
      'overall', stored_overall_report,
      'profiles', stored_profile_report,
      'eligibility_reasons', stored_reason_report,
      'components', stored_component_report
    ),
    'projected_v120', jsonb_build_object(
      'eligibility', base_report -> 'eligibility',
      'competition_profiles', base_report -> 'competition_profiles',
      'profile_components', base_report -> 'profile_components'
    ),
    'automatic_training', false,
    'automatic_predictions', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_feature_store_report_v7(
  text,
  integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_feature_store_report_v7(
  text,
  integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_feature_store_report_v7(
  text,
  integer
) IS
  'Phase 8F.3.2 admin report using stored Football 1.2.0 competition-aware coverage, profile eligibility, reasons and component requirements.';

NOTIFY pgrst, 'reload schema';
