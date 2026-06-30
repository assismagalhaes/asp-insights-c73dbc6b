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

  status text NOT NULL CHECK (status IN (
    'created',
    'sent_to_validator',
    'applied_in_validator',
    'discarded',
    'expired',
    'validation_started',
    'validation_completed',
    'validation_failed'
  )),

  sent_at timestamptz,
  applied_at timestamptz,
  discarded_at timestamptz,
  expires_at timestamptz,
  validation_started_at timestamptz,
  validation_completed_at timestamptz,

  game_id text,
  event_date date,
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

  validator_record_id uuid REFERENCES public.asp_validator_registros(id) ON DELETE SET NULL,
  validator_decision text,
  validator_adjusted_probability numeric,
  validator_final_ev numeric,
  validator_reason text,

  opportunity_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  critical_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  handoff_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validator_context_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE (user_id, handoff_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_validator_handoffs TO authenticated;
GRANT ALL ON public.asp_screener_validator_handoffs TO service_role;

CREATE INDEX IF NOT EXISTS idx_asp_screener_validator_handoffs_user_created
  ON public.asp_screener_validator_handoffs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asp_screener_validator_handoffs_status
  ON public.asp_screener_validator_handoffs (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asp_screener_validator_handoffs_validator_record
  ON public.asp_screener_validator_handoffs (validator_record_id);

ALTER TABLE public.asp_screener_validator_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asp_screener_handoffs_select_own"
  ON public.asp_screener_validator_handoffs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "asp_screener_handoffs_insert_own"
  ON public.asp_screener_validator_handoffs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "asp_screener_handoffs_update_own"
  ON public.asp_screener_validator_handoffs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "asp_screener_handoffs_delete_own"
  ON public.asp_screener_validator_handoffs FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_asp_screener_validator_handoffs_updated
  BEFORE UPDATE ON public.asp_screener_validator_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';
