-- Fase 3 / F3-032, F3-033 and F3-034 preparation.
-- Gated, stored-data-only first-canary builder for Premier League + La Liga.
-- The function cannot bypass the certified Phase 2 gate and triggers no model.

CREATE OR REPLACE FUNCTION public.build_football_mvp_pl_laliga_canary_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  target_spec public.hl_training_dataset_specs%ROWTYPE;
  provider_enabled boolean;
  gate jsonb;
  target_run_id uuid;
  candidate record;
  feature_payload jsonb;
  considered_count integer := 0;
  eligible_count integer := 0;
  inserted_count integer := 0;
  snapshot_inserted_count integer := 0;
  blocked_count integer := 0;
  split_summary jsonb := '{}'::jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'dataset build window must satisfy p_from < p_to'
      USING ERRCODE = '22023';
  END IF;
  IF p_to > p_from + interval '3650 days' THEN
    RAISE EXCEPTION 'dataset build window must not exceed 3650 days'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'dataset build limit must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  -- One immutable canary build at a time, without a lock table.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('football_mvp_pl_laliga_canary_v1')
  ) THEN
    RAISE EXCEPTION 'another football MVP canary build is running'
      USING ERRCODE = '55P03';
  END IF;

  SELECT provider.enabled
  INTO provider_enabled
  FROM public.sports_providers AS provider
  WHERE provider.code = 'highlightly';

  IF provider_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Highlightly provider must be disabled before dataset build'
      USING ERRCODE = '55000';
  END IF;

  SELECT dataset_spec.*
  INTO target_spec
  FROM public.hl_training_dataset_specs AS dataset_spec
  JOIN public.sports AS sport
    ON sport.id = dataset_spec.sport_id
   AND sport.code = 'football'
  JOIN public.hl_feature_sets AS feature_set
    ON feature_set.id = dataset_spec.feature_set_id
   AND feature_set.code = 'highlightly_football_prematch'
   AND feature_set.version = '2.0.0'
   AND feature_set.status = 'draft'
   AND NOT feature_set.is_enabled
  JOIN public.hl_label_sets AS label_set
    ON label_set.id = dataset_spec.label_set_id
   AND label_set.code = 'highlightly_football_postmatch_mvp'
   AND label_set.version = '2.0.0'
   AND label_set.status = 'draft'
   AND NOT label_set.is_enabled
  WHERE dataset_spec.code = 'football_mvp_pl_laliga_canary'
    AND dataset_spec.version = '1.0.0'
  LIMIT 1;

  IF target_spec.id IS NULL
     OR target_spec.status <> 'draft'
     OR target_spec.is_enabled THEN
    RAISE EXCEPTION 'PL + La Liga canary spec must be draft and disabled'
      USING ERRCODE = '55000';
  END IF;
  IF target_spec.quality_contract #>> '{phase2_gate_required,required_status}'
       <> 'ready'
     OR COALESCE(
       (target_spec.quality_contract #>>
         '{phase2_gate_required,bypass_allowed}')::boolean,
       true
     ) THEN
    RAISE EXCEPTION 'dataset spec must require a ready gate with no bypass'
      USING ERRCODE = '55000';
  END IF;
  IF target_spec.quality_contract -> 'competition_external_ids'
       <> jsonb_build_array('33973', '119924')
     OR target_spec.quality_contract -> 'eligible_dataset_states'
       <> jsonb_build_array('READY')
     OR COALESCE(
       (target_spec.quality_contract ->> 'degraded_rows_allowed')::boolean,
       true
     ) THEN
    RAISE EXCEPTION 'dataset spec scope or eligibility contract drifted'
      USING ERRCODE = '55000';
  END IF;

  gate := public.get_highlightly_football_canary_gate_v1(
    14, 95, 90, 3600, 5
  );
  IF gate ->> 'gate_status' <> 'ready' THEN
    RAISE EXCEPTION 'Phase 2 gate is %, required ready',
      COALESCE(gate ->> 'gate_status', 'missing')
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.hl_training_dataset_build_runs (
    dataset_spec_id,
    sport_id,
    window_from,
    window_to,
    sample_limit,
    diagnostics
  )
  VALUES (
    target_spec.id,
    target_spec.sport_id,
    p_from,
    p_to,
    p_limit,
    jsonb_build_object(
      'phase', '3',
      'contract_version', 'football_mvp_pl_laliga_canary_builder@1.0.0',
      'generation_mode', 'manual_gated_canary',
      'gate_snapshot', gate,
      'feature_set', 'highlightly_football_prematch@2.0.0',
      'label_version', target_spec.label_version,
      'competition_external_ids', jsonb_build_array('33973', '119924'),
      'eligible_dataset_states', jsonb_build_array('READY'),
      'provider_calls', 0,
      'automatic_training', false,
      'automatic_predictions', false
    )
  )
  RETURNING id INTO target_run_id;

  -- Persist only snapshots that independently evaluate as READY and already
  -- have a valid 19-outcome label. The preview performs no provider calls.
  FOR candidate IN
    SELECT scoped.*
    FROM (
    SELECT DISTINCT ON (match_row.id)
      match_row.id AS match_id,
      match_row.kickoff_at,
      provider_entity.external_id AS competition_external_id,
      competition.name AS competition_name,
      label.id AS label_id
    FROM public.sports_matches AS match_row
    JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.entity_type = 'competition'
     AND provider_entity.canonical_id = competition.id
    JOIN public.sports_providers AS provider
      ON provider.id = provider_entity.provider_id
     AND provider.code = 'highlightly'
    LEFT JOIN public.hl_match_labels AS label
      ON label.match_id = match_row.id
     AND label.label_set_id = target_spec.label_set_id
     AND label.label_version = target_spec.label_version
     AND label.quality_status = 'valid'
     AND jsonb_typeof(label.labels -> 'values') = 'array'
     AND jsonb_array_length(label.labels -> 'values') = 19
    WHERE match_row.sport_id = target_spec.sport_id
      AND match_row.kickoff_at >= p_from
      AND match_row.kickoff_at < p_to
      AND match_row.status = 'finished'
      AND provider_entity.external_id IN ('33973', '119924')
    ORDER BY match_row.id, provider_entity.last_seen_at DESC
    ) AS scoped
    ORDER BY scoped.kickoff_at, scoped.match_id
    LIMIT p_limit
  LOOP
    considered_count := considered_count + 1;
    feature_payload := public.preview_football_prematch_features_v2(
      candidate.match_id,
      target_spec.horizon_key
    );

    IF feature_payload #>> '{quality,match_state}' = 'READY'
       AND candidate.label_id IS NOT NULL
       AND NULLIF(feature_payload #>> '{cutoff,source_max_at}', '')::timestamptz
             <= (feature_payload #>> '{cutoff,cutoff_at}')::timestamptz
       AND (feature_payload #>> '{cutoff,cutoff_at}')::timestamptz
             < candidate.kickoff_at THEN
      eligible_count := eligible_count + 1;

      INSERT INTO public.hl_match_feature_snapshots (
        feature_set_id,
        match_id,
        horizon_key,
        cutoff_at,
        kickoff_at,
        features,
        lineage,
        quality,
        coverage_pct,
        leakage_status
      )
      VALUES (
        target_spec.feature_set_id,
        candidate.match_id,
        target_spec.horizon_key,
        (feature_payload #>> '{cutoff,cutoff_at}')::timestamptz,
        candidate.kickoff_at,
        feature_payload - 'lineage' - 'quality' - 'fingerprint',
        COALESCE(feature_payload -> 'lineage', '{}'::jsonb)
          || jsonb_build_object(
            'feature_fingerprint', feature_payload ->> 'fingerprint',
            'target_match_facts_used', false,
            'provider_calls', 0,
            'builder_contract',
              'football_mvp_pl_laliga_canary_builder@1.0.0'
          ),
        COALESCE(feature_payload -> 'quality', '{}'::jsonb)
          || jsonb_build_object(
            'model_eligible', true,
            'competition_profile',
              'highlightly:' || candidate.competition_external_id
          ),
        100,
        'clean'
      )
      ON CONFLICT (feature_set_id, match_id, horizon_key, cutoff_at)
        DO NOTHING;

      IF FOUND THEN
        snapshot_inserted_count := snapshot_inserted_count + 1;
      END IF;
    END IF;
  END LOOP;

  blocked_count := greatest(considered_count - eligible_count, 0);

  WITH distinct_candidates AS (
    SELECT DISTINCT ON (match_row.id)
      match_row.id AS match_id,
      match_row.kickoff_at,
      provider_entity.external_id AS competition_external_id,
      snapshot.id AS feature_snapshot_id,
      snapshot.cutoff_at,
      snapshot.coverage_pct,
      label.id AS label_id,
      label.outcome_at
    FROM public.sports_matches AS match_row
    JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.entity_type = 'competition'
     AND provider_entity.canonical_id = competition.id
    JOIN public.sports_providers AS provider
      ON provider.id = provider_entity.provider_id
     AND provider.code = 'highlightly'
    JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.feature_set_id = target_spec.feature_set_id
     AND snapshot.match_id = match_row.id
     AND snapshot.horizon_key = target_spec.horizon_key
     AND snapshot.kickoff_at = match_row.kickoff_at
     AND snapshot.leakage_status = 'clean'
     AND snapshot.quality ->> 'match_state' = 'READY'
     AND COALESCE((snapshot.quality ->> 'model_eligible')::boolean, false)
    JOIN public.hl_match_labels AS label
      ON label.match_id = match_row.id
     AND label.label_set_id = target_spec.label_set_id
     AND label.label_version = target_spec.label_version
     AND label.quality_status = 'valid'
     AND jsonb_typeof(label.labels -> 'values') = 'array'
     AND jsonb_array_length(label.labels -> 'values') = 19
    WHERE match_row.sport_id = target_spec.sport_id
      AND match_row.kickoff_at >= p_from
      AND match_row.kickoff_at < p_to
      AND match_row.status = 'finished'
      AND provider_entity.external_id IN ('33973', '119924')
      AND snapshot.coverage_pct >= target_spec.minimum_coverage_pct
      AND snapshot.cutoff_at < match_row.kickoff_at
      AND label.outcome_at >= match_row.kickoff_at
    ORDER BY match_row.id, provider_entity.last_seen_at DESC
  ), candidates AS (
    SELECT * FROM distinct_candidates
    ORDER BY kickoff_at, match_id
    LIMIT p_limit
  ), ordered AS (
    SELECT candidates.*,
      row_number() OVER (ORDER BY kickoff_at, match_id) AS row_position,
      count(*) OVER () AS total_rows
    FROM candidates
  ), inserted AS (
    INSERT INTO public.hl_training_dataset_rows (
      build_run_id,
      dataset_spec_id,
      match_id,
      feature_snapshot_id,
      label_id,
      split_key,
      horizon_key,
      feature_cutoff_at,
      kickoff_at,
      outcome_at,
      feature_coverage_pct,
      competition_profile,
      row_fingerprint
    )
    SELECT
      target_run_id,
      target_spec.id,
      ordered.match_id,
      ordered.feature_snapshot_id,
      ordered.label_id,
      CASE
        WHEN (ordered.row_position - 1)::numeric
               / NULLIF(ordered.total_rows, 0) < 0.70 THEN 'train'
        WHEN (ordered.row_position - 1)::numeric
               / NULLIF(ordered.total_rows, 0) < 0.85 THEN 'validation'
        ELSE 'test'
      END,
      target_spec.horizon_key,
      ordered.cutoff_at,
      ordered.kickoff_at,
      ordered.outcome_at,
      ordered.coverage_pct,
      'highlightly:' || ordered.competition_external_id,
      md5(
        target_spec.id::text || ':'
        || ordered.feature_snapshot_id::text || ':'
        || ordered.label_id::text
      )
    FROM ordered
    RETURNING split_key
  )
  SELECT COALESCE(sum(rows), 0)::integer,
    COALESCE(jsonb_object_agg(split_key, rows), '{}'::jsonb)
  INTO inserted_count, split_summary
  FROM (
    SELECT split_key, count(*)::integer AS rows
    FROM inserted
    GROUP BY split_key
  ) AS split_rows;

  UPDATE public.hl_training_dataset_build_runs AS run
  SET status = CASE
        WHEN blocked_count > 0 THEN 'completed_with_exceptions'
        ELSE 'completed'
      END,
      matches_considered = considered_count,
      rows_eligible = eligible_count,
      rows_inserted = inserted_count,
      rows_blocked = blocked_count,
      provider_calls = 0,
      finished_at = statement_timestamp(),
      diagnostics = run.diagnostics || jsonb_build_object(
        'snapshots_inserted', snapshot_inserted_count,
        'rows_inserted', inserted_count,
        'rows_blocked', blocked_count,
        'splits', split_summary,
        'same_match_single_split', true,
        'temporal_ordering', jsonb_build_array('kickoff_at', 'match_id')
      )
  WHERE run.id = target_run_id;

  RETURN jsonb_build_object(
    'contract_version', 'football_mvp_pl_laliga_canary_builder@1.0.0',
    'build_run_id', target_run_id,
    'gate_status', gate ->> 'gate_status',
    'matches_considered', considered_count,
    'rows_eligible', eligible_count,
    'rows_inserted', inserted_count,
    'rows_blocked', blocked_count,
    'snapshots_inserted', snapshot_inserted_count,
    'splits', split_summary,
    'provider_calls', 0,
    'automatic_training', false,
    'automatic_predictions', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.build_football_mvp_pl_laliga_canary_v1(
  timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_football_mvp_pl_laliga_canary_v1(
  timestamptz, timestamptz, integer
) TO service_role;

COMMENT ON FUNCTION public.build_football_mvp_pl_laliga_canary_v1(
  timestamptz, timestamptz, integer
) IS 'Manual stored-data-only PL + La Liga dataset builder. Refuses execution unless the Phase 2 14-day gate is ready.';

CREATE OR REPLACE FUNCTION public.get_football_mvp_pl_laliga_canary_report_v1(
  p_build_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH target AS (
    SELECT dataset_spec.*
    FROM public.hl_training_dataset_specs AS dataset_spec
    JOIN public.sports AS sport
      ON sport.id = dataset_spec.sport_id
     AND sport.code = 'football'
    WHERE dataset_spec.code = 'football_mvp_pl_laliga_canary'
      AND dataset_spec.version = '1.0.0'
    LIMIT 1
  ), selected_run AS (
    SELECT run.*
    FROM target
    JOIN public.hl_training_dataset_build_runs AS run
      ON run.dataset_spec_id = target.id
    WHERE p_build_run_id IS NULL OR run.id = p_build_run_id
    ORDER BY run.started_at DESC, run.id DESC
    LIMIT 1
  ), rows AS (
    SELECT dataset_row.*, match_row.competition_id, match_row.season_id,
      snapshot.features, snapshot.quality, snapshot.lineage,
      label.labels AS label_payload,
      provider_entity.external_id AS competition_external_id,
      competition.name AS competition_name,
      season.label AS season_label
    FROM selected_run
    JOIN public.hl_training_dataset_rows AS dataset_row
      ON dataset_row.build_run_id = selected_run.id
    JOIN public.sports_matches AS match_row
      ON match_row.id = dataset_row.match_id
    JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.id = dataset_row.feature_snapshot_id
    JOIN public.hl_match_labels AS label
      ON label.id = dataset_row.label_id
    JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.entity_type = 'competition'
     AND provider_entity.canonical_id = competition.id
    JOIN public.sports_providers AS provider
      ON provider.id = provider_entity.provider_id
     AND provider.code = 'highlightly'
    LEFT JOIN public.sports_seasons AS season
      ON season.id = match_row.season_id
    WHERE provider_entity.external_id IN ('33973', '119924')
  ), split_coverage AS (
    SELECT split_key, count(*)::integer AS rows,
      min(kickoff_at) AS first_kickoff_at,
      max(kickoff_at) AS last_kickoff_at
    FROM rows GROUP BY split_key
  ), league_coverage AS (
    SELECT competition_external_id, competition_name,
      count(*)::integer AS rows,
      round(avg(feature_coverage_pct), 2) AS average_feature_coverage_pct,
      count(*) FILTER (WHERE split_key = 'train')::integer AS train_rows,
      count(*) FILTER (WHERE split_key = 'validation')::integer AS validation_rows,
      count(*) FILTER (WHERE split_key = 'test')::integer AS test_rows
    FROM rows GROUP BY competition_external_id, competition_name
  ), season_coverage AS (
    SELECT competition_external_id, competition_name, season_id,
      COALESCE(season_label, 'unknown') AS season_label,
      count(*)::integer AS rows
    FROM rows
    GROUP BY competition_external_id, competition_name, season_id, season_label
  ), market_coverage AS (
    SELECT quote ->> 'market_family' AS market_family,
      quote ->> 'line_key' AS line_key,
      count(DISTINCT rows.match_id)::integer AS matches_with_quotes,
      count(*)::integer AS bookmaker_quotes,
      round(100.0 * count(DISTINCT rows.match_id)
        / NULLIF((SELECT count(*) FROM rows), 0), 2) AS match_coverage_pct
    FROM rows
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(rows.features #> '{markets,quotes}', '[]'::jsonb)
    ) AS quotes(quote)
    GROUP BY quote ->> 'market_family', quote ->> 'line_key'
  ), feature_components AS (
    SELECT component_name,
      count(*) FILTER (WHERE available)::integer AS rows_available,
      count(*)::integer AS total_rows,
      round(100.0 * count(*) FILTER (WHERE available)
        / NULLIF(count(*), 0), 2) AS coverage_pct
    FROM rows
    CROSS JOIN LATERAL (VALUES
      ('home_current_season',
        COALESCE((features #>> '{home,current_season,sample}')::integer, 0) > 0),
      ('away_current_season',
        COALESCE((features #>> '{away,current_season,sample}')::integer, 0) > 0),
      ('home_previous_season',
        COALESCE((features #>> '{home,previous_season,sample}')::integer, 0) > 0),
      ('away_previous_season',
        COALESCE((features #>> '{away,previous_season,sample}')::integer, 0) > 0),
      ('home_recent_5',
        COALESCE((features #>> '{home,recent_overall,sample}')::integer, 0) >= 5),
      ('away_recent_5',
        COALESCE((features #>> '{away,recent_overall,sample}')::integer, 0) >= 5),
      ('home_venue_5',
        COALESCE((features #>> '{home,recent_venue,sample}')::integer, 0) >= 5),
      ('away_venue_5',
        COALESCE((features #>> '{away,recent_venue,sample}')::integer, 0) >= 5),
      ('home_standings', features #> '{home,standings}' IS NOT NULL
        AND features #> '{home,standings}' <> 'null'::jsonb),
      ('away_standings', features #> '{away,standings}' IS NOT NULL
        AND features #> '{away,standings}' <> 'null'::jsonb),
      ('h2h_prior', COALESCE((features #>> '{h2h,sample}')::integer, 0) > 0),
      ('league_prior',
        COALESCE((features #>> '{league_prior,sample}')::integer, 0) > 0),
      ('prematch_odds',
        COALESCE((features #>> '{markets,quote_count}')::integer, 0) > 0)
    ) AS components(component_name, available)
    GROUP BY component_name
  ), integrity AS (
    SELECT
      count(*) FILTER (
        WHERE feature_cutoff_at >= kickoff_at OR kickoff_at > outcome_at
      )::integer AS temporal_violations,
      count(*) - count(DISTINCT match_id) AS duplicate_match_rows,
      count(*) FILTER (
        WHERE competition_external_id NOT IN ('33973', '119924')
      )::integer AS competition_scope_violations,
      count(*) FILTER (
        WHERE quality ->> 'match_state' <> 'READY'
          OR COALESCE((quality ->> 'model_eligible')::boolean, false)
            IS DISTINCT FROM true
      )::integer AS readiness_violations,
      count(*) FILTER (
        WHERE COALESCE((lineage ->> 'target_match_facts_used')::boolean, true)
          OR NULLIF(lineage ->> 'source_max_at', '')::timestamptz
               > feature_cutoff_at
      )::integer AS lineage_violations
    FROM rows
  ), split_integrity AS (
    SELECT CASE
      WHEN (SELECT max(kickoff_at) FROM rows WHERE split_key = 'train')
             > (SELECT min(kickoff_at) FROM rows WHERE split_key = 'validation')
        OR (SELECT max(kickoff_at) FROM rows WHERE split_key = 'validation')
             > (SELECT min(kickoff_at) FROM rows WHERE split_key = 'test')
      THEN 1 ELSE 0 END AS temporal_split_violations
  )
  SELECT jsonb_build_object(
    'contract_version', 'football_mvp_pl_laliga_canary_report@1.0.0',
    'build_run', CASE WHEN selected_run.id IS NULL THEN NULL ELSE
      jsonb_build_object(
        'id', selected_run.id,
        'status', selected_run.status,
        'window_from', selected_run.window_from,
        'window_to', selected_run.window_to,
        'matches_considered', selected_run.matches_considered,
        'rows_eligible', selected_run.rows_eligible,
        'rows_inserted', selected_run.rows_inserted,
        'rows_blocked', selected_run.rows_blocked,
        'provider_calls', selected_run.provider_calls,
        'started_at', selected_run.started_at,
        'finished_at', selected_run.finished_at
      ) END,
    'splits', COALESCE((
      SELECT jsonb_agg(to_jsonb(split_coverage) ORDER BY
        CASE split_key WHEN 'train' THEN 1 WHEN 'validation' THEN 2 ELSE 3 END)
      FROM split_coverage
    ), '[]'::jsonb),
    'leagues', COALESCE((
      SELECT jsonb_agg(to_jsonb(league_coverage)
        ORDER BY competition_name) FROM league_coverage
    ), '[]'::jsonb),
    'seasons', COALESCE((
      SELECT jsonb_agg(to_jsonb(season_coverage)
        ORDER BY competition_name, season_label) FROM season_coverage
    ), '[]'::jsonb),
    'markets', COALESCE((
      SELECT jsonb_agg(to_jsonb(market_coverage)
        ORDER BY market_family, line_key NULLS FIRST) FROM market_coverage
    ), '[]'::jsonb),
    'features', COALESCE((
      SELECT jsonb_agg(to_jsonb(feature_components)
        ORDER BY component_name) FROM feature_components
    ), '[]'::jsonb),
    'integrity', jsonb_build_object(
      'temporal_violations', integrity.temporal_violations,
      'duplicate_match_rows', integrity.duplicate_match_rows,
      'competition_scope_violations', integrity.competition_scope_violations,
      'readiness_violations', integrity.readiness_violations,
      'lineage_violations', integrity.lineage_violations,
      'temporal_split_violations',
        split_integrity.temporal_split_violations
    ),
    'safeguards', jsonb_build_object(
      'provider_calls', COALESCE(selected_run.provider_calls, 0),
      'dataset_rows_immutable', true,
      'same_match_single_split', true,
      'automatic_training', false,
      'automatic_predictions', false
    )
  )
  FROM target
  LEFT JOIN selected_run ON true
  CROSS JOIN integrity
  CROSS JOIN split_integrity
$function$;

REVOKE ALL ON FUNCTION public.get_football_mvp_pl_laliga_canary_report_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_football_mvp_pl_laliga_canary_report_v1(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_football_mvp_pl_laliga_canary_report_v1(uuid)
  IS 'Read-only coverage and integrity report for a gated PL + La Liga canary build.';
