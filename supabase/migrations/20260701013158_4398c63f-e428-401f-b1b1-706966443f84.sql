
-- 1) asp_screener_validator_handoffs
CREATE TABLE IF NOT EXISTS public.asp_screener_validator_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  handoff_id text NOT NULL,
  handoff_version text,
  source_module text NOT NULL DEFAULT 'asp_screener',
  source_sport text NOT NULL DEFAULT 'baseball',
  source_league text NOT NULL DEFAULT 'MLB',
  source_stage text,
  status text NOT NULL DEFAULT 'created',
  sent_at timestamptz,
  applied_at timestamptz,
  discarded_at timestamptz,
  expires_at timestamptz,
  validation_started_at timestamptz,
  validation_completed_at timestamptz,
  game_id text,
  event_date text,
  event_time text,
  home_team text,
  away_team text,
  matchup text,
  market text,
  pick text,
  line text,
  odd numeric,
  bookmaker text,
  model_probability numeric,
  market_probability_no_vig numeric,
  fair_odd numeric,
  ev numeric,
  opportunity_score numeric,
  confidence_score numeric,
  priority_status text,
  readiness_status text,
  alignment_status text,
  alignment_score numeric,
  validator_record_id uuid,
  validator_decision text,
  validator_adjusted_probability numeric,
  validator_final_ev numeric,
  validator_reason text,
  opportunity_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  critical_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  handoff_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validator_context_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT asp_screener_validator_handoffs_handoff_id_user_unique UNIQUE (user_id, handoff_id)
);

CREATE INDEX IF NOT EXISTS idx_asp_handoffs_user_created ON public.asp_screener_validator_handoffs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asp_handoffs_handoff_id ON public.asp_screener_validator_handoffs (handoff_id);
CREATE INDEX IF NOT EXISTS idx_asp_handoffs_status ON public.asp_screener_validator_handoffs (status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_validator_handoffs TO authenticated;
GRANT ALL ON public.asp_screener_validator_handoffs TO service_role;

ALTER TABLE public.asp_screener_validator_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own handoffs" ON public.asp_screener_validator_handoffs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own handoffs" ON public.asp_screener_validator_handoffs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own handoffs" ON public.asp_screener_validator_handoffs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own handoffs" ON public.asp_screener_validator_handoffs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_asp_handoffs_updated_at
  BEFORE UPDATE ON public.asp_screener_validator_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- 2) asp_screener_mlb_daily_snapshots
CREATE TABLE IF NOT EXISTS public.asp_screener_mlb_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  snapshot_date date NOT NULL,
  run_id text NOT NULL,
  season integer,
  source_module text NOT NULL DEFAULT 'asp_screener',
  source_sport text NOT NULL DEFAULT 'baseball',
  source_league text NOT NULL DEFAULT 'MLB',
  odds_rows_count integer,
  games_count integer,
  standings_snapshot_date date,
  standings_source text,
  moneyline_rows_count integer,
  totals_rows_count integer,
  handicap_rows_count integer,
  unified_opportunities_count integer,
  shortlist_primary_count integer,
  analyze_count integer,
  monitor_count integer,
  skip_count integer,
  missing_data_count integer,
  unsupported_line_count integer,
  status text NOT NULL DEFAULT 'created',
  execution_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT asp_daily_snapshots_run_unique UNIQUE (user_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_asp_daily_user_date ON public.asp_screener_mlb_daily_snapshots (user_id, snapshot_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_mlb_daily_snapshots TO authenticated;
GRANT ALL ON public.asp_screener_mlb_daily_snapshots TO service_role;

ALTER TABLE public.asp_screener_mlb_daily_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own daily snapshots" ON public.asp_screener_mlb_daily_snapshots
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own daily snapshots" ON public.asp_screener_mlb_daily_snapshots
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own daily snapshots" ON public.asp_screener_mlb_daily_snapshots
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own daily snapshots" ON public.asp_screener_mlb_daily_snapshots
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_asp_daily_snapshots_updated_at
  BEFORE UPDATE ON public.asp_screener_mlb_daily_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- 3) asp_screener_mlb_opportunity_snapshots
CREATE TABLE IF NOT EXISTS public.asp_screener_mlb_opportunity_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  daily_snapshot_id uuid NOT NULL REFERENCES public.asp_screener_mlb_daily_snapshots(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  opportunity_id text NOT NULL,
  game_id text,
  event_date text,
  event_time text,
  home_team text,
  away_team text,
  matchup text,
  market_family text,
  market_label text,
  pick_label text,
  selection_team text,
  side text,
  line text,
  line_type text,
  is_main_line boolean,
  distance_from_main_line numeric,
  offered_odd numeric,
  bookmaker text,
  market_prob_no_vig numeric,
  model_prob numeric,
  probability_edge numeric,
  fair_odd numeric,
  ev numeric,
  opportunity_score numeric,
  confidence_score numeric,
  priority_status text,
  base_candidate_status text,
  projection_status text,
  rank integer,
  is_primary_shortlist boolean,
  correlation_group_id text,
  correlation_status text,
  correlated_with text,
  sent_to_validator boolean NOT NULL DEFAULT false,
  handoff_id text,
  validator_record_id uuid,
  validator_decision text,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  alerts jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_projection_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  opportunity_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_asp_opp_snap_daily ON public.asp_screener_mlb_opportunity_snapshots (daily_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_asp_opp_snap_run ON public.asp_screener_mlb_opportunity_snapshots (run_id);
CREATE INDEX IF NOT EXISTS idx_asp_opp_snap_opportunity ON public.asp_screener_mlb_opportunity_snapshots (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_asp_opp_snap_handoff ON public.asp_screener_mlb_opportunity_snapshots (handoff_id);
CREATE INDEX IF NOT EXISTS idx_asp_opp_snap_user_created ON public.asp_screener_mlb_opportunity_snapshots (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_mlb_opportunity_snapshots TO authenticated;
GRANT ALL ON public.asp_screener_mlb_opportunity_snapshots TO service_role;

ALTER TABLE public.asp_screener_mlb_opportunity_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own opportunity snapshots" ON public.asp_screener_mlb_opportunity_snapshots
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own opportunity snapshots" ON public.asp_screener_mlb_opportunity_snapshots
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own opportunity snapshots" ON public.asp_screener_mlb_opportunity_snapshots
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own opportunity snapshots" ON public.asp_screener_mlb_opportunity_snapshots
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_asp_opp_snap_updated_at
  BEFORE UPDATE ON public.asp_screener_mlb_opportunity_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
