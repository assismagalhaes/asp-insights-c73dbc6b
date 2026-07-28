CREATE OR REPLACE FUNCTION public.get_highlightly_feature_store_report_v5(
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
  phase8f11_report jsonb;
  component_report jsonb;
BEGIN
  base_report := public.get_highlightly_feature_store_report_v4(
    p_sport,
    p_days
  );
  phase8f11_report := public.get_highlightly_feature_store_report_v3(
    p_sport,
    p_days
  );

  WITH component_source AS (
    SELECT component_value.payload
    FROM jsonb_array_elements(
      COALESCE(phase8f11_report -> 'components', '[]'::jsonb)
    ) AS component_value(payload)
    WHERE jsonb_typeof(component_value.payload) = 'object'
  ),
  component_enriched AS (
    SELECT
      component_source.payload || jsonb_build_object(
        'requirement',
        CASE
          WHEN CASE component_source.payload ->> 'horizon_key'
            WHEN 't24h' THEN component_source.payload ->> 'component' IN (
              'home_history',
              'away_history',
              'home_standings',
              'away_standings'
            )
            WHEN 't6h' THEN component_source.payload ->> 'component'
              <> 'lineups'
            WHEN 't60m' THEN true
            ELSE false
          END THEN 'required'
          ELSE 'optional'
        END,
        'required_for_horizon',
        CASE component_source.payload ->> 'horizon_key'
          WHEN 't24h' THEN component_source.payload ->> 'component' IN (
            'home_history',
            'away_history',
            'home_standings',
            'away_standings'
          )
          WHEN 't6h' THEN component_source.payload ->> 'component'
            <> 'lineups'
          WHEN 't60m' THEN true
          ELSE false
        END,
        'status',
        CASE
          WHEN CASE component_source.payload ->> 'horizon_key'
            WHEN 't24h' THEN component_source.payload ->> 'component' IN (
              'home_history',
              'away_history',
              'home_standings',
              'away_standings'
            )
            WHEN 't6h' THEN component_source.payload ->> 'component'
              <> 'lineups'
            WHEN 't60m' THEN true
            ELSE false
          END THEN component_source.payload ->> 'status'
          ELSE 'optional'
        END
      ) AS payload
    FROM component_source
  )
  SELECT COALESCE(
    jsonb_agg(
      component_enriched.payload
      ORDER BY
        component_enriched.payload ->> 'code',
        component_enriched.payload ->> 'version',
        component_enriched.payload ->> 'horizon_key',
        component_enriched.payload ->> 'component'
    ),
    '[]'::jsonb
  )
  INTO component_report
  FROM component_enriched;

  RETURN base_report || jsonb_build_object(
    'components', component_report,
    'quality_contract_version', 'phase8f.2.1'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_feature_store_report_v5(
  text,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_feature_store_report_v5(
  text,
  integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_feature_store_report_v5(
  text,
  integer
) IS
  'Phase 8F.2.1 report preserving structured component records and adding horizon requirement semantics.';

NOTIFY pgrst, 'reload schema';