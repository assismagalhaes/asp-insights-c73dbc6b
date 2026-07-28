CREATE OR REPLACE FUNCTION public.get_highlightly_feature_store_report_v3(
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
  component_report jsonb;
BEGIN
  base_report := public.get_highlightly_feature_store_report_v2(
    p_sport,
    p_days
  );

  WITH target AS (
    SELECT
      feature_set.id,
      feature_set.code,
      feature_set.version
    FROM public.hl_feature_sets AS feature_set
    JOIN public.sports AS sport ON sport.id = feature_set.sport_id
    WHERE sport.code = p_sport
  ),
  snapshots AS (
    SELECT
      snapshot.quality,
      snapshot.horizon_key,
      target.code,
      target.version
    FROM target
    JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.feature_set_id = target.id
    WHERE snapshot.kickoff_at
      >= statement_timestamp() - make_interval(days => p_days)
  ),
  component_rows AS (
    SELECT
      snapshot.code,
      snapshot.version,
      snapshot.horizon_key,
      component_value.component_key,
      component_value.available
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
  component_summary AS (
    SELECT
      component_row.code,
      component_row.version,
      component_row.horizon_key,
      component_row.component_key AS component,
      count(*)::integer AS snapshots,
      count(*) FILTER (
        WHERE component_row.available
      )::integer AS available_snapshots,
      count(*) FILTER (
        WHERE NOT component_row.available
      )::integer AS missing_snapshots,
      round(
        100.0 * count(*) FILTER (WHERE component_row.available)
          / NULLIF(count(*), 0),
        2
      ) AS availability_pct,
      CASE
        WHEN count(*) < 20 THEN 'insufficient_sample'
        WHEN 100.0 * count(*) FILTER (WHERE component_row.available)
          / NULLIF(count(*), 0) < 50 THEN 'critical_gap'
        WHEN 100.0 * count(*) FILTER (WHERE component_row.available)
          / NULLIF(count(*), 0) < 70 THEN 'coverage_gap'
        ELSE 'acceptable'
      END AS status
    FROM component_rows AS component_row
    GROUP BY
      component_row.code,
      component_row.version,
      component_row.horizon_key,
      component_row.component_key
  )
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(component_summary)
      ORDER BY
        component_summary.code,
        component_summary.version,
        component_summary.horizon_key,
        component_summary.component
    ),
    '[]'::jsonb
  )
  INTO component_report
  FROM component_summary;

  RETURN jsonb_set(
    jsonb_set(
      base_report,
      '{components}',
      component_report,
      true
    ),
    '{quality_contract_version}',
    '"phase8f.1.1"'::jsonb,
    true
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_feature_store_report_v3(
  text,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_feature_store_report_v3(
  text,
  integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_feature_store_report_v3(
  text,
  integer
) IS
  'Phase 8F.1.1 report with structured component coverage records; read-only and admin-gated through v2.';

NOTIFY pgrst, 'reload schema';
