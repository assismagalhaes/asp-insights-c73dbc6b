CREATE OR REPLACE FUNCTION public.get_highlightly_odds_quality_report_v2(
  p_from timestamptz DEFAULT now(),
  p_to timestamptz DEFAULT now() + interval '24 hours'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH base_report AS (
    SELECT public.get_highlightly_odds_quality_report(p_from, p_to) AS report
  ),
  unavailable_by_sport AS (
    SELECT
      cause_item.value ->> 'sport' AS sport,
      COALESCE(sum((cause_item.value ->> 'matches')::integer)
        FILTER (
          WHERE cause_item.value ->> 'cause' = 'provider_empty'
        ), 0) AS provider_empty,
      COALESCE(sum((cause_item.value ->> 'matches')::integer)
        FILTER (
          WHERE cause_item.value ->> 'cause'
            IN ('provider_empty', 'provider_unavailable')
        ), 0) AS provider_unavailable
    FROM base_report
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(base_report.report -> 'by_cause', '[]'::jsonb)
    ) AS cause_item(value)
    GROUP BY cause_item.value ->> 'sport'
  ),
  enriched_sports AS (
    SELECT
      sport_item.value ->> 'sport' AS sport,
      sport_item.value AS sport_row,
      COALESCE((sport_item.value ->> 'matches_due')::integer, 0)
        AS matches_due,
      COALESCE((sport_item.value ->> 'matches_available')::integer, 0)
        AS matches_available,
      COALESCE(
        (sport_item.value ->> 'target_availability_pct')::numeric,
        0
      )
        AS target_availability_pct,
      COALESCE(unavailable.provider_empty, 0) AS provider_empty,
      COALESCE(unavailable.provider_unavailable, 0) AS provider_unavailable
    FROM base_report
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(base_report.report -> 'by_sport', '[]'::jsonb)
    ) AS sport_item(value)
    LEFT JOIN unavailable_by_sport AS unavailable
      ON unavailable.sport = sport_item.value ->> 'sport'
  ),
  calculated AS (
    SELECT
      enriched.*,
      GREATEST(enriched.matches_due - enriched.provider_unavailable, 0)
        AS matches_eligible,
      CASE
        WHEN enriched.matches_due = 0 THEN NULL
        ELSE round(
          100.0 * enriched.provider_empty / enriched.matches_due,
          2
        )
      END AS provider_empty_pct,
      CASE
        WHEN enriched.matches_due - enriched.provider_unavailable <= 0 THEN NULL
        ELSE round(
          100.0 * enriched.matches_available
            / (enriched.matches_due - enriched.provider_unavailable),
          2
        )
      END AS eligible_availability_pct
    FROM enriched_sports AS enriched
  ),
  replacement AS (
    SELECT COALESCE(
      jsonb_agg(
        calculated.sport_row
        || jsonb_build_object(
          'raw_availability_pct',
            calculated.sport_row -> 'availability_pct',
          'matches_provider_empty',
            calculated.provider_empty,
          'matches_provider_unavailable',
            calculated.provider_unavailable,
          'provider_empty_pct',
            calculated.provider_empty_pct,
          'matches_eligible',
            calculated.matches_eligible,
          'eligible_availability_pct',
            calculated.eligible_availability_pct,
          'gate_availability_pct',
            calculated.eligible_availability_pct,
          'gate_status',
            CASE
              WHEN calculated.matches_due = 0 THEN 'no_due_matches'
              WHEN calculated.matches_eligible = 0 THEN 'provider_unavailable'
              WHEN calculated.eligible_availability_pct
                >= calculated.target_availability_pct THEN 'ready'
              ELSE 'below_target'
            END,
          'gate_denominator',
            'provider_supported_matches'
        )
        ORDER BY calculated.sport
      ),
      '[]'::jsonb
    ) AS by_sport
    FROM calculated
  )
  SELECT jsonb_set(
    base_report.report
      || jsonb_build_object(
        'quality_contract_version', 'phase8d.1',
        'gate_denominator', 'provider_supported_matches'
      ),
    '{by_sport}',
    replacement.by_sport,
    true
  )
  FROM base_report
  CROSS JOIN replacement;
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_odds_quality_report_v2(
  timestamptz,
  timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_odds_quality_report_v2(
  timestamptz,
  timestamptz
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_highlightly_odds_quality_report_v2(
  timestamptz,
  timestamptz
) IS
  'Phase 8D.1 report preserving raw provider coverage while gating only provider-supported matches.';

NOTIFY pgrst, 'reload schema';