ALTER TABLE public.asp_validator_registros
  ADD COLUMN IF NOT EXISTS structured_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS structured_error text;

ALTER TABLE public.asp_validator_uploads
  ADD COLUMN IF NOT EXISTS structured_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS structured_error text;
