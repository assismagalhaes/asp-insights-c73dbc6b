
ALTER TABLE public.validacoes
  ADD COLUMN IF NOT EXISTS modo_ia text,
  ADD COLUMN IF NOT EXISTS fontes_consultadas jsonb,
  ADD COLUMN IF NOT EXISTS buscas_realizadas jsonb;
