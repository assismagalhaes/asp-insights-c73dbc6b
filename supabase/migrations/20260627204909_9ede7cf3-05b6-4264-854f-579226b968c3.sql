-- Tabela principal de registros do ASP Validator
CREATE TABLE IF NOT EXISTS public.asp_validator_registros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source_platform text NOT NULL,
  sport text NOT NULL,
  league text,
  match_date date,
  home_team text NOT NULL,
  away_team text NOT NULL,
  market text NOT NULL,
  pick text NOT NULL,
  line text,
  offered_odd numeric,
  source_probability numeric,
  source_ev numeric,
  source_fair_odd numeric,
  adjusted_probability numeric,
  adjusted_fair_odd numeric,
  adjusted_ev numeric,
  decision text NOT NULL CHECK (decision IN ('CONFIRMAR', 'PULAR')),
  confidence text NOT NULL,
  validator_model text NOT NULL,
  user_context text,
  analysis_context text,
  favorable_blocks text[] NOT NULL DEFAULT '{}',
  against_blocks text[] NOT NULL DEFAULT '{}',
  alerts text[] NOT NULL DEFAULT '{}',
  final_analysis text NOT NULL,
  simulation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  online_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocr_raw_text text,
  structured_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_status text,
  stake_units numeric,
  profit_units numeric,
  profit_brl numeric,
  clv numeric
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_validator_registros TO authenticated;
GRANT ALL ON public.asp_validator_registros TO service_role;

CREATE INDEX IF NOT EXISTS idx_asp_validator_user_created
  ON public.asp_validator_registros (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asp_validator_model_created
  ON public.asp_validator_registros (validator_model, created_at DESC);

ALTER TABLE public.asp_validator_registros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asp_validator_select_own"
  ON public.asp_validator_registros FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "asp_validator_insert_own"
  ON public.asp_validator_registros FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "asp_validator_update_own"
  ON public.asp_validator_registros FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "asp_validator_delete_own"
  ON public.asp_validator_registros FOR DELETE
  USING (auth.uid() = user_id);

-- Tabela de uploads vinculados a um registro
CREATE TABLE IF NOT EXISTS public.asp_validator_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validator_id uuid NOT NULL REFERENCES public.asp_validator_registros(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  file_name text NOT NULL,
  file_type text,
  mime_type text,
  file_size bigint,
  upload_category text NOT NULL,
  user_comment text,
  upload_order integer NOT NULL DEFAULT 0,
  ocr_status text NOT NULL DEFAULT 'pending',
  ocr_text text,
  ocr_error text,
  structured_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Garante coluna ocr_error mesmo se a tabela já existia
ALTER TABLE public.asp_validator_uploads
  ADD COLUMN IF NOT EXISTS ocr_error text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_validator_uploads TO authenticated;
GRANT ALL ON public.asp_validator_uploads TO service_role;

CREATE INDEX IF NOT EXISTS idx_asp_validator_uploads_validator
  ON public.asp_validator_uploads (validator_id, upload_order);
CREATE INDEX IF NOT EXISTS idx_asp_validator_uploads_user_created
  ON public.asp_validator_uploads (user_id, created_at DESC);

ALTER TABLE public.asp_validator_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asp_validator_uploads_select_own"
  ON public.asp_validator_uploads FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.asp_validator_registros r
    WHERE r.id = asp_validator_uploads.validator_id AND r.user_id = auth.uid()
  ));
CREATE POLICY "asp_validator_uploads_insert_own"
  ON public.asp_validator_uploads FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.asp_validator_registros r
      WHERE r.id = asp_validator_uploads.validator_id AND r.user_id = auth.uid()
    )
  );
CREATE POLICY "asp_validator_uploads_update_own"
  ON public.asp_validator_uploads FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.asp_validator_registros r
    WHERE r.id = asp_validator_uploads.validator_id AND r.user_id = auth.uid()
  ))
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.asp_validator_registros r
      WHERE r.id = asp_validator_uploads.validator_id AND r.user_id = auth.uid()
    )
  );
CREATE POLICY "asp_validator_uploads_delete_own"
  ON public.asp_validator_uploads FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.asp_validator_registros r
    WHERE r.id = asp_validator_uploads.validator_id AND r.user_id = auth.uid()
  ));

-- Trigger de updated_at
CREATE TRIGGER trg_asp_validator_registros_updated
  BEFORE UPDATE ON public.asp_validator_registros
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_asp_validator_uploads_updated
  BEFORE UPDATE ON public.asp_validator_uploads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';