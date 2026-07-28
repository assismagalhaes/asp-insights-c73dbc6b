CREATE TABLE IF NOT EXISTS public.hl_competition_feature_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  competition_id uuid NOT NULL
    REFERENCES public.sports_competitions(id) ON DELETE CASCADE,
  profile_key text NOT NULL,
  standings_policy text NOT NULL,
  is_model_eligible boolean NOT NULL DEFAULT false,
  classification_source text NOT NULL,
  confidence numeric(5, 4) NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_competition_feature_policies_competition_unique
    UNIQUE (competition_id),
  CONSTRAINT hl_competition_feature_policies_profile_check CHECK (
    profile_key IN ('league', 'cup', 'tournament', 'friendly', 'unknown')
  ),
  CONSTRAINT hl_competition_feature_policies_standings_check CHECK (
    standings_policy IN ('required', 'optional')
  ),
  CONSTRAINT hl_competition_feature_policies_source_check CHECK (
    classification_source IN ('provider_type', 'name_rule', 'manual')
  ),
  CONSTRAINT hl_competition_feature_policies_confidence_check CHECK (
    confidence >= 0 AND confidence <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_competition_feature_policies_profile
  ON public.hl_competition_feature_policies (
    sport_id,
    profile_key,
    is_model_eligible
  );
CREATE INDEX IF NOT EXISTS idx_hl_competition_feature_policies_review
  ON public.hl_competition_feature_policies (
    sport_id,
    confidence,
    competition_id
  )
  WHERE classification_source <> 'manual';

ALTER TABLE public.hl_competition_feature_policies
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hl_competition_feature_policies
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hl_competition_feature_policies
  TO authenticated;
GRANT ALL ON TABLE public.hl_competition_feature_policies
  TO service_role;

DROP POLICY IF EXISTS admin_read_hl_competition_feature_policies
  ON public.hl_competition_feature_policies;
CREATE POLICY admin_read_hl_competition_feature_policies
  ON public.hl_competition_feature_policies
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_role(
      (SELECT auth.uid()),
      'admin'::public.app_role
    ))
  );

DROP TRIGGER IF EXISTS trg_hl_competition_feature_policies_touch_updated_at
  ON public.hl_competition_feature_policies;
CREATE TRIGGER trg_hl_competition_feature_policies_touch_updated_at
  BEFORE UPDATE ON public.hl_competition_feature_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.classify_highlightly_football_competition(
  p_name text,
  p_competition_type text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN lower(COALESCE(p_competition_type, '')) ~
      '(friendly|friendlies|amistoso)'
      THEN 'friendly'
    WHEN lower(COALESCE(p_competition_type, '')) ~
      '(tournament|knockout|qualification|qualifier)'
      THEN 'tournament'
    WHEN lower(COALESCE(p_competition_type, '')) ~
      '(^|[^a-z])(cup|copa|coppa|coupe|pokal)([^a-z]|$)'
      THEN 'cup'
    WHEN lower(COALESCE(p_competition_type, '')) ~
      '(league|liga|division|championship)'
      THEN 'league'
    WHEN lower(COALESCE(p_name, '')) ~
      '(friendly|friendlies|amistoso|amistosos)'
      THEN 'friendly'
    WHEN lower(COALESCE(p_name, '')) ~
      '(champions league|europa league|conference league|world cup|olympic|qualification|qualifier|play[ -]?offs?|tournament)'
      THEN 'tournament'
    WHEN lower(COALESCE(p_name, '')) ~
      '(^|[^a-z])(cup|copa|coppa|coupe|pokal|trophy|shield|taca|taça|beker|kubok|recopa)([^a-z]|$)'
      THEN 'cup'
    WHEN lower(COALESCE(p_name, '')) ~
      '(league|liga|ligue|division|divisão|divisao|serie|série|premier|championship|bundesliga|eredivisie|allsvenskan|superettan|virsliga|lyga|deild|npl|superliga|eliteserien|ekstraklasa|meistriliiga|veikkausliiga|ykkönen|ykkonen|kakkonen|primera|segunda|tercera)'
      THEN 'league'
    ELSE 'unknown'
  END
$function$;

REVOKE ALL ON FUNCTION public.classify_highlightly_football_competition(
  text,
  text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_highlightly_football_competition(
  text,
  text
) TO authenticated, service_role;

INSERT INTO public.hl_competition_feature_policies AS existing_policy (
  sport_id,
  competition_id,
  profile_key,
  standings_policy,
  is_model_eligible,
  classification_source,
  confidence,
  evidence
)
SELECT
  competition.sport_id,
  competition.id,
  classified.profile_key,
  CASE
    WHEN classified.profile_key = 'league' THEN 'required'
    ELSE 'optional'
  END,
  classified.profile_key <> 'unknown',
  CASE
    WHEN lower(COALESCE(competition.competition_type, '')) ~
      '(friendly|friendlies|amistoso|tournament|knockout|qualification|qualifier|cup|copa|coppa|coupe|pokal|league|liga|division|championship)'
      THEN 'provider_type'
    ELSE 'name_rule'
  END,
  CASE
    WHEN classified.profile_key = 'unknown' THEN 0
    WHEN lower(COALESCE(competition.competition_type, '')) ~
      '(friendly|friendlies|amistoso|tournament|knockout|qualification|qualifier|cup|copa|coppa|coupe|pokal|league|liga|division|championship)'
      THEN 0.9500
    WHEN classified.profile_key IN ('friendly', 'cup', 'tournament')
      THEN 0.9000
    ELSE 0.7500
  END,
  jsonb_build_object(
    'competition_name', competition.name,
    'provider_competition_type', competition.competition_type,
    'policy_version', 'phase8f.3'
  )
FROM public.sports_competitions AS competition
JOIN public.sports AS sport
  ON sport.id = competition.sport_id
 AND sport.code = 'football'
CROSS JOIN LATERAL (
  SELECT public.classify_highlightly_football_competition(
    competition.name,
    competition.competition_type
  ) AS profile_key
) AS classified
ON CONFLICT (competition_id) DO UPDATE SET
  sport_id = EXCLUDED.sport_id,
  profile_key = EXCLUDED.profile_key,
  standings_policy = EXCLUDED.standings_policy,
  is_model_eligible = EXCLUDED.is_model_eligible,
  classification_source = EXCLUDED.classification_source,
  confidence = EXCLUDED.confidence,
  evidence = EXCLUDED.evidence,
  updated_at = now()
WHERE existing_policy.classification_source <> 'manual';

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
  '1.2.0',
  'draft',
  false,
  'Every source timestamp must be less than or equal to kickoff minus the requested horizon.',
  jsonb_build_object(
    'horizons', jsonb_build_array('t24h', 't6h', 't60m'),
    'coverage_policy_version', 'phase8f.3',
    'competition_aware', true,
    'competition_profiles', jsonb_build_object(
      'league', jsonb_build_object(
        'standings_policy', 'required',
        'model_eligible', true
      ),
      'cup', jsonb_build_object(
        'standings_policy', 'optional',
        'model_eligible', true
      ),
      'tournament', jsonb_build_object(
        'standings_policy', 'optional',
        'model_eligible', true
      ),
      'friendly', jsonb_build_object(
        'standings_policy', 'optional',
        'model_eligible', true
      ),
      'unknown', jsonb_build_object(
        'standings_policy', 'optional',
        'model_eligible', false
      )
    ),
    'horizon_requirements', jsonb_build_object(
      't24h', jsonb_build_object(
        'always_required', jsonb_build_array(
          'home_history',
          'away_history'
        ),
        'league_required', jsonb_build_array(
          'home_standings',
          'away_standings'
        ),
        'optional', jsonb_build_array('prematch_odds', 'lineups')
      ),
      't6h', jsonb_build_object(
        'always_required', jsonb_build_array(
          'home_history',
          'away_history',
          'prematch_odds'
        ),
        'league_required', jsonb_build_array(
          'home_standings',
          'away_standings'
        ),
        'optional', jsonb_build_array('lineups')
      ),
      't60m', jsonb_build_object(
        'always_required', jsonb_build_array(
          'home_history',
          'away_history',
          'prematch_odds',
          'lineups'
        ),
        'league_required', jsonb_build_array(
          'home_standings',
          'away_standings'
        ),
        'optional', '[]'::jsonb
      )
    ),
    'minimum_policy_coverage_pct', 70,
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

CREATE OR REPLACE FUNCTION public.materialize_highlightly_football_features_v3(
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
  eligible integer := 0;
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
    AND feature_set.version = '1.1.0'
  LIMIT 1;

  SELECT feature_set.*
  INTO target_feature_set
  FROM public.hl_feature_sets AS feature_set
  JOIN public.sports AS sport ON sport.id = feature_set.sport_id
  WHERE sport.code = 'football'
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.2.0'
  LIMIT 1;

  IF source_feature_set.id IS NULL OR target_feature_set.id IS NULL THEN
    RAISE EXCEPTION 'football feature sets 1.1.0 and 1.2.0 must be installed';
  END IF;

  source_result := public.materialize_highlightly_football_features_v2(
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
      'coverage_policy_version', 'phase8f.3',
      'source_feature_set_version', '1.1.0',
      'competition_aware', true
    )
  )
  RETURNING id INTO materialization_run_id;

  WITH source_snapshots AS (
    SELECT
      source_snapshot.*,
      match_row.competition_id,
      competition.name AS competition_name,
      competition.competition_type,
      policy.profile_key AS policy_profile_key,
      policy.standings_policy AS policy_standings_policy,
      policy.is_model_eligible AS policy_model_eligible,
      policy.classification_source,
      policy.confidence AS classification_confidence
    FROM public.hl_match_feature_snapshots AS source_snapshot
    JOIN public.sports_matches AS match_row
      ON match_row.id = source_snapshot.match_id
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN public.hl_competition_feature_policies AS policy
      ON policy.competition_id = match_row.competition_id
    WHERE source_snapshot.feature_set_id = source_feature_set.id
      AND source_snapshot.horizon_key = p_horizon_key
      AND source_snapshot.kickoff_at >= p_from
      AND source_snapshot.kickoff_at < p_to
    ORDER BY source_snapshot.kickoff_at, source_snapshot.match_id
    LIMIT p_limit
  ),
  profiled AS (
    SELECT
      source_snapshot.*,
      COALESCE(
        source_snapshot.policy_profile_key,
        public.classify_highlightly_football_competition(
          source_snapshot.competition_name,
          source_snapshot.competition_type
        )
      ) AS profile_key,
      COALESCE(
        source_snapshot.policy_standings_policy,
        CASE
          WHEN public.classify_highlightly_football_competition(
            source_snapshot.competition_name,
            source_snapshot.competition_type
          ) = 'league' THEN 'required'
          ELSE 'optional'
        END
      ) AS standings_policy,
      COALESCE(
        source_snapshot.policy_model_eligible,
        public.classify_highlightly_football_competition(
          source_snapshot.competition_name,
          source_snapshot.competition_type
        ) <> 'unknown'
      ) AS profile_model_eligible
    FROM source_snapshots AS source_snapshot
  ),
  scored AS (
    SELECT
      profiled.*,
      (
        CASE WHEN COALESCE(
          (profiled.quality ->> 'home_history_available')::boolean,
          false
        ) THEN 1 ELSE 0 END
        + CASE WHEN COALESCE(
          (profiled.quality ->> 'away_history_available')::boolean,
          false
        ) THEN 1 ELSE 0 END
        + CASE
          WHEN profiled.standings_policy = 'required'
            AND COALESCE(
              (profiled.quality ->> 'home_standings_available')::boolean,
              false
            )
          THEN 1 ELSE 0
        END
        + CASE
          WHEN profiled.standings_policy = 'required'
            AND COALESCE(
              (profiled.quality ->> 'away_standings_available')::boolean,
              false
            )
          THEN 1 ELSE 0
        END
        + CASE
          WHEN p_horizon_key IN ('t6h', 't60m')
            AND COALESCE(
              (profiled.quality ->> 'odds_available')::boolean,
              false
            )
          THEN 1 ELSE 0
        END
        + CASE
          WHEN p_horizon_key = 't60m'
            AND COALESCE(
              (profiled.quality ->> 'lineups_available')::boolean,
              false
            )
          THEN 1 ELSE 0
        END
      ) AS required_available,
      (
        2
        + CASE
          WHEN profiled.standings_policy = 'required' THEN 2
          ELSE 0
        END
        + CASE
          WHEN p_horizon_key IN ('t6h', 't60m') THEN 1
          ELSE 0
        END
        + CASE
          WHEN p_horizon_key = 't60m' THEN 1
          ELSE 0
        END
      ) AS required_expected
    FROM profiled
  ),
  evaluated AS (
    SELECT
      scored.*,
      round(
        100.0 * scored.required_available
          / NULLIF(scored.required_expected, 0),
        2
      ) AS competition_adjusted_coverage_pct
    FROM scored
  ),
  qualified AS (
    SELECT
      evaluated.*,
      (
        evaluated.profile_model_eligible
        AND evaluated.leakage_status = 'clean'
        AND evaluated.competition_adjusted_coverage_pct >= 70
      ) AS model_eligible,
      CASE
        WHEN evaluated.leakage_status <> 'clean' THEN 'leakage_not_clean'
        WHEN NOT evaluated.profile_model_eligible
          THEN 'competition_profile_not_eligible'
        WHEN evaluated.competition_adjusted_coverage_pct < 70
          THEN 'required_coverage_below_70'
        ELSE 'eligible'
      END AS eligibility_reason
    FROM evaluated
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
      qualified.match_id,
      qualified.horizon_key,
      qualified.cutoff_at,
      qualified.kickoff_at,
      statement_timestamp(),
      jsonb_set(
        qualified.features,
        '{schema_version}',
        to_jsonb(target_feature_set.version),
        true
      ) || jsonb_build_object(
        'coverage_policy_version',
        'phase8f.3',
        'competition_profile',
        qualified.profile_key
      ),
      qualified.lineage || jsonb_build_object(
        'derived_from_feature_snapshot_id',
        qualified.id,
        'source_feature_set_version',
        '1.1.0',
        'coverage_policy_version',
        'phase8f.3',
        'competition_policy_source',
        COALESCE(qualified.classification_source, 'runtime_rule'),
        'competition_policy_confidence',
        COALESCE(qualified.classification_confidence, 0),
        'target_match_facts_used',
        false
      ),
      qualified.quality || jsonb_build_object(
        'competition_profile',
        qualified.profile_key,
        'standings_policy',
        qualified.standings_policy,
        'required_available',
        qualified.required_available,
        'required_expected',
        qualified.required_expected,
        'policy_adjusted_coverage_pct',
        qualified.competition_adjusted_coverage_pct,
        'model_eligible',
        qualified.model_eligible,
        'eligibility_reason',
        qualified.eligibility_reason
      ),
      qualified.competition_adjusted_coverage_pct,
      qualified.leakage_status
    FROM qualified
    ON CONFLICT (feature_set_id, match_id, horizon_key, cutoff_at)
    DO NOTHING
    RETURNING leakage_status, quality
  )
  SELECT
    (SELECT count(*)::integer FROM source_snapshots),
    count(*)::integer,
    count(*) FILTER (
      WHERE inserted_rows.leakage_status = 'blocked'
    )::integer,
    count(*) FILTER (
      WHERE COALESCE(
        (inserted_rows.quality ->> 'model_eligible')::boolean,
        false
      )
    )::integer
  INTO considered, inserted, blocked, eligible
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
      'model_eligible_snapshots', eligible,
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
    'model_eligible_snapshots', eligible,
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

REVOKE ALL ON FUNCTION public.materialize_highlightly_football_features_v3(
  timestamptz,
  timestamptz,
  text,
  integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_highlightly_football_features_v3(
  timestamptz,
  timestamptz,
  text,
  integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_feature_store_report_v6(
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
  profile_report jsonb;
  profile_component_report jsonb;
  competition_report jsonb;
  eligibility_report jsonb;
  classification_catalog_report jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'feature report days must be between 1 and 365'
      USING ERRCODE = '22023';
  END IF;
  IF p_sport IS DISTINCT FROM 'football' THEN
    RAISE EXCEPTION 'Phase 8F.3 currently supports Football only'
      USING ERRCODE = '22023';
  END IF;

  base_report := public.get_highlightly_feature_store_report_v5(
    p_sport,
    p_days
  );

  WITH source_feature_set AS (
    SELECT feature_set.id
    FROM public.hl_feature_sets AS feature_set
    JOIN public.sports AS sport ON sport.id = feature_set.sport_id
    WHERE sport.code = 'football'
      AND feature_set.code = 'highlightly_football_prematch'
      AND feature_set.version = '1.1.0'
    LIMIT 1
  ),
  source_snapshots AS (
    SELECT
      snapshot.*,
      match_row.competition_id,
      competition.name AS competition_name,
      competition.competition_type,
      country.name AS country_name,
      policy.profile_key AS policy_profile_key,
      policy.standings_policy AS policy_standings_policy,
      policy.is_model_eligible AS policy_model_eligible,
      policy.classification_source,
      policy.confidence AS classification_confidence
    FROM source_feature_set
    JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.feature_set_id = source_feature_set.id
    JOIN public.sports_matches AS match_row
      ON match_row.id = snapshot.match_id
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN public.sports_countries AS country
      ON country.id = competition.country_id
    LEFT JOIN public.hl_competition_feature_policies AS policy
      ON policy.competition_id = match_row.competition_id
    WHERE snapshot.kickoff_at
      >= statement_timestamp() - make_interval(days => p_days)
  ),
  profiled AS (
    SELECT
      source_snapshot.*,
      COALESCE(
        source_snapshot.policy_profile_key,
        public.classify_highlightly_football_competition(
          source_snapshot.competition_name,
          source_snapshot.competition_type
        )
      ) AS profile_key,
      COALESCE(
        source_snapshot.policy_standings_policy,
        CASE
          WHEN public.classify_highlightly_football_competition(
            source_snapshot.competition_name,
            source_snapshot.competition_type
          ) = 'league' THEN 'required'
          ELSE 'optional'
        END
      ) AS standings_policy,
      COALESCE(
        source_snapshot.policy_model_eligible,
        public.classify_highlightly_football_competition(
          source_snapshot.competition_name,
          source_snapshot.competition_type
        ) <> 'unknown'
      ) AS profile_model_eligible
    FROM source_snapshots AS source_snapshot
  ),
  component_rows AS (
    SELECT
      profiled.id AS snapshot_id,
      profiled.competition_id,
      profiled.competition_name,
      profiled.country_name,
      profiled.profile_key,
      profiled.standings_policy,
      profiled.profile_model_eligible,
      profiled.classification_source,
      profiled.classification_confidence,
      profiled.horizon_key,
      profiled.leakage_status,
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
        ) THEN profiled.standings_policy = 'required'
        WHEN component_value.component_key = 'prematch_odds'
          THEN profiled.horizon_key IN ('t6h', 't60m')
        WHEN component_value.component_key = 'lineups'
          THEN profiled.horizon_key = 't60m'
        ELSE false
      END AS required_for_profile
    FROM profiled
    CROSS JOIN LATERAL (
      VALUES
        (
          'home_history',
          COALESCE(
            (profiled.quality ->> 'home_history_available')::boolean,
            false
          )
        ),
        (
          'away_history',
          COALESCE(
            (profiled.quality ->> 'away_history_available')::boolean,
            false
          )
        ),
        (
          'home_standings',
          COALESCE(
            (profiled.quality ->> 'home_standings_available')::boolean,
            false
          )
        ),
        (
          'away_standings',
          COALESCE(
            (profiled.quality ->> 'away_standings_available')::boolean,
            false
          )
        ),
        (
          'prematch_odds',
          COALESCE(
            (profiled.quality ->> 'odds_available')::boolean,
            false
          )
        ),
        (
          'lineups',
          COALESCE(
            (profiled.quality ->> 'lineups_available')::boolean,
            false
          )
        )
    ) AS component_value(component_key, available)
  ),
  snapshot_scores AS (
    SELECT
      component.snapshot_id,
      component.competition_id,
      component.competition_name,
      component.country_name,
      component.profile_key,
      component.standings_policy,
      component.profile_model_eligible,
      component.classification_source,
      component.classification_confidence,
      component.horizon_key,
      component.leakage_status,
      count(*) FILTER (
        WHERE component.required_for_profile
      )::integer AS required_components,
      count(*) FILTER (
        WHERE component.required_for_profile
          AND component.available
      )::integer AS required_available,
      round(
        100.0 * count(*) FILTER (
          WHERE component.required_for_profile
            AND component.available
        ) / NULLIF(
          count(*) FILTER (WHERE component.required_for_profile),
          0
        ),
        2
      ) AS projected_coverage_pct
    FROM component_rows AS component
    GROUP BY
      component.snapshot_id,
      component.competition_id,
      component.competition_name,
      component.country_name,
      component.profile_key,
      component.standings_policy,
      component.profile_model_eligible,
      component.classification_source,
      component.classification_confidence,
      component.horizon_key,
      component.leakage_status
  ),
  evaluated AS (
    SELECT
      score.*,
      (
        score.profile_model_eligible
        AND score.leakage_status = 'clean'
        AND score.projected_coverage_pct >= 70
      ) AS model_eligible,
      CASE
        WHEN score.leakage_status <> 'clean' THEN 'leakage_not_clean'
        WHEN NOT score.profile_model_eligible
          THEN 'competition_profile_not_eligible'
        WHEN score.projected_coverage_pct < 70
          THEN 'required_coverage_below_70'
        ELSE 'eligible'
      END AS eligibility_reason
    FROM snapshot_scores AS score
  ),
  profile_summary AS (
    SELECT
      evaluated.profile_key,
      evaluated.standings_policy,
      evaluated.horizon_key,
      count(*)::integer AS snapshots,
      round(avg(evaluated.projected_coverage_pct), 2)
        AS projected_average_coverage_pct,
      round(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY evaluated.projected_coverage_pct
        )::numeric,
        2
      ) AS projected_median_coverage_pct,
      count(*) FILTER (
        WHERE evaluated.model_eligible
      )::integer AS model_eligible_snapshots,
      count(*) FILTER (
        WHERE evaluated.eligibility_reason =
          'required_coverage_below_70'
      )::integer AS coverage_gap_snapshots,
      count(*) FILTER (
        WHERE evaluated.eligibility_reason =
          'competition_profile_not_eligible'
      )::integer AS profile_blocked_snapshots,
      count(*) FILTER (
        WHERE evaluated.leakage_status = 'blocked'
      )::integer AS leakage_blocked_snapshots
    FROM evaluated
    GROUP BY
      evaluated.profile_key,
      evaluated.standings_policy,
      evaluated.horizon_key
  ),
  profile_component_summary AS (
    SELECT
      component.profile_key,
      component.standings_policy,
      component.horizon_key,
      component.component_key AS component,
      CASE
        WHEN component.required_for_profile THEN 'required'
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
      ) AS availability_pct
    FROM component_rows AS component
    GROUP BY
      component.profile_key,
      component.standings_policy,
      component.horizon_key,
      component.component_key,
      component.required_for_profile
  ),
  competition_summary AS (
    SELECT
      evaluated.competition_id,
      COALESCE(evaluated.country_name, 'País não informado')
        AS country_name,
      COALESCE(evaluated.competition_name, 'Liga não informada')
        AS competition_name,
      evaluated.profile_key,
      evaluated.standings_policy,
      evaluated.classification_source,
      evaluated.classification_confidence,
      evaluated.horizon_key,
      count(*)::integer AS snapshots,
      round(avg(evaluated.projected_coverage_pct), 2)
        AS projected_average_coverage_pct,
      count(*) FILTER (
        WHERE evaluated.model_eligible
      )::integer AS model_eligible_snapshots,
      count(*) FILTER (
        WHERE NOT evaluated.model_eligible
      )::integer AS ineligible_snapshots
    FROM evaluated
    GROUP BY
      evaluated.competition_id,
      evaluated.country_name,
      evaluated.competition_name,
      evaluated.profile_key,
      evaluated.standings_policy,
      evaluated.classification_source,
      evaluated.classification_confidence,
      evaluated.horizon_key
  ),
  overall AS (
    SELECT
      count(*)::integer AS snapshots,
      round(avg(evaluated.projected_coverage_pct), 2)
        AS projected_average_coverage_pct,
      count(*) FILTER (
        WHERE evaluated.model_eligible
      )::integer AS model_eligible_snapshots,
      round(
        100.0 * count(*) FILTER (WHERE evaluated.model_eligible)
          / NULLIF(count(*), 0),
        2
      ) AS model_eligible_pct,
      count(*) FILTER (
        WHERE evaluated.profile_key = 'unknown'
      )::integer AS unclassified_snapshots,
      count(*) FILTER (
        WHERE evaluated.leakage_status = 'blocked'
      )::integer AS leakage_blocked_snapshots,
      CASE
        WHEN count(*) FILTER (
          WHERE evaluated.leakage_status = 'blocked'
        ) > 0 THEN 'blocked_by_leakage'
        WHEN count(*) < 20 THEN 'insufficient_sample'
        WHEN count(*) FILTER (
          WHERE evaluated.profile_key = 'unknown'
        ) > 0 THEN 'review_unclassified_competitions'
        WHEN 100.0 * count(*) FILTER (
          WHERE evaluated.model_eligible
        ) / NULLIF(count(*), 0) < 70
          THEN 'improve_profile_coverage'
        ELSE 'ready_for_v120_canary'
      END AS recommendation
    FROM evaluated
  ),
  catalog_summary AS (
    SELECT
      policy.profile_key,
      policy.classification_source,
      policy.standings_policy,
      policy.is_model_eligible,
      count(*)::integer AS competitions,
      round(avg(policy.confidence), 4) AS average_confidence
    FROM public.hl_competition_feature_policies AS policy
    JOIN public.sports AS sport
      ON sport.id = policy.sport_id
     AND sport.code = p_sport
    GROUP BY
      policy.profile_key,
      policy.classification_source,
      policy.standings_policy,
      policy.is_model_eligible
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(profile_summary)
          ORDER BY
            profile_summary.profile_key,
            profile_summary.horizon_key
        )
        FROM profile_summary
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(profile_component_summary)
          ORDER BY
            profile_component_summary.profile_key,
            profile_component_summary.horizon_key,
            profile_component_summary.component
        )
        FROM profile_component_summary
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(competition_summary)
          ORDER BY
            competition_summary.projected_average_coverage_pct,
            competition_summary.snapshots DESC,
            competition_summary.country_name,
            competition_summary.competition_name
        )
        FROM competition_summary
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT to_jsonb(overall) FROM overall),
      jsonb_build_object(
        'snapshots', 0,
        'projected_average_coverage_pct', 0,
        'model_eligible_snapshots', 0,
        'model_eligible_pct', 0,
        'unclassified_snapshots', 0,
        'leakage_blocked_snapshots', 0,
        'recommendation', 'insufficient_sample'
      )
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(catalog_summary)
          ORDER BY
            catalog_summary.profile_key,
            catalog_summary.classification_source
        )
        FROM catalog_summary
      ),
      '[]'::jsonb
    )
  INTO
    profile_report,
    profile_component_report,
    competition_report,
    eligibility_report,
    classification_catalog_report;

  RETURN base_report || jsonb_build_object(
    'quality_contract_version', 'phase8f.3',
    'projected_feature_set_version', '1.2.0',
    'competition_policy_version', 'phase8f.3',
    'competition_profiles', profile_report,
    'classification_catalog', classification_catalog_report,
    'profile_components', profile_component_report,
    'competition_eligibility', competition_report,
    'eligibility', eligibility_report,
    'automatic_training', false,
    'automatic_predictions', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_feature_store_report_v6(
  text,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_feature_store_report_v6(
  text,
  integer
) TO authenticated, service_role;

COMMENT ON TABLE public.hl_competition_feature_policies IS
  'Phase 8F.3 auditable competition profiles. Collection remains unchanged; unknown competitions fail closed for modeling.';
COMMENT ON FUNCTION public.classify_highlightly_football_competition(
  text,
  text
) IS
  'Deterministic fallback classifier for Football competition feature policy. Manual catalog overrides take precedence.';
COMMENT ON FUNCTION public.materialize_highlightly_football_features_v3(
  timestamptz,
  timestamptz,
  text,
  integer
) IS
  'Phase 8F.3 service-role materializer for Football 1.2.0 with competition-aware coverage and no provider calls or labels.';
COMMENT ON FUNCTION public.get_highlightly_feature_store_report_v6(
  text,
  integer
) IS
  'Phase 8F.3 admin report projecting competition-aware coverage and model eligibility from immutable 1.1.0 snapshots.';

NOTIFY pgrst, 'reload schema';
