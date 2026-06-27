ALTER TABLE public.asp_validator_registros
  ADD COLUMN IF NOT EXISTS ocr_structured_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_data_quality_score numeric,
  ADD COLUMN IF NOT EXISTS ocr_structured_fields_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS simulation_type text;

NOTIFY pgrst, 'reload schema';
