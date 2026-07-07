
-- Add telegram_chat_id to profiles so each user can register their Telegram chat
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- Alerts table for Critical Validation pre-match Telegram notifications
CREATE TABLE IF NOT EXISTS public.validacao_critica_telegram_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Link to the pending Critical Validation source (prognosticos in this phase)
  critical_validation_id uuid NULL,
  source_table text NULL,
  source_record_id uuid NULL,

  -- Event data
  sport text,
  league text,
  event_date date,
  event_time text,
  event_start_at timestamptz,
  alert_target_at timestamptz,
  home_team text,
  away_team text,
  matchup text,
  market text,
  pick text,
  line text,
  odd numeric,

  -- Status
  status text NOT NULL DEFAULT 'pending',

  -- Telegram
  telegram_chat_id text NULL,
  telegram_message_id text NULL,
  telegram_sent_at timestamptz NULL,
  telegram_error text NULL,

  -- Control
  alert_minutes_before integer NOT NULL DEFAULT 30,
  alert_enabled boolean NOT NULL DEFAULT true,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz NULL,
  next_retry_at timestamptz NULL,
  dedupe_hash text,

  -- Payloads
  alert_payload jsonb,
  source_payload jsonb,
  metadata jsonb,

  CONSTRAINT validacao_critica_telegram_alerts_status_check
    CHECK (status IN ('pending','sent','failed','skipped','expired','cancelled')),
  CONSTRAINT validacao_critica_telegram_alerts_user_dedupe_uq
    UNIQUE (user_id, dedupe_hash)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.validacao_critica_telegram_alerts TO authenticated;
GRANT ALL ON public.validacao_critica_telegram_alerts TO service_role;

ALTER TABLE public.validacao_critica_telegram_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vc_tg_alerts_select_own"
  ON public.validacao_critica_telegram_alerts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "vc_tg_alerts_insert_own"
  ON public.validacao_critica_telegram_alerts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vc_tg_alerts_update_own"
  ON public.validacao_critica_telegram_alerts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vc_tg_alerts_delete_own"
  ON public.validacao_critica_telegram_alerts
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_vc_tg_alerts_touch_updated_at
  BEFORE UPDATE ON public.validacao_critica_telegram_alerts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Helpful indexes for the cron job scan
CREATE INDEX IF NOT EXISTS idx_vc_tg_alerts_status_target
  ON public.validacao_critica_telegram_alerts (status, alert_target_at);
CREATE INDEX IF NOT EXISTS idx_vc_tg_alerts_user_created
  ON public.validacao_critica_telegram_alerts (user_id, created_at DESC);
