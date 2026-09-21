BEGIN;

DO $test$
DECLARE
  target public.hl_feature_sets%ROWTYPE;
  competition_ids jsonb;
BEGIN
  SELECT feature_set.*
  INTO target
  FROM public.hl_feature_sets AS feature_set
  JOIN public.sports AS sport
    ON sport.id = feature_set.sport_id
   AND sport.code = 'football'
  WHERE feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '2.0.0';

  IF target.id IS NULL THEN
    RAISE EXCEPTION 'feature set 2.0.0 was not registered';
  END IF;
  IF target.status IS DISTINCT FROM 'draft' OR target.is_enabled THEN
    RAISE EXCEPTION 'feature set 2.0.0 must remain draft and disabled';
  END IF;
  IF target.feature_spec ->> 'schema'
      IS DISTINCT FROM 'highlightly_football_prematch@2.0.0' THEN
    RAISE EXCEPTION 'unexpected feature schema';
  END IF;
  IF COALESCE((target.feature_spec ->> 'automatic_predictions')::boolean, true)
      OR COALESCE((target.feature_spec ->> 'automatic_training')::boolean, true)
      OR COALESCE((target.feature_spec ->> 'provider_calls')::boolean, true) THEN
    RAISE EXCEPTION 'v2 contract cannot enable side effects';
  END IF;

  competition_ids := target.feature_spec #> '{scope,competition_external_ids}';
  IF competition_ids IS NULL OR jsonb_array_length(competition_ids) <> 3 THEN
    RAISE EXCEPTION 'MVP competition scope must contain exactly three IDs';
  END IF;
  IF NOT competition_ids @> '["33973", "119924", "84182"]'::jsonb THEN
    RAISE EXCEPTION 'MVP competition scope differs from the approved IDs';
  END IF;
END
$test$;

DO $test$
DECLARE
  invalid_count integer;
BEGIN
  SELECT count(*)::integer
  INTO invalid_count
  FROM public.sports_seasons AS current_season
  CROSS JOIN LATERAL (
    SELECT public.resolve_previous_competition_season_v1(
      current_season.competition_id,
      current_season.id
    ) AS previous_season_id
  ) AS resolved
  JOIN public.sports_seasons AS previous_season
    ON previous_season.id = resolved.previous_season_id
  WHERE previous_season.id = current_season.id
     OR previous_season.competition_id <> current_season.competition_id
     OR COALESCE(previous_season.end_date, previous_season.start_date)
        >= current_season.start_date;

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'previous-season resolver violated identity/date invariants';
  END IF;
END
$test$;

DO $test$
DECLARE
  function_signature text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.resolve_previous_competition_season_v1(uuid,uuid)',
    'public.build_football_match_window_v2(uuid,timestamp with time zone,integer,uuid,text)',
    'public.build_football_h2h_window_v2(uuid,uuid,uuid,timestamp with time zone,integer)',
    'public.build_football_odds_asof_v2(uuid,timestamp with time zone)',
    'public.build_football_league_prior_v2(uuid,uuid,timestamp with time zone)',
    'public.preview_football_prematch_features_v2(uuid,text)'
  ]
  LOOP
    IF to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'required function missing: %', function_signature;
    END IF;
    IF has_function_privilege('anon', function_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'feature builder is exposed to an application role: %',
        function_signature;
    END IF;
  END LOOP;
END
$test$;

DO $test$
DECLARE
  empty_team uuid := gen_random_uuid();
  empty_match uuid := gen_random_uuid();
  cutoff timestamptz := statement_timestamp();
  team_window jsonb;
  h2h_window jsonb;
  odds_window jsonb;
BEGIN
  team_window := public.build_football_match_window_v2(
    empty_team, cutoff, 5, NULL, NULL
  );
  h2h_window := public.build_football_h2h_window_v2(
    empty_team, gen_random_uuid(), empty_match, cutoff, 20
  );
  odds_window := public.build_football_odds_asof_v2(empty_match, cutoff);

  IF (team_window ->> 'sample')::integer <> 0
     OR jsonb_array_length(team_window -> 'match_ids') <> 0 THEN
    RAISE EXCEPTION 'empty team window is not deterministic';
  END IF;
  IF (h2h_window ->> 'sample')::integer <> 0
     OR jsonb_array_length(h2h_window -> 'match_ids') <> 0 THEN
    RAISE EXCEPTION 'empty H2H window is not deterministic';
  END IF;
  IF (odds_window ->> 'quote_count')::integer <> 0
     OR (odds_window ->> 'consensus_count')::integer <> 0 THEN
    RAISE EXCEPTION 'empty odds window is not deterministic';
  END IF;
END
$test$;

DO $test$
DECLARE
  target record;
  cutoff timestamptz := statement_timestamp();
  payload jsonb;
BEGIN
  SELECT participant.team_id
  INTO target
  FROM public.sports_match_participants AS participant
  JOIN public.sports_matches AS match_row ON match_row.id = participant.match_id
  JOIN public.sports AS sport ON sport.id = match_row.sport_id
  WHERE sport.code = 'football'
  ORDER BY match_row.kickoff_at DESC NULLS LAST, match_row.id
  LIMIT 1;

  IF target.team_id IS NOT NULL THEN
    payload := public.build_football_match_window_v2(
      target.team_id, cutoff, 5, NULL, NULL
    );
    IF NULLIF(payload ->> 'source_max_at', '')::timestamptz > cutoff THEN
      RAISE EXCEPTION 'team window leaked a source after cutoff';
    END IF;
  END IF;
END
$test$;

DO $test$
DECLARE
  target_match_id uuid;
  first_payload jsonb;
  second_payload jsonb;
  cutoff timestamptz;
BEGIN
  SELECT match_row.id
  INTO target_match_id
  FROM public.sports_matches AS match_row
  JOIN public.sports_provider_entities AS competition_entity
    ON competition_entity.entity_type = 'competition'
   AND competition_entity.canonical_id = match_row.competition_id
   AND competition_entity.external_id IN ('33973', '119924', '84182')
  JOIN public.sports_providers AS provider
    ON provider.id = competition_entity.provider_id
   AND provider.code = 'highlightly'
  JOIN public.sports_match_participants AS home
    ON home.match_id = match_row.id AND home.role = 'home'
  JOIN public.sports_match_participants AS away
    ON away.match_id = match_row.id AND away.role = 'away'
  WHERE match_row.kickoff_at IS NOT NULL
    AND match_row.season_id IS NOT NULL
    AND home.team_id <> away.team_id
  ORDER BY match_row.kickoff_at DESC, match_row.id
  LIMIT 1;

  IF target_match_id IS NOT NULL THEN
    first_payload := public.preview_football_prematch_features_v2(
      target_match_id, 't24h'
    );
    second_payload := public.preview_football_prematch_features_v2(
      target_match_id, 't24h'
    );
    cutoff := (first_payload #>> '{cutoff,cutoff_at}')::timestamptz;

    IF first_payload ->> 'schema_version'
       IS DISTINCT FROM 'highlightly_football_prematch@2.0.0' THEN
      RAISE EXCEPTION 'preview returned an unexpected schema';
    END IF;
    IF first_payload ->> 'fingerprint'
       IS DISTINCT FROM second_payload ->> 'fingerprint' THEN
      RAISE EXCEPTION 'preview fingerprint is not deterministic';
    END IF;
    IF length(first_payload ->> 'fingerprint') <> 64 THEN
      RAISE EXCEPTION 'preview fingerprint is not SHA-256 shaped';
    END IF;
    IF NULLIF(first_payload #>> '{cutoff,source_max_at}', '')::timestamptz
       > cutoff THEN
      RAISE EXCEPTION 'preview leaked a source after cutoff';
    END IF;
    IF (first_payload #> '{home,recent_overall,match_ids}')
          @> jsonb_build_array(target_match_id)
       OR (first_payload #> '{away,recent_overall,match_ids}')
          @> jsonb_build_array(target_match_id)
       OR (first_payload #> '{h2h,match_ids}')
          @> jsonb_build_array(target_match_id) THEN
      RAISE EXCEPTION 'target match leaked into historical components';
    END IF;
  END IF;
END
$test$;

ROLLBACK;
