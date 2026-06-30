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

  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'completed', 'failed', 'partially_completed')),
  execution_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE (user_id, snapshot_date, run_id)
);

CREATE TABLE IF NOT EXISTS public.asp_screener_mlb_opportunity_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  daily_snapshot_id uuid NOT NULL REFERENCES public.asp_screener_mlb_daily_snapshots(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  opportunity_id text NOT NULL,

  game_id text,
  event_date date,
  event_time text,
  home_team text,
  away_team text,
  matchup text,

  market_family text CHECK (market_family IS NULL OR market_family IN ('moneyline', 'totals', 'handicap')),
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
  validator_record_id uuid REFERENCES public.asp_validator_registros(id) ON DELETE SET NULL,
  validator_decision text,

  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  alerts jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_projection_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  opportunity_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE (user_id, run_id, opportunity_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_mlb_daily_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_mlb_opportunity_snapshots TO authenticated;
GRANT ALL ON public.asp_screener_mlb_daily_snapshots TO service_role;
GRANT ALL ON public.asp_screener_mlb_opportunity_snapshots TO service_role;

CREATE INDEX IF NOT EXISTS idx_asp_screener_mlb_daily_user_created
  ON public.asp_screener_mlb_daily_snapshots (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asp_screener_mlb_daily_date
  ON public.asp_screener_mlb_daily_snapshots (user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_asp_screener_mlb_opp_daily
  ON public.asp_screener_mlb_opportunity_snapshots (daily_snapshot_id, rank);
CREATE INDEX IF NOT EXISTS idx_asp_screener_mlb_opp_run
  ON public.asp_screener_mlb_opportunity_snapshots (user_id, run_id);
CREATE INDEX IF NOT EXISTS idx_asp_screener_mlb_opp_handoff
  ON public.asp_screener_mlb_opportunity_snapshots (handoff_id);

ALTER TABLE public.asp_screener_mlb_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asp_screener_mlb_opportunity_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asp_screener_mlb_daily_select_own"
  ON public.asp_screener_mlb_daily_snapshots FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "asp_screener_mlb_daily_insert_own"
  ON public.asp_screener_mlb_daily_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "asp_screener_mlb_daily_update_own"
  ON public.asp_screener_mlb_daily_snapshots FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "asp_screener_mlb_daily_delete_own"
  ON public.asp_screener_mlb_daily_snapshots FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "asp_screener_mlb_opp_select_own"
  ON public.asp_screener_mlb_opportunity_snapshots FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "asp_screener_mlb_opp_insert_own"
  ON public.asp_screener_mlb_opportunity_snapshots FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.asp_screener_mlb_daily_snapshots d
      WHERE d.id = asp_screener_mlb_opportunity_snapshots.daily_snapshot_id
        AND d.user_id = auth.uid()
    )
  );
CREATE POLICY "asp_screener_mlb_opp_update_own"
  ON public.asp_screener_mlb_opportunity_snapshots FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "asp_screener_mlb_opp_delete_own"
  ON public.asp_screener_mlb_opportunity_snapshots FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_asp_screener_mlb_daily_updated
  BEFORE UPDATE ON public.asp_screener_mlb_daily_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_asp_screener_mlb_opp_updated
  BEFORE UPDATE ON public.asp_screener_mlb_opportunity_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';
