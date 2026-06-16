ALTER TABLE public.prognosticos
  ADD COLUMN IF NOT EXISTS contexto_modelo text,
  ADD COLUMN IF NOT EXISTS arquivo_contexto text,
  ADD COLUMN IF NOT EXISTS origem_modelo text,
  ADD COLUMN IF NOT EXISTS job_id_coleta text;

CREATE INDEX IF NOT EXISTS idx_prognosticos_origem_modelo ON public.prognosticos(origem_modelo);
CREATE INDEX IF NOT EXISTS idx_prognosticos_job_id_coleta ON public.prognosticos(job_id_coleta);
