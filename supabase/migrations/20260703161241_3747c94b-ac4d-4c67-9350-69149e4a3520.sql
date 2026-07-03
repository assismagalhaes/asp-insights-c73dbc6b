ALTER TABLE public.odds_jogos
  ADD COLUMN IF NOT EXISTS odd_media numeric NULL,
  ADD COLUMN IF NOT EXISTS odd_mediana numeric NULL,
  ADD COLUMN IF NOT EXISTS odd_minima numeric NULL,
  ADD COLUMN IF NOT EXISTS odd_maxima numeric NULL,
  ADD COLUMN IF NOT EXISTS odd_melhor numeric NULL,
  ADD COLUMN IF NOT EXISTS bookmaker_melhor text NULL,
  ADD COLUMN IF NOT EXISTS odd_desvio_padrao numeric NULL,
  ADD COLUMN IF NOT EXISTS casas_count integer NULL,
  ADD COLUMN IF NOT EXISTS odds_disponiveis integer NULL,
  ADD COLUMN IF NOT EXISTS probabilidade_implicita_media numeric NULL,
  ADD COLUMN IF NOT EXISTS probabilidade_implicita_mediana numeric NULL,
  ADD COLUMN IF NOT EXISTS margem_mercado_media numeric NULL,
  ADD COLUMN IF NOT EXISTS margem_mercado_mediana numeric NULL;