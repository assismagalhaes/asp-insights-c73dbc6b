CREATE OR REPLACE FUNCTION public.get_highlightly_feature_store_report_v2(
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
  result jsonb;
BEGIN
  IF p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'feature report days must be between 1 and 365'
      USING ERRCODE = '22023';
  END IF;
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (
       SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'Highlightly feature report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH target AS (
    SELECT
      feature_set.id,
      feature_set.code,
      feature_set.version,
      feature_set.status,
      feature_set.is_enabled
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
      target.is_enabled,
      match_row.competition_id,
      competition.name AS competition_name,
      country.name AS country_name
    FROM target
    JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.feature_set_id = target.id
    JOIN public.sports_matches AS match_row
      ON match_row.id = snapshot.match_id
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN public.sports_countries AS country
      ON country.id = competition.country_id
    WHERE snapshot.kickoff_at
      >= statement_timestamp() - make_interval(days => p_days)
  ),
  feature_set_summary AS (
    SELECT
      snapshot.code,
      snapshot.version,
      snapshot.feature_set_status AS status,
      snapshot.is_enabled,
      snapshot.horizon_key,
      count(*)::integer AS snapshots,
      round(avg(snapshot.coverage_pct), 2) AS average_coverage_pct,
      round(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY snapshot.coverage_pct
        )::numeric,
        2
      ) AS median_coverage_pct,
      min(snapshot.coverage_pct) AS minimum_coverage_pct,
      max(snapshot.coverage_pct) AS maximum_coverage_pct,
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
      max(snapshot.kickoff_at) AS last_kickoff_at,
      min(snapshot.generated_at) AS first_generated_at,
      max(snapshot.generated_at) AS last_generated_at
    FROM snapshots AS snapshot
    GROUP BY
      snapshot.code,
      snapshot.version,
      snapshot.feature_set_status,
      snapshot.is_enabled,
      snapshot.horizon_key
  ),
  feature_set_scored AS (
    SELECT
      summary.*,
      CASE
        WHEN summary.blocked_snapshots > 0 THEN 'blocked_by_leakage'
        WHEN summary.snapshots < 20 THEN 'insufficient_sample'
        WHEN summary.average_coverage_pct < 70
          THEN 'improve_component_coverage'
        WHEN summary.snapshots < 100 THEN 'ready_for_100_match_canary'
        ELSE 'ready_for_feature_review'
      END AS recommendation
    FROM feature_set_summary AS summary
  ),
  component_rows AS (
    SELECT
      snapshot.code,
      snapshot.version,
      snapshot.horizon_key,
      component.component,
      component.available
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
    ) AS component(component, available)
  ),
  component_summary AS (
    SELECT
      component.code,
      component.version,
      component.horizon_key,
      component.component,
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
      component.component
  ),
  league_summary AS (
    SELECT
      snapshot.code,
      snapshot.version,
      snapshot.horizon_key,
      snapshot.competition_id,
      COALESCE(snapshot.country_name, 'País não informado') AS country_name,
      COALESCE(snapshot.competition_name, 'Liga não informada')
        AS competition_name,
      count(*)::integer AS snapshots,
      round(avg(snapshot.coverage_pct), 2) AS average_coverage_pct,
      count(*) FILTER (
        WHERE snapshot.leakage_status = 'clean'
      )::integer AS clean_snapshots,
      count(*) FILTER (
        WHERE snapshot.leakage_status = 'blocked'
      )::integer AS blocked_snapshots,
      CASE
        WHEN count(*) FILTER (
          WHERE snapshot.leakage_status = 'blocked'
        ) > 0 THEN 'blocked_by_leakage'
        WHEN count(*) < 20 THEN 'insufficient_sample'
        WHEN avg(snapshot.coverage_pct) < 70
          THEN 'improve_component_coverage'
        ELSE 'eligible_for_expansion'
      END AS recommendation
    FROM snapshots AS snapshot
    GROUP BY
      snapshot.code,
      snapshot.version,
      snapshot.horizon_key,
      snapshot.competition_id,
      snapshot.country_name,
      snapshot.competition_name
  ),
  integrity AS (
    SELECT
      count(*) FILTER (
        WHERE snapshot.cutoff_at >= snapshot.kickoff_at
      )::integer AS invalid_cutoffs,
      count(*) FILTER (
        WHERE COALESCE(
          snapshot.lineage ->> 'target_match_facts_used',
          'missing'
        ) <> 'false'
      )::integer AS target_fact_violations,
      count(*) FILTER (
        WHERE NULLIF(
          snapshot.lineage ->> 'home_source_max_at',
          ''
        )::timestamptz > snapshot.cutoff_at
        OR NULLIF(
          snapshot.lineage ->> 'away_source_max_at',
          ''
        )::timestamptz > snapshot.cutoff_at
        OR NULLIF(
          snapshot.lineage ->> 'odds_source_max_at',
          ''
        )::timestamptz > snapshot.cutoff_at
        OR NULLIF(
          snapshot.lineage ->> 'lineup_source_max_at',
          ''
        )::timestamptz > snapshot.cutoff_at
      )::integer AS source_after_cutoff_violations,
      (
        SELECT count(*)::integer
        FROM (
          SELECT
            duplicate.feature_set_id,
            duplicate.match_id,
            duplicate.horizon_key,
            duplicate.cutoff_at
          FROM public.hl_match_feature_snapshots AS duplicate
          JOIN target AS duplicate_target
            ON duplicate_target.id = duplicate.feature_set_id
          GROUP BY
            duplicate.feature_set_id,
            duplicate.match_id,
            duplicate.horizon_key,
            duplicate.cutoff_at
          HAVING count(*) > 1
        ) AS duplicate_key
      ) AS duplicate_snapshot_keys
    FROM snapshots AS snapshot
  ),
  label_summary AS (
    SELECT
      count(DISTINCT label.id)::integer AS labels,
      count(DISTINCT label.id) FILTER (
        WHERE label.quality_status = 'valid'
      )::integer AS valid_labels,
      count(DISTINCT label.id) FILTER (
        WHERE label.quality_status <> 'valid'
      )::integer AS invalid_labels
    FROM snapshots AS snapshot
    LEFT JOIN public.hl_match_labels AS label
      ON label.match_id = snapshot.match_id
  )
  SELECT jsonb_build_object(
    'generated_at', statement_timestamp(),
    'sport', p_sport,
    'window_days', p_days,
    'grain', 'feature_set_version_horizon_match_cutoff',
    'thresholds', jsonb_build_object(
      'minimum_canary_snapshots', 20,
      'expansion_canary_snapshots', 100,
      'target_average_coverage_pct', 70,
      'minimum_component_coverage_pct', 50,
      'maximum_blocked_snapshots', 0
    ),
    'automatic_training', false,
    'automatic_predictions', false,
    'feature_sets', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(scored)
          ORDER BY scored.code, scored.version, scored.horizon_key
        )
        FROM feature_set_scored AS scored
      ),
      '[]'::jsonb
    ),
    'components', COALESCE(
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
    ),
    'leagues', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(league)
          ORDER BY
            league.snapshots DESC,
            league.country_name,
            league.competition_name
        )
        FROM league_summary AS league
      ),
      '[]'::jsonb
    ),
    'integrity', COALESCE(
      (SELECT to_jsonb(integrity) FROM integrity),
      jsonb_build_object(
        'invalid_cutoffs', 0,
        'target_fact_violations', 0,
        'source_after_cutoff_violations', 0,
        'duplicate_snapshot_keys', 0
      )
    ),
    'labels', COALESCE(
      (SELECT to_jsonb(labels) FROM label_summary AS labels),
      jsonb_build_object(
        'labels', 0,
        'valid_labels', 0,
        'invalid_labels', 0
      )
    )
  )
  INTO result;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_feature_store_report_v2(
  text,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_feature_store_report_v2(
  text,
  integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_feature_store_report_v2(
  text,
  integer
) IS
  'Phase 8F.1 admin report for component, league, integrity and label coverage; read-only and advisory.';

NOTIFY pgrst, 'reload schema';