DO $competition_overrides$
DECLARE
  updated_count integer;
BEGIN
  IF to_regclass('public.hl_competition_feature_policies') IS NULL THEN
    RAISE EXCEPTION
      'Phase 8F.3 competition policy table must exist before overrides';
  END IF;

  WITH overrides (
    competition_id,
    expected_name,
    expected_country
  ) AS (
    VALUES
      (
        '55e0032f-b970-5df5-b7ac-640d0307096d'::uuid,
        'MLS Next Pro'::text,
        'USA'::text
      ),
      (
        '5d7f08ef-6b7e-56a5-82c8-d64aa3beb801'::uuid,
        'Esiliiga B'::text,
        'Estonia'::text
      )
  )
  UPDATE public.hl_competition_feature_policies AS policy
  SET
    profile_key = 'league',
    standings_policy = 'required',
    is_model_eligible = true,
    classification_source = 'manual',
    confidence = 1.0000,
    evidence = COALESCE(policy.evidence, '{}'::jsonb)
      || jsonb_build_object(
        'manual_override_version',
        'phase8f.3.1',
        'manual_override_reason',
        'verified_domestic_league',
        'manual_override_source',
        'phase8f3_v6_canary_review',
        'manual_override_competition_name',
        override_row.expected_name
      ),
    updated_at = now()
  FROM overrides AS override_row
  JOIN public.sports_competitions AS competition
    ON competition.id = override_row.competition_id
   AND competition.name = override_row.expected_name
  JOIN public.sports AS sport
    ON sport.id = competition.sport_id
   AND sport.code = 'football'
  JOIN public.sports_countries AS country
    ON country.id = competition.country_id
   AND country.name = override_row.expected_country
  WHERE policy.competition_id = override_row.competition_id
    AND policy.sport_id = sport.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 verified Football competition overrides, updated %',
      updated_count;
  END IF;
END
$competition_overrides$;

COMMENT ON TABLE public.hl_competition_feature_policies IS
  'Phase 8F.3 auditable competition profiles. Unknown competitions fail closed; manual overrides take precedence and are preserved by automatic reclassification.';