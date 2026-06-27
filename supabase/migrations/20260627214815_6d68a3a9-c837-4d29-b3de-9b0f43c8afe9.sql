ALTER TABLE public.asp_validator_registros
  ADD COLUMN IF NOT EXISTS result_settled_at date,
  ADD COLUMN IF NOT EXISTS final_score text,
  ADD COLUMN IF NOT EXISTS result_notes text,
  ADD COLUMN IF NOT EXISTS unit_value_brl numeric,
  ADD COLUMN IF NOT EXISTS is_simulated_result boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bankroll_applied boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';