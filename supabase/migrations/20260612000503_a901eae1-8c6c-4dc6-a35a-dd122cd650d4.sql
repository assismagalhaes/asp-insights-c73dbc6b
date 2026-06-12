
-- 1) Tabela de ligas
CREATE TABLE IF NOT EXISTS public.ligas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  esporte TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (esporte, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ligas TO authenticated;
GRANT ALL ON public.ligas TO service_role;

ALTER TABLE public.ligas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ligas"
  ON public.ligas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert ligas"
  ON public.ligas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update ligas"
  ON public.ligas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER ligas_set_updated_at
  BEFORE UPDATE ON public.ligas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Normalização de esporte/liga em prognosticos
UPDATE public.prognosticos SET esporte='Basketball', liga=COALESCE(NULLIF(liga,''),'NBA') WHERE upper(esporte)='NBA';
UPDATE public.prognosticos SET esporte='Basketball', liga=COALESCE(NULLIF(liga,''),'WNBA') WHERE upper(esporte)='WNBA';
UPDATE public.prognosticos SET esporte='Baseball', liga=COALESCE(NULLIF(liga,''),'MLB') WHERE upper(esporte)='MLB';
UPDATE public.prognosticos SET esporte='American Football', liga=COALESCE(NULLIF(liga,''),'NFL') WHERE upper(esporte)='NFL';
UPDATE public.prognosticos SET esporte='Hockey', liga=COALESCE(NULLIF(liga,''),'NHL') WHERE upper(esporte)='NHL';
-- Corrige typo MBL -> MLB
UPDATE public.prognosticos SET liga='MLB' WHERE liga='MBL';

-- 3) Corrige datas invertidas (importações recentes que ficaram com mês/dia trocados)
UPDATE public.prognosticos
SET data = make_date(extract(year from data)::int, extract(day from data)::int, extract(month from data)::int)
WHERE data > '2026-08-01'
  AND created_at >= '2026-06-10'
  AND extract(day from data) BETWEEN 1 AND 12
  AND extract(month from data) BETWEEN 1 AND 12;

-- 4) Seed ligas a partir dos prognosticos existentes
INSERT INTO public.ligas (nome, esporte)
SELECT DISTINCT trim(liga), esporte
FROM public.prognosticos
WHERE liga IS NOT NULL AND trim(liga) <> ''
ON CONFLICT (esporte, nome) DO NOTHING;
