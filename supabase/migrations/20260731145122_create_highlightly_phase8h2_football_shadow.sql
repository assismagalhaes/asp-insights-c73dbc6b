-- Highlightly Phase 8H.2: MatchMatrix canary. Shadow-only by construction.
CREATE TABLE public.football_model_shadow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL UNIQUE REFERENCES public.model_input_builds(id) ON DELETE RESTRICT,
  traditional_job_id text,
  model_name text NOT NULL DEFAULT 'ASP MatchMatrix',
  model_version text NOT NULL DEFAULT 'FOOTBALL_V1_5',
  run_mode text NOT NULL DEFAULT 'shadow' CHECK (run_mode = 'shadow'),
  automatic_publication boolean NOT NULL DEFAULT false CHECK (NOT automatic_publication),
  central_result jsonb NOT NULL CHECK (jsonb_typeof(central_result) = 'object'),
  traditional_result jsonb CHECK (traditional_result IS NULL OR jsonb_typeof(traditional_result) = 'object'),
  comparison jsonb NOT NULL CHECK (jsonb_typeof(comparison) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX football_model_shadow_runs_created_idx
  ON public.football_model_shadow_runs (created_at DESC, id);

CREATE OR REPLACE FUNCTION public.reject_football_shadow_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'football shadow runs are immutable';
END;
$$;

CREATE TRIGGER football_model_shadow_runs_immutable
BEFORE UPDATE OR DELETE ON public.football_model_shadow_runs
FOR EACH ROW EXECUTE FUNCTION public.reject_football_shadow_mutation_v1();

CREATE OR REPLACE FUNCTION public.get_football_model_input_candidates_v1(
  p_target_date date
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH latest_consensus AS (
  SELECT DISTINCT ON (
    consensus.match_id, consensus.market_definition_id,
    consensus.selection_key, consensus.line_key
  )
    consensus.*
  FROM public.sports_odds_consensus AS consensus
  WHERE NOT consensus.is_live
  ORDER BY consensus.match_id, consensus.market_definition_id,
    consensus.selection_key, consensus.line_key, consensus.snapshot_at DESC
),
participants AS (
  SELECT
    participant.match_id,
    max(team.name) FILTER (WHERE participant.role = 'home') AS home,
    max(team.name) FILTER (WHERE participant.role = 'away') AS away
  FROM public.sports_match_participants AS participant
  JOIN public.sports_teams AS team ON team.id = participant.team_id
  GROUP BY participant.match_id
),
candidates AS (
  SELECT
    match.id AS match_id,
    (match.kickoff_at AT TIME ZONE 'America/Sao_Paulo')::date AS match_date,
    to_char(match.kickoff_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS match_time,
    country.name AS country,
    competition.name AS league,
    participants.home,
    participants.away,
    definition.id AS market_definition_id,
    definition.canonical_family AS market_family,
    consensus.selection_key,
    consensus.selection_name,
    consensus.line_key,
    consensus.line_value,
    consensus.median_odds,
    consensus.best_odds,
    consensus.bookmaker_count,
    consensus.snapshot_at,
    best_bookmaker.name AS best_bookmaker
  FROM public.sports_matches AS match
  JOIN public.sports AS sport ON sport.id = match.sport_id AND sport.code = 'football'
  JOIN participants ON participants.match_id = match.id
  LEFT JOIN public.sports_competitions AS competition ON competition.id = match.competition_id
  LEFT JOIN public.sports_countries AS country ON country.id = competition.country_id
  JOIN latest_consensus AS consensus ON consensus.match_id = match.id
  JOIN public.sports_market_definitions AS definition
    ON definition.id = consensus.market_definition_id
   AND definition.odds_type = 'prematch'
   AND definition.is_active
   AND definition.canonical_family IN ('moneyline', 'total', 'both_teams_to_score', 'handicap')
  LEFT JOIN LATERAL (
    SELECT bookmaker.name
    FROM public.sports_odds_current AS quote
    JOIN public.sports_bookmakers AS bookmaker ON bookmaker.id = quote.bookmaker_id
    WHERE quote.match_id = consensus.match_id
      AND quote.market_definition_id = consensus.market_definition_id
      AND quote.selection_key = consensus.selection_key
      AND quote.line_key = consensus.line_key
      AND NOT quote.is_live
      AND quote.quote_status = 'open'
      AND quote.decimal_odds = consensus.best_odds
    ORDER BY bookmaker.is_preferred DESC, bookmaker.name
    LIMIT 1
  ) AS best_bookmaker ON true
  WHERE match.kickoff_at IS NOT NULL
    AND (match.kickoff_at AT TIME ZONE 'America/Sao_Paulo')::date = p_target_date
    AND match.status IN ('scheduled', 'live', 'paused')
    AND consensus.bookmaker_count >= 2
)
SELECT jsonb_build_object(
  'target_date', p_target_date,
  'mode', 'shadow',
  'automatic_publication', false,
  'candidates', COALESCE(jsonb_agg(to_jsonb(candidates) ORDER BY match_time, match_id, market_family, selection_key, line_key), '[]'::jsonb)
)
FROM candidates;
$$;

CREATE OR REPLACE FUNCTION public.record_football_shadow_run_v1(
  p_build_id uuid,
  p_traditional_job_id text,
  p_central_result jsonb,
  p_traditional_result jsonb,
  p_comparison jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE saved_id uuid;
BEGIN
  IF COALESCE(p_comparison ->> 'mode', '') <> 'shadow'
     OR COALESCE((p_comparison ->> 'automatic_publication')::boolean, true) THEN
    RAISE EXCEPTION '8H.2 accepts shadow comparisons only';
  END IF;
  INSERT INTO public.football_model_shadow_runs (
    build_id, traditional_job_id, central_result, traditional_result, comparison
  ) VALUES (
    p_build_id, NULLIF(trim(p_traditional_job_id), ''), p_central_result,
    p_traditional_result, p_comparison
  ) RETURNING id INTO saved_id;
  RETURN saved_id;
END;
$$;

ALTER TABLE public.football_model_shadow_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.football_model_shadow_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.football_model_shadow_runs TO authenticated;
GRANT SELECT, INSERT ON public.football_model_shadow_runs TO service_role;

CREATE POLICY football_model_shadow_runs_admin_read
ON public.football_model_shadow_runs FOR SELECT TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

REVOKE ALL ON FUNCTION public.reject_football_shadow_mutation_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_football_model_input_candidates_v1(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_football_model_input_candidates_v1(date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_football_shadow_run_v1(uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_football_shadow_run_v1(uuid,text,jsonb,jsonb,jsonb) TO service_role;
