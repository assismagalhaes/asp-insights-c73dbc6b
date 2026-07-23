-- Highlightly Phase 8E: quota-aware match lifecycle orchestration.
-- The rollout is intentionally disabled by default and must be enabled per sport.

CREATE TABLE IF NOT EXISTS public.hl_match_lifecycle_policies (
  sport_id uuid PRIMARY KEY REFERENCES public.sports(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  imminent_window_minutes integer NOT NULL DEFAULT 120,
  prematch_poll_seconds integer NOT NULL DEFAULT 900,
  live_poll_seconds integer NOT NULL DEFAULT 300,
  postgame_horizons_minutes integer[] NOT NULL DEFAULT ARRAY[15, 120, 1440],
  required_resources text[] NOT NULL,
  optional_resources text[] NOT NULL DEFAULT '{}'::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_match_lifecycle_policy_windows_check CHECK (
    imminent_window_minutes BETWEEN 30 AND 360
    AND prematch_poll_seconds BETWEEN 300 AND 3600
    AND live_poll_seconds BETWEEN 120 AND 1800
  ),
  CONSTRAINT hl_match_lifecycle_policy_horizons_check CHECK (
    cardinality(postgame_horizons_minutes) BETWEEN 1 AND 6
    AND postgame_horizons_minutes[1] >= 5
  ),
  CONSTRAINT hl_match_lifecycle_policy_resources_check CHECK (
    cardinality(required_resources) >= 1
  )
);

INSERT INTO public.hl_match_lifecycle_policies (
  sport_id,
  enabled,
  required_resources,
  optional_resources,
  metadata
)
SELECT
  sport.id,
  false,
  CASE sport.code
    WHEN 'football' THEN ARRAY['match_status', 'events', 'match_statistics']
    WHEN 'baseball' THEN ARRAY['match_status', 'match_statistics', 'box_scores']
    WHEN 'basketball' THEN ARRAY['match_status', 'match_statistics']
  END,
  CASE sport.code
    WHEN 'football' THEN ARRAY['lineups', 'box_scores', 'highlights']
    WHEN 'baseball' THEN ARRAY['lineups', 'highlights']
    WHEN 'basketball' THEN ARRAY['highlights']
  END,
  jsonb_build_object(
    'phase', '8E',
    'rollout', 'disabled_by_default',
    'postgameCadence', jsonb_build_array('T+15m', 'T+2h', 'T+24h')
  )
FROM public.sports AS sport
WHERE sport.code IN ('football', 'baseball', 'basketball')
ON CONFLICT (sport_id) DO UPDATE SET
  required_resources = EXCLUDED.required_resources,
  optional_resources = EXCLUDED.optional_resources,
  metadata = EXCLUDED.metadata,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.hl_match_lifecycle_states (
  match_id uuid PRIMARY KEY REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE RESTRICT,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  external_match_id text NOT NULL,
  lifecycle_stage text NOT NULL DEFAULT 'scheduled',
  kickoff_at timestamptz,
  last_provider_status text,
  last_polled_at timestamptz,
  next_poll_at timestamptz,
  final_observed_at timestamptz,
  completed_at timestamptz,
  missing_resources text[] NOT NULL DEFAULT '{}'::text[],
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hl_match_lifecycle_states_stage_check CHECK (
    lifecycle_stage IN (
      'scheduled',
      'imminent',
      'live',
      'finished_pending_detail',
      'complete',
      'complete_with_exceptions',
      'terminal',
      'quarantined'
    )
  ),
  CONSTRAINT hl_match_lifecycle_states_provider_external_unique
    UNIQUE (provider_id, sport_id, external_match_id)
);

CREATE TABLE IF NOT EXISTS public.hl_match_lifecycle_resources (
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  resource text NOT NULL,
  endpoint_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_job_id uuid REFERENCES public.hl_ingestion_jobs(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_attempted_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, resource),
  CONSTRAINT hl_match_lifecycle_resources_status_check CHECK (
    status IN (
      'pending',
      'running',
      'succeeded',
      'retry',
      'dead',
      'provider_unavailable',
      'quality_rejected',
      'not_supported'
    )
  ),
  CONSTRAINT hl_match_lifecycle_resources_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_hl_match_lifecycle_states_due
  ON public.hl_match_lifecycle_states (next_poll_at, lifecycle_stage, kickoff_at)
  WHERE lifecycle_stage IN (
    'scheduled',
    'imminent',
    'live',
    'finished_pending_detail'
  );

CREATE INDEX IF NOT EXISTS idx_hl_match_lifecycle_states_sport_stage
  ON public.hl_match_lifecycle_states (sport_id, lifecycle_stage, kickoff_at DESC);

CREATE INDEX IF NOT EXISTS idx_hl_match_lifecycle_resources_status
  ON public.hl_match_lifecycle_resources (status, updated_at DESC, match_id);

ALTER TABLE public.hl_match_lifecycle_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_match_lifecycle_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_match_lifecycle_resources ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hl_match_lifecycle_policies
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hl_match_lifecycle_states
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hl_match_lifecycle_resources
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.hl_match_lifecycle_policies TO authenticated;
GRANT SELECT ON TABLE public.hl_match_lifecycle_states TO authenticated;
GRANT SELECT ON TABLE public.hl_match_lifecycle_resources TO authenticated;

GRANT ALL ON TABLE public.hl_match_lifecycle_policies TO service_role;
GRANT ALL ON TABLE public.hl_match_lifecycle_states TO service_role;
GRANT ALL ON TABLE public.hl_match_lifecycle_resources TO service_role;

DROP POLICY IF EXISTS admin_read_hl_match_lifecycle_policies
  ON public.hl_match_lifecycle_policies;
CREATE POLICY admin_read_hl_match_lifecycle_policies
  ON public.hl_match_lifecycle_policies
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS admin_read_hl_match_lifecycle_states
  ON public.hl_match_lifecycle_states;
CREATE POLICY admin_read_hl_match_lifecycle_states
  ON public.hl_match_lifecycle_states
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS admin_read_hl_match_lifecycle_resources
  ON public.hl_match_lifecycle_resources;
CREATE POLICY admin_read_hl_match_lifecycle_resources
  ON public.hl_match_lifecycle_resources
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP TRIGGER IF EXISTS trg_hl_match_lifecycle_policies_touch_updated_at
  ON public.hl_match_lifecycle_policies;
CREATE TRIGGER trg_hl_match_lifecycle_policies_touch_updated_at
  BEFORE UPDATE ON public.hl_match_lifecycle_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_hl_match_lifecycle_states_touch_updated_at
  ON public.hl_match_lifecycle_states;
CREATE TRIGGER trg_hl_match_lifecycle_states_touch_updated_at
  BEFORE UPDATE ON public.hl_match_lifecycle_states
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_hl_match_lifecycle_resources_touch_updated_at
  ON public.hl_match_lifecycle_resources;
CREATE TRIGGER trg_hl_match_lifecycle_resources_touch_updated_at
  BEFORE UPDATE ON public.hl_match_lifecycle_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.get_highlightly_match_lifecycle_candidates(
  p_at timestamptz DEFAULT now(),
  p_limit integer DEFAULT 1000,
  p_include_disabled boolean DEFAULT false
)
RETURNS TABLE (
  match_id uuid,
  sport text,
  external_match_id text,
  kickoff_at timestamptz,
  match_status text,
  lifecycle_stage text,
  cadence_key text,
  resource text,
  endpoint_key text,
  request_params jsonb,
  dedupe_key text,
  priority integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH provider AS (
    SELECT sports_provider.id
    FROM public.sports_providers AS sports_provider
    WHERE sports_provider.code = 'highlightly'
    LIMIT 1
  ),
  base AS (
    SELECT
      match_row.id AS match_id,
      sport.code AS sport,
      provider_entity.external_id AS external_match_id,
      match_row.kickoff_at,
      match_row.status AS match_status,
      match_row.provider_status,
      match_row.ended_at,
      match_row.updated_at,
      lifecycle_policy.imminent_window_minutes,
      lifecycle_policy.prematch_poll_seconds,
      lifecycle_policy.live_poll_seconds,
      COALESCE(
        match_row.ended_at,
        match_row.kickoff_at + interval '3 hours',
        match_row.updated_at
      ) AS effective_end_at
    FROM public.sports_matches AS match_row
    JOIN public.sports AS sport
      ON sport.id = match_row.sport_id
    JOIN public.hl_match_lifecycle_policies AS lifecycle_policy
      ON lifecycle_policy.sport_id = sport.id
     AND (lifecycle_policy.enabled OR p_include_disabled)
    JOIN provider
      ON true
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.provider_id = provider.id
     AND provider_entity.sport_id = match_row.sport_id
     AND provider_entity.entity_type = 'match'
     AND provider_entity.canonical_id = match_row.id
    WHERE sport.code IN ('football', 'baseball', 'basketball')
      AND match_row.kickoff_at >= p_at - interval '36 hours'
      AND match_row.kickoff_at <= p_at + interval '2 hours'
      AND match_row.status NOT IN ('cancelled', 'postponed')
  ),
  staged AS (
    SELECT
      base.*,
      CASE
        WHEN base.match_status = 'finished' THEN 'finished_pending_detail'
        WHEN base.match_status IN ('live', 'paused') THEN 'live'
        WHEN base.kickoff_at <= p_at
          OR base.kickoff_at <= p_at + make_interval(mins => base.imminent_window_minutes)
          THEN 'imminent'
        ELSE 'scheduled'
      END AS lifecycle_stage
    FROM base
  ),
  status_candidates AS (
    SELECT
      staged.*,
      CASE
        WHEN staged.match_status = 'finished'
          AND p_at >= staged.effective_end_at + interval '24 hours' THEN 'post24h'
        WHEN staged.match_status = 'finished'
          AND p_at >= staged.effective_end_at + interval '2 hours' THEN 'post2h'
        WHEN staged.match_status = 'finished'
          AND p_at >= staged.effective_end_at + interval '15 minutes' THEN 'post15m'
        WHEN staged.match_status IN ('live', 'paused')
          OR staged.kickoff_at <= p_at
          THEN format(
            'live-%s',
            floor(extract(epoch FROM p_at) / staged.live_poll_seconds)::bigint
          )
        ELSE format(
          'prematch-%s',
          floor(extract(epoch FROM p_at) / staged.prematch_poll_seconds)::bigint
        )
      END AS cadence_key,
      'match_status'::text AS resource,
      CASE staged.sport
        WHEN 'football' THEN 'football.MatchesController_getMatchById'
        WHEN 'baseball' THEN 'baseball.BaseballMatchController_getMatchById'
        WHEN 'basketball' THEN 'basketball.MatchesController_getMatchById'
      END AS endpoint_key,
      jsonb_build_object('id', staged.external_match_id) AS request_params,
      0 AS priority
    FROM staged
    WHERE (
      staged.match_status IN ('live', 'paused', 'finished')
      OR staged.kickoff_at <= p_at + interval '30 minutes'
    )
  ),
  lineup_candidates AS (
    SELECT
      staged.*,
      CASE
        WHEN staged.kickoff_at <= p_at + interval '30 minutes' THEN 't30m'
        ELSE 't2h'
      END AS cadence_key,
      'lineups'::text AS resource,
      CASE staged.sport
        WHEN 'football' THEN 'football.FootballLineupsController_getLineups'
        WHEN 'baseball' THEN 'baseball.BaseballLineupsController_getLineups'
      END AS endpoint_key,
      jsonb_build_object('matchId', staged.external_match_id) AS request_params,
      0 AS priority
    FROM staged
    WHERE staged.sport IN ('football', 'baseball')
      AND staged.match_status = 'scheduled'
      AND staged.kickoff_at > p_at
      AND staged.kickoff_at <= p_at + interval '2 hours'
  ),
  live_candidates AS (
    SELECT
      staged.*,
      format(
        'live-%s',
        floor(extract(epoch FROM p_at) / staged.live_poll_seconds)::bigint
      ) AS cadence_key,
      live_resource.resource,
      live_resource.endpoint_key,
      CASE
        WHEN live_resource.endpoint_key LIKE '%getStatistics'
          AND staged.sport IN ('football', 'basketball')
          THEN jsonb_build_object('matchId', staged.external_match_id)
        WHEN live_resource.endpoint_key LIKE '%getLineups'
          THEN jsonb_build_object('matchId', staged.external_match_id)
        ELSE jsonb_build_object('id', staged.external_match_id)
      END AS request_params,
      live_resource.priority
    FROM staged
    CROSS JOIN LATERAL (
      VALUES
        (
          'events'::text,
          CASE WHEN staged.sport = 'football'
            THEN 'football.FootballLiveEventsController_getLiveEvents' END,
          1
        ),
        (
          'match_statistics'::text,
          CASE staged.sport
            WHEN 'football' THEN 'football.FootballStatisticsController_getStatistics'
            WHEN 'baseball' THEN 'baseball.BaseballMatchStatisticsController_getStatistics'
            WHEN 'basketball' THEN 'basketball.BasketballStatisticsController_getStatistics'
          END,
          1
        ),
        (
          'box_scores'::text,
          CASE staged.sport
            WHEN 'football' THEN 'football.FootballPlayerBoxScoreController_getPlayerBoxScores'
            WHEN 'baseball' THEN 'baseball.BaseballBoxScoresController_getBoxScores'
          END,
          2
        )
    ) AS live_resource(resource, endpoint_key, priority)
    WHERE staged.match_status IN ('live', 'paused')
      AND live_resource.endpoint_key IS NOT NULL
  ),
  postgame_base AS (
    SELECT
      staged.*,
      CASE
        WHEN p_at >= staged.effective_end_at + interval '24 hours' THEN 'post24h'
        WHEN p_at >= staged.effective_end_at + interval '2 hours' THEN 'post2h'
        WHEN p_at >= staged.effective_end_at + interval '15 minutes' THEN 'post15m'
      END AS cadence_key
    FROM staged
    WHERE staged.match_status = 'finished'
      AND p_at >= staged.effective_end_at + interval '15 minutes'
      AND p_at <= staged.effective_end_at + interval '30 hours'
  ),
  postgame_candidates AS (
    SELECT
      postgame_base.*,
      post_resource.resource,
      post_resource.endpoint_key,
      CASE
        WHEN post_resource.resource = 'highlights'
          THEN jsonb_build_object(
            'matchId',
            postgame_base.external_match_id,
            'limit',
            10,
            'offset',
            0
          )
        WHEN post_resource.endpoint_key LIKE '%getStatistics'
          AND postgame_base.sport IN ('football', 'basketball')
          THEN jsonb_build_object('matchId', postgame_base.external_match_id)
        WHEN post_resource.endpoint_key LIKE '%getLineups'
          OR post_resource.endpoint_key LIKE '%getPlayerBoxScores'
          THEN jsonb_build_object('matchId', postgame_base.external_match_id)
        ELSE jsonb_build_object('id', postgame_base.external_match_id)
      END AS request_params,
      post_resource.priority
    FROM postgame_base
    CROSS JOIN LATERAL (
      VALUES
        (
          'events'::text,
          CASE WHEN postgame_base.sport = 'football'
            THEN 'football.FootballLiveEventsController_getLiveEvents' END,
          0
        ),
        (
          'match_statistics'::text,
          CASE postgame_base.sport
            WHEN 'football' THEN 'football.FootballStatisticsController_getStatistics'
            WHEN 'baseball' THEN 'baseball.BaseballMatchStatisticsController_getStatistics'
            WHEN 'basketball' THEN 'basketball.BasketballStatisticsController_getStatistics'
          END,
          0
        ),
        (
          'lineups'::text,
          CASE postgame_base.sport
            WHEN 'football' THEN 'football.FootballLineupsController_getLineups'
            WHEN 'baseball' THEN 'baseball.BaseballLineupsController_getLineups'
          END,
          1
        ),
        (
          'box_scores'::text,
          CASE postgame_base.sport
            WHEN 'football' THEN 'football.FootballPlayerBoxScoreController_getPlayerBoxScores'
            WHEN 'baseball' THEN 'baseball.BaseballBoxScoresController_getBoxScores'
          END,
          0
        ),
        (
          'highlights'::text,
          CASE postgame_base.sport
            WHEN 'football' THEN 'football.HighlightsController_getHighlights'
            WHEN 'baseball' THEN 'baseball.HighlightsController_getHighlights'
            WHEN 'basketball' THEN 'basketball.HighlightsController_getHighlights'
          END,
          3
        )
    ) AS post_resource(resource, endpoint_key, priority)
    LEFT JOIN public.hl_match_lifecycle_resources AS resource_state
      ON resource_state.match_id = postgame_base.match_id
     AND resource_state.resource = post_resource.resource
    WHERE post_resource.endpoint_key IS NOT NULL
      AND NOT (
        post_resource.resource = 'highlights'
        AND postgame_base.cadence_key = 'post15m'
      )
      AND resource_state.status IS DISTINCT FROM 'succeeded'
  ),
  all_candidates AS (
    SELECT * FROM status_candidates
    UNION ALL
    SELECT * FROM lineup_candidates
    UNION ALL
    SELECT * FROM live_candidates
    UNION ALL
    SELECT * FROM postgame_candidates
  ),
  identified AS (
    SELECT
      all_candidates.match_id,
      all_candidates.sport,
      all_candidates.external_match_id,
      all_candidates.kickoff_at,
      all_candidates.match_status,
      all_candidates.lifecycle_stage,
      all_candidates.cadence_key,
      all_candidates.resource,
      all_candidates.endpoint_key,
      all_candidates.request_params,
      format(
        'phase8e:lifecycle:%s:%s:%s:%s',
        all_candidates.sport,
        all_candidates.external_match_id,
        all_candidates.resource,
        all_candidates.cadence_key
      ) AS dedupe_key,
      all_candidates.priority
    FROM all_candidates
    WHERE all_candidates.cadence_key IS NOT NULL
  )
  SELECT
    identified.match_id,
    identified.sport,
    identified.external_match_id,
    identified.kickoff_at,
    identified.match_status,
    identified.lifecycle_stage,
    identified.cadence_key,
    identified.resource,
    identified.endpoint_key,
    identified.request_params,
    identified.dedupe_key,
    identified.priority
  FROM identified
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.hl_ingestion_jobs AS ingestion_job
    WHERE ingestion_job.dedupe_key = identified.dedupe_key
  )
  ORDER BY
    identified.priority,
    identified.kickoff_at,
    identified.sport,
    identified.external_match_id,
    identified.resource
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1000), 3000));
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_match_lifecycle_candidates(
  timestamptz,
  integer,
  boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_highlightly_match_lifecycle_candidates(
  timestamptz,
  integer,
  boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_highlightly_match_lifecycle_states(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  affected_rows integer := 0;
BEGIN
  WITH provider AS (
    SELECT sports_provider.id
    FROM public.sports_providers AS sports_provider
    WHERE sports_provider.code = 'highlightly'
    LIMIT 1
  ),
  eligible AS (
    SELECT
      match_row.id AS match_id,
      provider.id AS provider_id,
      match_row.sport_id,
      provider_entity.external_id AS external_match_id,
      match_row.kickoff_at,
      match_row.status AS match_status,
      match_row.provider_status,
      match_row.ended_at,
      lifecycle_policy.imminent_window_minutes,
      lifecycle_policy.live_poll_seconds,
      lifecycle_policy.prematch_poll_seconds,
      lifecycle_policy.required_resources,
      prior_state.lifecycle_stage AS prior_stage
    FROM public.sports_matches AS match_row
    JOIN public.sports AS sport
      ON sport.id = match_row.sport_id
    JOIN public.hl_match_lifecycle_policies AS lifecycle_policy
      ON lifecycle_policy.sport_id = match_row.sport_id
    JOIN provider
      ON true
    JOIN public.sports_provider_entities AS provider_entity
      ON provider_entity.provider_id = provider.id
     AND provider_entity.sport_id = match_row.sport_id
     AND provider_entity.entity_type = 'match'
     AND provider_entity.canonical_id = match_row.id
    LEFT JOIN public.hl_match_lifecycle_states AS prior_state
      ON prior_state.match_id = match_row.id
    WHERE sport.code IN ('football', 'baseball', 'basketball')
      AND match_row.kickoff_at >= p_at - interval '36 hours'
      AND match_row.kickoff_at <= p_at + interval '2 hours'
  ),
  assessed AS (
    SELECT
      eligible.*,
      COALESCE(
        ARRAY(
          SELECT required_resource
          FROM unnest(eligible.required_resources) AS required_resource
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.hl_match_lifecycle_resources AS resource_state
            WHERE resource_state.match_id = eligible.match_id
              AND resource_state.resource = required_resource
              AND resource_state.status = 'succeeded'
          )
          ORDER BY required_resource
        ),
        '{}'::text[]
      ) AS missing_resources,
      COALESCE(
        bool_and(
          EXISTS (
            SELECT 1
            FROM public.hl_match_lifecycle_resources AS resource_state
            WHERE resource_state.match_id = eligible.match_id
              AND resource_state.resource = required_resource
              AND resource_state.status IN (
                'succeeded',
                'dead',
                'provider_unavailable',
                'quality_rejected',
                'not_supported'
              )
          )
        ),
        false
      ) AS all_resources_terminal
    FROM eligible
    LEFT JOIN LATERAL unnest(eligible.required_resources) AS required_resource
      ON true
    GROUP BY
      eligible.match_id,
      eligible.provider_id,
      eligible.sport_id,
      eligible.external_match_id,
      eligible.kickoff_at,
      eligible.match_status,
      eligible.provider_status,
      eligible.ended_at,
      eligible.imminent_window_minutes,
      eligible.live_poll_seconds,
      eligible.prematch_poll_seconds,
      eligible.required_resources,
      eligible.prior_stage
  ),
  prepared AS (
    SELECT
      assessed.*,
      CASE
        WHEN assessed.prior_stage = 'quarantined' THEN 'quarantined'
        WHEN assessed.match_status IN ('cancelled', 'postponed') THEN 'terminal'
        WHEN assessed.match_status = 'finished'
          AND cardinality(assessed.missing_resources) = 0 THEN 'complete'
        WHEN assessed.match_status = 'finished'
          AND assessed.all_resources_terminal THEN 'complete_with_exceptions'
        WHEN assessed.match_status = 'finished' THEN 'finished_pending_detail'
        WHEN assessed.match_status IN ('live', 'paused') THEN 'live'
        WHEN assessed.kickoff_at <= p_at + make_interval(
          mins => assessed.imminent_window_minutes
        ) THEN 'imminent'
        ELSE 'scheduled'
      END AS lifecycle_stage
    FROM assessed
  )
  INSERT INTO public.hl_match_lifecycle_states (
    match_id,
    provider_id,
    sport_id,
    external_match_id,
    lifecycle_stage,
    kickoff_at,
    last_provider_status,
    last_polled_at,
    next_poll_at,
    final_observed_at,
    completed_at,
    missing_resources,
    metadata
  )
  SELECT
    prepared.match_id,
    prepared.provider_id,
    prepared.sport_id,
    prepared.external_match_id,
    prepared.lifecycle_stage,
    prepared.kickoff_at,
    COALESCE(prepared.provider_status, prepared.match_status),
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.hl_match_lifecycle_resources AS resource_state
        WHERE resource_state.match_id = prepared.match_id
          AND resource_state.last_attempted_at IS NOT NULL
      )
      THEN (
        SELECT max(resource_state.last_attempted_at)
        FROM public.hl_match_lifecycle_resources AS resource_state
        WHERE resource_state.match_id = prepared.match_id
      )
    END,
    CASE prepared.lifecycle_stage
      WHEN 'scheduled' THEN prepared.kickoff_at - make_interval(
        mins => prepared.imminent_window_minutes
      )
      WHEN 'imminent' THEN p_at + make_interval(
        secs => prepared.prematch_poll_seconds
      )
      WHEN 'live' THEN p_at + make_interval(secs => prepared.live_poll_seconds)
      WHEN 'finished_pending_detail' THEN p_at + interval '30 minutes'
      ELSE NULL
    END,
    CASE WHEN prepared.match_status = 'finished'
      THEN COALESCE(prepared.ended_at, p_at) END,
    CASE WHEN prepared.lifecycle_stage IN (
      'complete',
      'complete_with_exceptions',
      'terminal'
    ) THEN p_at END,
    prepared.missing_resources,
    jsonb_build_object('phase', '8E')
  FROM prepared
  ON CONFLICT (match_id) DO UPDATE SET
    external_match_id = EXCLUDED.external_match_id,
    lifecycle_stage = EXCLUDED.lifecycle_stage,
    kickoff_at = EXCLUDED.kickoff_at,
    last_provider_status = EXCLUDED.last_provider_status,
    last_polled_at = COALESCE(
      EXCLUDED.last_polled_at,
      public.hl_match_lifecycle_states.last_polled_at
    ),
    next_poll_at = EXCLUDED.next_poll_at,
    final_observed_at = COALESCE(
      public.hl_match_lifecycle_states.final_observed_at,
      EXCLUDED.final_observed_at
    ),
    completed_at = COALESCE(
      public.hl_match_lifecycle_states.completed_at,
      EXCLUDED.completed_at
    ),
    missing_resources = EXCLUDED.missing_resources,
    metadata = public.hl_match_lifecycle_states.metadata || EXCLUDED.metadata,
    updated_at = now();

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'refreshed_at', p_at,
    'matches_affected', affected_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_highlightly_match_lifecycle_states(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_highlightly_match_lifecycle_states(timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_highlightly_match_lifecycle_report(
  p_from timestamptz DEFAULT now() - interval '12 hours',
  p_to timestamptz DEFAULT now() + interval '36 hours'
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
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from
     OR p_to > p_from + interval '7 days' THEN
    RAISE EXCEPTION 'lifecycle report interval must be greater than zero and at most seven days'
      USING ERRCODE = '22023';
  END IF;

  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Highlightly lifecycle report requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  WITH participant_names AS (
    SELECT
      participant.match_id,
      max(team.name) FILTER (WHERE participant.role = 'home') AS home_team_name,
      max(team.name) FILTER (WHERE participant.role = 'away') AS away_team_name
    FROM public.sports_match_participants AS participant
    JOIN public.sports_teams AS team
      ON team.id = participant.team_id
    GROUP BY participant.match_id
  ),
  states AS (
    SELECT
      lifecycle_state.*,
      sport.code AS sport,
      competition.name AS competition_name,
      participant_names.home_team_name,
      participant_names.away_team_name
    FROM public.hl_match_lifecycle_states AS lifecycle_state
    JOIN public.sports AS sport
      ON sport.id = lifecycle_state.sport_id
    JOIN public.sports_matches AS match_row
      ON match_row.id = lifecycle_state.match_id
    LEFT JOIN public.sports_competitions AS competition
      ON competition.id = match_row.competition_id
    LEFT JOIN participant_names
      ON participant_names.match_id = lifecycle_state.match_id
    WHERE lifecycle_state.kickoff_at >= p_from
      AND lifecycle_state.kickoff_at < p_to
  ),
  by_stage AS (
    SELECT
      states.sport,
      states.lifecycle_stage,
      count(*)::integer AS matches
    FROM states
    GROUP BY states.sport, states.lifecycle_stage
  ),
  by_resource AS (
    SELECT
      states.sport,
      resource_state.resource,
      resource_state.status,
      count(*)::integer AS matches
    FROM states
    JOIN public.hl_match_lifecycle_resources AS resource_state
      ON resource_state.match_id = states.match_id
    GROUP BY states.sport, resource_state.resource, resource_state.status
  ),
  policy_rows AS (
    SELECT
      sport.code AS sport,
      lifecycle_policy.enabled,
      lifecycle_policy.imminent_window_minutes,
      lifecycle_policy.prematch_poll_seconds,
      lifecycle_policy.live_poll_seconds,
      lifecycle_policy.postgame_horizons_minutes,
      lifecycle_policy.required_resources,
      lifecycle_policy.optional_resources
    FROM public.hl_match_lifecycle_policies AS lifecycle_policy
    JOIN public.sports AS sport
      ON sport.id = lifecycle_policy.sport_id
    ORDER BY sport.code
  )
  SELECT jsonb_build_object(
    'generated_at', statement_timestamp(),
    'from', p_from,
    'to', p_to,
    'policies', COALESCE((
      SELECT jsonb_agg(to_jsonb(policy_rows))
      FROM policy_rows
    ), '[]'::jsonb),
    'by_stage', COALESCE((
      SELECT jsonb_agg(to_jsonb(by_stage) ORDER BY by_stage.sport, by_stage.lifecycle_stage)
      FROM by_stage
    ), '[]'::jsonb),
    'by_resource', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(by_resource)
        ORDER BY by_resource.sport, by_resource.resource, by_resource.status
      )
      FROM by_resource
    ), '[]'::jsonb),
    'matches', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'match_id', states.match_id,
          'sport', states.sport,
          'external_match_id', states.external_match_id,
          'kickoff_at', states.kickoff_at,
          'stage', states.lifecycle_stage,
          'provider_status', states.last_provider_status,
          'competition_name', states.competition_name,
          'home_team_name', states.home_team_name,
          'away_team_name', states.away_team_name,
          'missing_resources', states.missing_resources,
          'last_polled_at', states.last_polled_at,
          'next_poll_at', states.next_poll_at,
          'updated_at', states.updated_at
        )
        ORDER BY states.kickoff_at, states.sport, states.external_match_id
      )
      FROM (
        SELECT *
        FROM states
        ORDER BY kickoff_at, sport, external_match_id
        LIMIT 500
      ) AS states
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_highlightly_match_lifecycle_report(
  timestamptz,
  timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_highlightly_match_lifecycle_report(
  timestamptz,
  timestamptz
) TO authenticated, service_role;

COMMENT ON TABLE public.hl_match_lifecycle_policies IS
  'Phase 8E per-sport lifecycle cadence and resource policy; disabled by default.';
COMMENT ON TABLE public.hl_match_lifecycle_states IS
  'Current lifecycle and completeness state for canonical Highlightly matches.';
COMMENT ON TABLE public.hl_match_lifecycle_resources IS
  'Latest terminal or active collection state for each match resource.';
COMMENT ON FUNCTION public.get_highlightly_match_lifecycle_candidates(
  timestamptz,
  integer,
  boolean
) IS
  'Returns idempotent prematch, live and postgame resource jobs; service_role only.';
COMMENT ON FUNCTION public.refresh_highlightly_match_lifecycle_states(timestamptz) IS
  'Reconciles match lifecycle stage and required-resource completeness; service_role only.';
COMMENT ON FUNCTION public.get_highlightly_match_lifecycle_report(
  timestamptz,
  timestamptz
) IS
  'Returns the admin-gated Phase 8E lifecycle and completeness monitor.';