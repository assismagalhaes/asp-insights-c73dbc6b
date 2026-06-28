ALTER TABLE public.asp_validator_uploads
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS upload_source text,
  ADD COLUMN IF NOT EXISTS ocr_structured_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_data_quality_score numeric,
  ADD COLUMN IF NOT EXISTS ocr_structured_fields_count integer DEFAULT 0;

NOTIFY pgrst, 'reload schema';