CREATE TABLE IF NOT EXISTS public.opportunity_ranking_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  source_stage text NOT NULL DEFAULT 'post_ai_final',
  status text NOT NULL DEFAULT 'draft',
  max_final_picks integer NOT NULL DEFAULT 3,
  candidate_count integer NOT NULL DEFAULT 0,
  confirmed_ia_count integer NOT NULL DEFAULT 0,
  top_final_count integer NOT NULL DEFAULT 0,
  filters_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_ranking_runs_status_check
    CHECK (status IN ('draft','computed','applied','archived')),
  CONSTRAINT opportunity_ranking_runs_source_stage_check
    CHECK (source_stage IN ('pre_ai_shortlist','post_ai_final','manual')),
  CONSTRAINT opportunity_ranking_runs_max_final_picks_check
    CHECK (max_final_picks BETWEEN 0 AND 10),
  CONSTRAINT opportunity_ranking_runs_user_date_stage_uq
    UNIQUE (user_id, run_date, source_stage)
);

CREATE TABLE IF NOT EXISTS public.opportunity_ranking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.opportunity_ranking_runs(id) ON DELETE CASCADE,
  prognostico_id uuid NOT NULL REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  event_key text NOT NULL,
  group_key text NOT NULL,
  rank_prelim integer,
  rank_final integer,
  ranking_status text NOT NULL DEFAULT 'CANDIDATA',
  opportunity_score_pre numeric,
  opportunity_score_final numeric,
  confidence_score numeric,
  ai_decision text,
  ai_stake_suggested numeric,
  final_stake numeric,
  matchup_preview_context text,
  matchup_preview_status text NOT NULL DEFAULT 'not_requested',
  score_components jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_ranking_items_status_check
    CHECK (ranking_status IN ('CANDIDATA','CONFIRMA_IA','TOP_FINAL','RESERVA','PULAR','BLOQUEADA')),
  CONSTRAINT opportunity_ranking_items_preview_status_check
    CHECK (matchup_preview_status IN ('not_requested','queued','loaded','missing','error')),
  CONSTRAINT opportunity_ranking_items_run_prognostico_uq
    UNIQUE (run_id, prognostico_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_ranking_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_ranking_items TO authenticated;
GRANT ALL ON public.opportunity_ranking_runs TO service_role;
GRANT ALL ON public.opportunity_ranking_items TO service_role;

ALTER TABLE public.opportunity_ranking_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_ranking_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opportunity_ranking_runs_select_own"
  ON public.opportunity_ranking_runs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "opportunity_ranking_runs_insert_own"
  ON public.opportunity_ranking_runs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "opportunity_ranking_runs_update_own"
  ON public.opportunity_ranking_runs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "opportunity_ranking_runs_delete_own"
  ON public.opportunity_ranking_runs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "opportunity_ranking_items_select_own"
  ON public.opportunity_ranking_items
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "opportunity_ranking_items_insert_own"
  ON public.opportunity_ranking_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
    AND EXISTS (
      SELECT 1
      FROM public.opportunity_ranking_runs r
      WHERE r.id = opportunity_ranking_items.run_id
        AND (r.user_id = opportunity_ranking_items.user_id OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "opportunity_ranking_items_update_own"
  ON public.opportunity_ranking_items
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "opportunity_ranking_items_delete_own"
  ON public.opportunity_ranking_items
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_opp_rank_runs_user_date
  ON public.opportunity_ranking_runs (user_id, run_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_opp_rank_runs_status
  ON public.opportunity_ranking_runs (status, run_date DESC);

CREATE INDEX IF NOT EXISTS idx_opp_rank_items_run_status
  ON public.opportunity_ranking_items (run_id, ranking_status, rank_final);

CREATE INDEX IF NOT EXISTS idx_opp_rank_items_prognostico
  ON public.opportunity_ranking_items (prognostico_id);

CREATE INDEX IF NOT EXISTS idx_opp_rank_items_user_created
  ON public.opportunity_ranking_items (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_opp_rank_items_event_group
  ON public.opportunity_ranking_items (run_id, event_key, group_key);

CREATE TRIGGER trg_opp_rank_runs_touch_updated_at
  BEFORE UPDATE ON public.opportunity_ranking_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_opp_rank_items_touch_updated_at
  BEFORE UPDATE ON public.opportunity_ranking_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();