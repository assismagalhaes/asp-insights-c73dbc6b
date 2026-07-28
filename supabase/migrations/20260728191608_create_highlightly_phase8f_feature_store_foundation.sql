CREATE TABLE IF NOT EXISTS public.hl_feature_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  code text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  is_enabled boolean NOT NULL DEFAULT false,
  cutoff_policy text NOT NULL,
  feature_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_feature_sets_code_format CHECK (
    code ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  CONSTRAINT hl_feature_sets_version_format CHECK (
    version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  CONSTRAINT hl_feature_sets_status_check CHECK (
    status IN ('draft', 'shadow', 'active', 'retired')
  ),
  CONSTRAINT hl_feature_sets_unique UNIQUE (sport_id, code, version)
);

CREATE TABLE IF NOT EXISTS public.hl_match_feature_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_set_id uuid NOT NULL
    REFERENCES public.hl_feature_sets(id) ON DELETE RESTRICT,
  match_id uuid NOT NULL
    REFERENCES public.sports_matches(id) ON DELETE RESTRICT,
  horizon_key text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  kickoff_at timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  features jsonb NOT NULL,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  coverage_pct numeric(7, 2) NOT NULL DEFAULT 0,
  leakage_status text NOT NULL DEFAULT 'clean',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_match_feature_snapshots_horizon_check CHECK (
    horizon_key IN ('t24h', 't6h', 't60m')
  ),
  CONSTRAINT hl_match_feature_snapshots_cutoff_check CHECK (
    cutoff_at < kickoff_at
  ),
  CONSTRAINT hl_match_feature_snapshots_coverage_check CHECK (
    coverage_pct >= 0 AND coverage_pct <= 100
  ),
  CONSTRAINT hl_match_feature_snapshots_leakage_check CHECK (
    leakage_status IN ('clean', 'review', 'blocked')
  ),
  CONSTRAINT hl_match_feature_snapshots_unique
    UNIQUE (feature_set_id, match_id, horizon_key, cutoff_at)
);

CREATE TABLE IF NOT EXISTS public.hl_match_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL
    REFERENCES public.sports_matches(id) ON DELETE RESTRICT,
  label_version text NOT NULL,
  outcome_at timestamptz NOT NULL,
  label_available_at timestamptz NOT NULL DEFAULT now(),
  labels jsonb NOT NULL,
  quality_status text NOT NULL DEFAULT 'valid',
  source_data_max_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_match_labels_quality_check CHECK (
    quality_status IN ('valid', 'quarantined', 'rejected')
  ),
  CONSTRAINT hl_match_labels_availability_check CHECK (
    outcome_at <= label_available_at
    AND (
      source_data_max_at IS NULL
      OR source_data_max_at <= label_available_at
    )
  ),
  CONSTRAINT hl_match_labels_unique UNIQUE (match_id, label_version)
);

CREATE TABLE IF NOT EXISTS public.hl_feature_materialization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_set_id uuid NOT NULL
    REFERENCES public.hl_feature_sets(id) ON DELETE RESTRICT,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  horizon_key text NOT NULL,
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'running',
  matches_considered integer NOT NULL DEFAULT 0,
  snapshots_inserted integer NOT NULL DEFAULT 0,
  snapshots_skipped integer NOT NULL DEFAULT 0,
  snapshots_blocked integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_feature_materialization_runs_horizon_check CHECK (
    horizon_key IN ('t24h', 't6h', 't60m')
  ),
  CONSTRAINT hl_feature_materialization_runs_window_check CHECK (
    window_from < window_to
  ),
  CONSTRAINT hl_feature_materialization_runs_status_check CHECK (
    status IN ('running', 'completed', 'completed_with_exceptions', 'failed')
  ),
  CONSTRAINT hl_feature_materialization_runs_counts_check CHECK (
    matches_considered >= 0
    AND snapshots_inserted >= 0
    AND snapshots_skipped >= 0
    AND snapshots_blocked >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_hl_feature_sets_sport_status
  ON public.hl_feature_sets (sport_id, status, is_enabled);
CREATE INDEX IF NOT EXISTS idx_hl_match_feature_snapshots_match
  ON public.hl_match_feature_snapshots (
    match_id,
    feature_set_id,
    cutoff_at DESC
  );
CREATE INDEX IF NOT EXISTS idx_hl_match_feature_snapshots_training
  ON public.hl_match_feature_snapshots (
    feature_set_id,
    horizon_key,
    kickoff_at,
    match_id
  )
  WHERE leakage_status = 'clean';
CREATE INDEX IF NOT EXISTS idx_hl_match_feature_snapshots_quality
  ON public.hl_match_feature_snapshots (
    feature_set_id,
    coverage_pct,
    kickoff_at DESC
  );
CREATE INDEX IF NOT EXISTS idx_hl_match_labels_training
  ON public.hl_match_labels (
    label_version,
    outcome_at,
    match_id
  )
  WHERE quality_status = 'valid';
CREATE INDEX IF NOT EXISTS idx_hl_feature_materialization_runs_latest
  ON public.hl_feature_materialization_runs (
    feature_set_id,
    started_at DESC
  );
CREATE INDEX IF NOT EXISTS idx_sports_team_season_stats_feature_cutoff
  ON public.sports_team_season_stats (team_id, collected_at DESC)
  WHERE numeric_value IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_highlightly_feature_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION
    'feature snapshots are immutable; create a new feature-set version instead'
    USING ERRCODE = '55000';
END
$function$;

REVOKE ALL ON FUNCTION public.prevent_highlightly_feature_snapshot_mutation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hl_match_feature_snapshots_immutable
  ON public.hl_match_feature_snapshots;
CREATE TRIGGER trg_hl_match_feature_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.hl_match_feature_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_highlightly_feature_snapshot_mutation();

ALTER TABLE public.hl_feature_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_match_feature_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_match_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_feature_materialization_runs ENABLE ROW LEVEL SECURITY;

DO $security$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'hl_feature_sets',
    'hl_match_feature_snapshots',
    'hl_match_labels',
    'hl_feature_materialization_runs'
  ]
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      target_table
    );
    EXECUTE format(
      'GRANT SELECT ON TABLE public.%I TO authenticated',
      target_table
    );
    EXECUTE format(
      'GRANT ALL ON TABLE public.%I TO service_role',
      target_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'admin_read_' || target_table,
      target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      || 'USING ((SELECT public.has_role((SELECT auth.uid()), '
      || '''admin''::public.app_role)))',
      'admin_read_' || target_table,
      target_table
    );
  END LOOP;
END
$security$;

DROP TRIGGER IF EXISTS trg_hl_feature_sets_touch_updated_at
  ON public.hl_feature_sets;
CREATE TRIGGER trg_hl_feature_sets_touch_updated_at
  BEFORE UPDATE ON public.hl_feature_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

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
  '1.0.0',
  'draft',
  false,
  'Every source timestamp must be less than or equal to kickoff minus the requested horizon.',
  jsonb_build_object(
    'horizons', jsonb_build_array('t24h', 't6h', 't60m'),
    'components', jsonb_build_array(
      'identity',
      'home_recent_form',
      'away_recent_form',
      'home_standings',
      'away_standings',
      'team_season_metrics',
      'prematch_odds_consensus',
      'lineup_availability'
    ),
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
  cutoff_policy = EXCLUDED.cutoff_policy,
  feature_spec = EXCLUDED.feature_spec,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.build_highlightly_football_team_features(
  p_team_id uuid,
  p_competition_id uuid,
  p_season_id uuid,
  p_cutoff_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH previous_matches AS (
    SELECT
      previous_match.id,
      previous_match.kickoff_at
    FROM public.sports_match_participants AS participant
    JOIN public.sports_matches AS previous_match
      ON previous_match.id = participant.match_id
    WHERE participant.team_id = p_team_id
      AND previous_match.status = 'finished'
      AND previous_match.kickoff_at IS NOT NULL
      AND previous_match.kickoff_at < p_cutoff_at
    ORDER BY previous_match.kickoff_at DESC
    LIMIT 5
  ),
  recent_summary AS (
    SELECT
      count(*)::integer AS matches,
      max(previous_match.kickoff_at) AS last_match_at
    FROM previous_matches AS previous_match
  ),
  recent_metric_values AS (
    SELECT
      metric.canonical_key,
      round(avg(team_stat.numeric_value), 4) AS average_value,
      count(*)::integer AS observations,
      max(team_stat.collected_at) AS source_max_at
    FROM previous_matches AS previous_match
    JOIN public.sports_match_team_stats AS team_stat
      ON team_stat.match_id = previous_match.id
     AND team_stat.team_id = p_team_id
     AND team_stat.numeric_value IS NOT NULL
     AND team_stat.collected_at <= p_cutoff_at
    JOIN public.hl_metric_definitions AS metric
      ON metric.id = team_stat.metric_definition_id
     AND metric.status IN ('observed', 'mapped')
    GROUP BY metric.canonical_key
  ),
  recent_metrics AS (
    SELECT
      COALESCE(
        jsonb_object_agg(
          recent_metric_values.canonical_key,
          jsonb_build_object(
            'mean', recent_metric_values.average_value,
            'observations', recent_metric_values.observations
          )
          ORDER BY recent_metric_values.canonical_key
        ),
        '{}'::jsonb
      ) AS payload,
      max(recent_metric_values.source_max_at) AS source_max_at
    FROM recent_metric_values
  ),
  latest_season_metric_values AS (
    SELECT DISTINCT ON (metric.canonical_key)
      metric.canonical_key,
      season_stat.numeric_value,
      season_stat.scope_key,
      season_stat.split_key,
      season_stat.collected_at
    FROM public.sports_team_season_stats AS season_stat
    JOIN public.hl_metric_definitions AS metric
      ON metric.id = season_stat.metric_definition_id
     AND metric.status IN ('observed', 'mapped')
    WHERE season_stat.team_id = p_team_id
      AND season_stat.numeric_value IS NOT NULL
      AND season_stat.collected_at <= p_cutoff_at
      AND (
        p_competition_id IS NULL
        OR season_stat.competition_id IS NULL
        OR season_stat.competition_id = p_competition_id
      )
      AND (
        p_season_id IS NULL
        OR season_stat.season_id IS NULL
        OR season_stat.season_id = p_season_id
      )
    ORDER BY
      metric.canonical_key,
      season_stat.collected_at DESC,
      season_stat.id DESC
  ),
  season_metrics AS (
    SELECT
      COALESCE(
        jsonb_object_agg(
          latest_season_metric_values.canonical_key,
          jsonb_build_object(
            'value', latest_season_metric_values.numeric_value,
            'scope', latest_season_metric_values.scope_key,
            'split', latest_season_metric_values.split_key
          )
          ORDER BY latest_season_metric_values.canonical_key
        ),
        '{}'::jsonb
      ) AS payload,
      max(latest_season_metric_values.collected_at) AS source_max_at
    FROM latest_season_metric_values
  ),
  latest_standing AS (
    SELECT
      standing.rank,
      standing.points,
      standing.played,
      standing.wins,
      standing.draws,
      standing.losses,
      standing.scored,
      standing.conceded,
      standing.goal_difference,
      standing.form,
      standing.snapshot_at
    FROM public.sports_standings_snapshots AS standing
    WHERE standing.team_id = p_team_id
      AND standing.quality_status = 'valid'
      AND standing.snapshot_at <= p_cutoff_at
      AND (
        p_competition_id IS NULL
        OR standing.competition_id = p_competition_id
      )
      AND (
        p_season_id IS NULL
        OR standing.season_id = p_season_id
      )
    ORDER BY standing.snapshot_at DESC, standing.id DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'team_id', p_team_id,
    'recent', jsonb_build_object(
      'matches', COALESCE(recent_summary.matches, 0),
      'last_match_at', recent_summary.last_match_at,
      'rest_days', CASE
        WHEN recent_summary.last_match_at IS NULL THEN NULL
        ELSE round(
          extract(epoch FROM (p_cutoff_at - recent_summary.last_match_at))
            / 86400.0,
          2
        )
      END,
      'numeric_averages', recent_metrics.payload
    ),
    'season_numeric_features', season_metrics.payload,
    'standings', CASE
      WHEN latest_standing.snapshot_at IS NULL THEN NULL
      ELSE to_jsonb(latest_standing)
    END,
    'source_max_at', GREATEST(
      recent_metrics.source_max_at,
      season_metrics.source_max_at,
      latest_standing.snapshot_at
    )
  )
  FROM recent_summary
  CROSS JOIN recent_metrics
  CROSS JOIN season_metrics
  LEFT JOIN latest_standing ON true
$function$;

REVOKE ALL ON FUNCTION public.build_highlightly_football_team_features(
  uuid,
  uuid,
  uuid,
  timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_highlightly_football_team_features(
  uuid,
  uuid,
  uuid,
  timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_highlightly_football_features(
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
  horizon_interval interval;
  target_feature_set public.hl_feature_sets%ROWTYPE;
  run_id uuid;
  considered integer := 0;
  inserted integer := 0;
  skipped integer := 0;
  blocked integer := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'feature window must be ordered'
      USING ERRCODE = '22023';
  END IF;
  IF p_to > p_from + interval '31 days' THEN
    RAISE EXCEPTION 'feature window must not exceed 31 days'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'feature snapshot limit must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  horizon_interval := CASE p_horizon_key
    WHEN 't24h' THEN interval '24 hours'
    WHEN 't6h' THEN interval '6 hours'
    WHEN 't60m' THEN interval '60 minutes'
    ELSE NULL
  END;
  IF horizon_interval IS NULL THEN
    RAISE EXCEPTION 'unsupported feature horizon: %', p_horizon_key
      USING ERRCODE = '22023';
  END IF;

  SELECT feature_set.*
  INTO target_feature_set
  FROM public.hl_feature_sets AS feature_set
  JOIN public.sports AS sport ON sport.id = feature_set.sport_id
  WHERE sport.code = 'football'
    AND feature_set.code = 'highlightly_football_prematch'
    AND feature_set.version = '1.0.0'
  LIMIT 1;

  IF target_feature_set.id IS NULL THEN
    RAISE EXCEPTION 'football feature set 1.0.0 is not installed';
  END IF;

  INSERT INTO public.hl_feature_materialization_runs (
    feature_set_id,
    sport_id,
    horizon_key,
    window_from,
    window_to
  )
  VALUES (
    target_feature_set.id,
    target_feature_set.sport_id,
    p_horizon_key,
    p_from,
    p_to
  )
  RETURNING id INTO run_id;

  WITH candidates AS (
    SELECT
      match_row.id AS match_id,
      match_row.kickoff_at,
      match_row.kickoff_at - horizon_interval AS cutoff_at,
      match_row.competition_id,
      match_row.season_id,
      match_row.round_name,
      home.team_id AS home_team_id,
      away.team_id AS away_team_id
    FROM public.sports_matches AS match_row
    JOIN public.sports AS sport
      ON sport.id = match_row.sport_id
     AND sport.code = 'football'
    JOIN public.sports_match_participants AS home
      ON home.match_id = match_row.id
     AND home.role = 'home'
    JOIN public.sports_match_participants AS away
      ON away.match_id = match_row.id
     AND away.role = 'away'
    WHERE match_row.kickoff_at >= p_from
      AND match_row.kickoff_at < p_to
      AND match_row.kickoff_at - horizon_interval <= statement_timestamp()
      AND match_row.status IN ('scheduled', 'finished')
    ORDER BY match_row.kickoff_at, match_row.id
    LIMIT p_limit
  ),
  enriched AS (
    SELECT
      candidate.*,
      public.build_highlightly_football_team_features(
        candidate.home_team_id,
        candidate.competition_id,
        candidate.season_id,
        candidate.cutoff_at
      ) AS home_features,
      public.build_highlightly_football_team_features(
        candidate.away_team_id,
        candidate.competition_id,
        candidate.season_id,
        candidate.cutoff_at
      ) AS away_features,
      COALESCE(odds.payload, '[]'::jsonb) AS odds_payload,
      COALESCE(odds.quote_count, 0) AS odds_count,
      odds.source_max_at AS odds_source_max_at,
      COALESCE(lineups.payload, '[]'::jsonb) AS lineups_payload,
      COALESCE(lineups.lineup_count, 0) AS lineup_count,
      lineups.source_max_at AS lineup_source_max_at
    FROM candidates AS candidate
    LEFT JOIN LATERAL (
      WITH latest_quote AS (
        SELECT DISTINCT ON (
          consensus.market_definition_id,
          consensus.selection_key,
          consensus.line_key
        )
          market.canonical_family,
          market.display_name AS market_name,
          consensus.selection_key,
          consensus.selection_name,
          consensus.line_value,
          consensus.median_odds,
          consensus.best_odds,
          consensus.minimum_odds,
          consensus.iqr,
          consensus.bookmaker_count,
          consensus.snapshot_at
        FROM public.sports_odds_consensus AS consensus
        JOIN public.sports_market_definitions AS market
          ON market.id = consensus.market_definition_id
        WHERE consensus.match_id = candidate.match_id
          AND NOT consensus.is_live
          AND consensus.snapshot_at <= candidate.cutoff_at
        ORDER BY
          consensus.market_definition_id,
          consensus.selection_key,
          consensus.line_key,
          consensus.snapshot_at DESC,
          consensus.id DESC
      )
      SELECT
        jsonb_agg(
          to_jsonb(latest_quote)
          ORDER BY
            latest_quote.canonical_family,
            latest_quote.selection_key,
            latest_quote.line_value
        ) AS payload,
        count(*)::integer AS quote_count,
        max(latest_quote.snapshot_at) AS source_max_at
      FROM latest_quote
    ) AS odds ON true
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'team_id', lineup.team_id,
            'formation', lineup.formation,
            'is_confirmed', lineup.is_confirmed,
            'published_at', lineup.published_at
          )
          ORDER BY lineup.team_id
        ) AS payload,
        count(*)::integer AS lineup_count,
        max(GREATEST(lineup.published_at, lineup.updated_at))
          AS source_max_at
      FROM public.sports_lineups AS lineup
      WHERE lineup.match_id = candidate.match_id
        AND COALESCE(lineup.published_at, lineup.created_at)
          <= candidate.cutoff_at
        AND lineup.updated_at <= candidate.cutoff_at
    ) AS lineups ON true
  ),
  prepared AS (
    SELECT
      enriched.*,
      (
        CASE WHEN COALESCE(
          (enriched.home_features #>> '{recent,matches}')::integer,
          0
        ) > 0 THEN 1 ELSE 0 END
        + CASE WHEN COALESCE(
          (enriched.away_features #>> '{recent,matches}')::integer,
          0
        ) > 0 THEN 1 ELSE 0 END
        + CASE WHEN enriched.home_features -> 'standings' IS NOT NULL
          AND enriched.home_features -> 'standings' <> 'null'::jsonb
          THEN 1 ELSE 0 END
        + CASE WHEN enriched.away_features -> 'standings' IS NOT NULL
          AND enriched.away_features -> 'standings' <> 'null'::jsonb
          THEN 1 ELSE 0 END
        + CASE WHEN enriched.odds_count > 0 THEN 1 ELSE 0 END
        + CASE WHEN enriched.lineup_count >= 2 THEN 1 ELSE 0 END
      ) AS available_components
    FROM enriched
  ),
  inserted_rows AS (
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
    SELECT
      target_feature_set.id,
      prepared.match_id,
      p_horizon_key,
      prepared.cutoff_at,
      prepared.kickoff_at,
      jsonb_build_object(
        'schema_version', target_feature_set.version,
        'identity', jsonb_build_object(
          'match_id', prepared.match_id,
          'competition_id', prepared.competition_id,
          'season_id', prepared.season_id,
          'round_name', prepared.round_name,
          'kickoff_at', prepared.kickoff_at,
          'home_team_id', prepared.home_team_id,
          'away_team_id', prepared.away_team_id
        ),
        'home', prepared.home_features - 'source_max_at',
        'away', prepared.away_features - 'source_max_at',
        'prematch_odds_consensus', prepared.odds_payload,
        'lineups', prepared.lineups_payload
      ),
      jsonb_build_object(
        'cutoff_at', prepared.cutoff_at,
        'policy', target_feature_set.cutoff_policy,
        'home_source_max_at', prepared.home_features ->> 'source_max_at',
        'away_source_max_at', prepared.away_features ->> 'source_max_at',
        'odds_source_max_at', prepared.odds_source_max_at,
        'lineup_source_max_at', prepared.lineup_source_max_at,
        'target_match_facts_used', false
      ),
      jsonb_build_object(
        'available_components', prepared.available_components,
        'expected_components', 6,
        'home_history_available', COALESCE(
          (prepared.home_features #>> '{recent,matches}')::integer,
          0
        ) > 0,
        'away_history_available', COALESCE(
          (prepared.away_features #>> '{recent,matches}')::integer,
          0
        ) > 0,
        'home_standings_available',
          prepared.home_features -> 'standings' IS NOT NULL
          AND prepared.home_features -> 'standings' <> 'null'::jsonb,
        'away_standings_available',
          prepared.away_features -> 'standings' IS NOT NULL
          AND prepared.away_features -> 'standings' <> 'null'::jsonb,
        'odds_available', prepared.odds_count > 0,
        'lineups_available', prepared.lineup_count >= 2
      ),
      round(100.0 * prepared.available_components / 6.0, 2),
      CASE
        WHEN prepared.cutoff_at >= prepared.kickoff_at THEN 'blocked'
        WHEN NULLIF(prepared.home_features ->> 'source_max_at', '')::timestamptz
          > prepared.cutoff_at THEN 'blocked'
        WHEN NULLIF(prepared.away_features ->> 'source_max_at', '')::timestamptz
          > prepared.cutoff_at THEN 'blocked'
        WHEN prepared.odds_source_max_at > prepared.cutoff_at THEN 'blocked'
        WHEN prepared.lineup_source_max_at > prepared.cutoff_at THEN 'blocked'
        ELSE 'clean'
      END
    FROM prepared
    ON CONFLICT (feature_set_id, match_id, horizon_key, cutoff_at)
    DO NOTHING
    RETURNING leakage_status
  )
  SELECT
    (SELECT count(*)::integer FROM candidates),
    count(*)::integer,
    count(*) FILTER (
      WHERE inserted_rows.leakage_status = 'blocked'
    )::integer
  INTO considered, inserted, blocked
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
    diagnostics = jsonb_build_object(
      'provider_calls', 0,
      'labels_generated', 0,
      'feature_set_enabled', target_feature_set.is_enabled
    )
  WHERE id = run_id;

  RETURN jsonb_build_object(
    'run_id', run_id,
    'feature_set', target_feature_set.code,
    'version', target_feature_set.version,
    'horizon', p_horizon_key,
    'matches_considered', considered,
    'snapshots_inserted', inserted,
    'snapshots_skipped', skipped,
    'provider_calls', 0,
    'labels_generated', 0
  );
EXCEPTION
  WHEN OTHERS THEN
    IF run_id IS NOT NULL THEN
      UPDATE public.hl_feature_materialization_runs
      SET
        status = 'failed',
        finished_at = statement_timestamp(),
        diagnostics = jsonb_build_object(
          'sqlstate', SQLSTATE,
          'error', SQLERRM,
          'provider_calls', 0
        )
      WHERE id = run_id;
    END IF;
    RAISE;
END
$function$;

REVOKE ALL ON FUNCTION public.materialize_highlightly_football_features(
  timestamptz,
  timestamptz,
  text,
  integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_highlightly_football_features(
  timestamptz,
  timestamptz,
  text,
  integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_feature_store_report(
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
    SELECT feature_set.*
    FROM public.hl_feature_sets AS feature_set
    JOIN public.sports AS sport ON sport.id = feature_set.sport_id
    WHERE sport.code = p_sport
  ),
  summary AS (
    SELECT
      target.code,
      target.version,
      target.status,
      target.is_enabled,
      snapshot.horizon_key,
      count(snapshot.id)::integer AS snapshots,
      round(avg(snapshot.coverage_pct), 2) AS average_coverage_pct,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY snapshot.coverage_pct
      ) AS median_coverage_pct,
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
    FROM target
    LEFT JOIN public.hl_match_feature_snapshots AS snapshot
      ON snapshot.feature_set_id = target.id
     AND snapshot.kickoff_at
       >= statement_timestamp() - make_interval(days => p_days)
    GROUP BY
      target.code,
      target.version,
      target.status,
      target.is_enabled,
      snapshot.horizon_key
  )
  SELECT jsonb_build_object(
    'generated_at', statement_timestamp(),
    'sport', p_sport,
    'window_days', p_days,
    'automatic_training', false,
    'automatic_predictions', false,
    'feature_sets', COALESCE(
      jsonb_agg(to_jsonb(summary) ORDER BY summary.code, summary.horizon_key),
      '[]'::jsonb
    )
  )
  INTO result
  FROM summary;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_feature_store_report(
  text,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_feature_store_report(
  text,
  integer
) TO authenticated, service_role;

COMMENT ON TABLE public.hl_feature_sets IS
  'Versioned Phase 8F feature contracts. Draft by default; activation is a separate controlled decision.';
COMMENT ON TABLE public.hl_match_feature_snapshots IS
  'Immutable point-in-time pre-match feature snapshots with explicit cutoff and leakage status.';
COMMENT ON TABLE public.hl_match_labels IS
  'Post-outcome labels stored separately from pre-match features to prevent target leakage.';
COMMENT ON FUNCTION public.materialize_highlightly_football_features(
  timestamptz,
  timestamptz,
  text,
  integer
) IS
  'Service-role materializer for Football point-in-time features; performs no provider calls and creates no labels.';

NOTIFY pgrst, 'reload schema';
