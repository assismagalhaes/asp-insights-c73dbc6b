ALTER TABLE public.prognosticos
  ADD COLUMN IF NOT EXISTS odd_mediana numeric NULL,
  ADD COLUMN IF NOT EXISTS odd_mercado_base numeric NULL,
  ADD COLUMN IF NOT EXISTS odd_melhor numeric NULL,
  ADD COLUMN IF NOT EXISTS bookmaker_melhor text NULL;
