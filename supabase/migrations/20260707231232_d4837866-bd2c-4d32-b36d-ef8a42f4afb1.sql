
ALTER TABLE public.prognosticos
  ADD COLUMN IF NOT EXISTS odd_mediana NUMERIC,
  ADD COLUMN IF NOT EXISTS odd_mercado_base NUMERIC,
  ADD COLUMN IF NOT EXISTS odd_melhor NUMERIC,
  ADD COLUMN IF NOT EXISTS bookmaker_melhor TEXT,
  ADD COLUMN IF NOT EXISTS contexto_modelo TEXT,
  ADD COLUMN IF NOT EXISTS arquivo_contexto TEXT,
  ADD COLUMN IF NOT EXISTS origem_modelo TEXT,
  ADD COLUMN IF NOT EXISTS job_id_coleta TEXT;
