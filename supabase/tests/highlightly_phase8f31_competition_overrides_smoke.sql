BEGIN;

DO $overrides$
DECLARE
  matching_policies integer;
  football_id uuid;
  v120_id uuid;
  provider_enabled boolean;
BEGIN
  SELECT id INTO football_id
  FROM public.sports
  WHERE code = 'football';

  SELECT count(*)::integer INTO matching_policies
  FROM public.hl_competition_feature_policies AS policy
  JOIN public.sports_competitions AS competition
    ON competition.id = policy.competition_id
  JOIN public.sports_countries AS country
    ON country.id = competition.country_id
  WHERE policy.sport_id = football_id
    AND (
      (
        policy.competition_id =
          '55e0032f-b970-5df5-b7ac-640d0307096d'::uuid
        AND competition.name = 'MLS Next Pro'
        AND country.name = 'USA'
      )
      OR (
        policy.competition_id =
          '5d7f08ef-6b7e-56a5-82c8-d64aa3beb801'::uuid
        AND competition.name = 'Esiliiga B'
        AND country.name = 'Estonia'
      )
    )
    AND policy.profile_key = 'league'
    AND policy.standings_policy = 'required'
    AND policy.is_model_eligible
    AND policy.classification_source = 'manual'
    AND policy.confidence = 1.0000
    AND policy.evidence ->> 'manual_override_version' = 'phase8f.3.1'
    AND policy.evidence ->> 'manual_override_reason' =
      'verified_domestic_league';

  IF matching_policies <> 2 THEN
    RAISE EXCEPTION
      'Both verified competitions must have manual league overrides';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hl_competition_feature_policies
    WHERE competition_id IN (
      '55e0032f-b970-5df5-b7ac-640d0307096d'::uuid,
      '5d7f08ef-6b7e-56a5-82c8-d64aa3beb801'::uuid
    )
      AND (
        profile_key <> 'league'
        OR standings_policy <> 'required'
        OR NOT is_model_eligible
        OR classification_source <> 'manual'
      )
  ) THEN
    RAISE EXCEPTION 'Competition override invariants are invalid';
  END IF;

  SELECT feature_set.id INTO v120_id
  FROM public.hl_feature_sets AS feature_set
  WHERE feature_set.sport_id = football_id
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.2.0'
    AND feature_set.status = 'draft'
    AND NOT feature_set.is_enabled;

  IF v120_id IS NULL THEN
    RAISE EXCEPTION 'Football feature set 1.2.0 must remain draft';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.hl_match_feature_snapshots AS snapshot
    WHERE snapshot.feature_set_id = v120_id
  ) OR EXISTS (
    SELECT 1
    FROM public.hl_feature_materialization_runs AS run
    WHERE run.feature_set_id = v120_id
  ) THEN
    RAISE EXCEPTION 'Override migration must not materialize version 1.2.0';
  END IF;

  SELECT enabled INTO provider_enabled
  FROM public.sports_providers
  WHERE code = 'highlightly';
  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled at rest';
  END IF;
END
$overrides$;

DO $report$
DECLARE
  report_payload jsonb;
  competition_payload jsonb;
  verified_competitions integer := 0;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    report_payload := public.get_highlightly_feature_store_report_v6(
      'football',
      365
    );

    FOR competition_payload IN
      SELECT value
      FROM jsonb_array_elements(
        report_payload -> 'competition_eligibility'
      )
      WHERE value ->> 'competition_id' IN (
        '55e0032f-b970-5df5-b7ac-640d0307096d',
        '5d7f08ef-6b7e-56a5-82c8-d64aa3beb801'
      )
    LOOP
      verified_competitions := verified_competitions + 1;
      IF competition_payload ->> 'profile_key' <> 'league'
         OR competition_payload ->> 'standings_policy' <> 'required'
         OR (
           competition_payload ->> 'model_eligible_snapshots'
         )::integer <> (
           competition_payload ->> 'snapshots'
         )::integer THEN
        RAISE EXCEPTION
          'Verified competition must project as an eligible league: %',
          competition_payload;
      END IF;
    END LOOP;

    IF verified_competitions <> 2 THEN
      RAISE EXCEPTION
        'Expected both verified competitions in the v6 projection, found %',
        verified_competitions;
    END IF;

    IF (
      report_payload #>> '{eligibility,leakage_blocked_snapshots}'
    )::integer <> 0 THEN
      RAISE EXCEPTION 'Override validation must remain leakage clean';
    END IF;
  END IF;
END
$report$;

ROLLBACK;
