ALTER TABLE public.asp_validator_uploads
  ADD COLUMN IF NOT EXISTS ocr_error text;
