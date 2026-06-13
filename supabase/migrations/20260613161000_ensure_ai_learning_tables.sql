-- Ensure AI learning tables exist before validation flows read/write them.
-- Idempotent and safe for databases where previous learning migrations did not run.

CREATE TABLE IF NOT EXISTS public.analises_ia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id UUID REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  modo_ia TEXT,
  esporte TEXT,
  liga TEXT,
  mercado TEXT,
  pick TEXT,
  linha TEXT,
  odd_original NUMERIC,
  odd_ajustada NUMERIC,
  odd_valor NUMERIC,
  odd_usada NUMERIC,
  probabilidade_final NUMERIC,
  edge_original NUMERIC,
  edge_ajustado NUMERIC,
  edge_usado NUMERIC,
  contexto_analisado TEXT,
  parecer_ia TEXT,
  decisao_sugerida TEXT,
  stake_sugerida NUMERIC,
  riscos_identificados TEXT,
  tags_risco JSONB,
  fontes_consultadas JSONB,
  buscas_realizadas JSONB,
  alertas_online JSONB,
  prompt_versao TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feedback_ia_resultados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id UUID REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  analise_ia_id UUID REFERENCES public.analises_ia(id) ON DELETE SET NULL,
  modo_ia TEXT,
  decisao_ia_sugerida TEXT,
  decisao_humana_final TEXT,
  resultado_real TEXT,
  lucro_prejuizo NUMERIC,
  lucro_unidades NUMERIC,
  esporte TEXT,
  liga TEXT,
  mercado TEXT,
  pick TEXT,
  linha TEXT,
  odd_usada NUMERIC,
  probabilidade_final NUMERIC,
  edge_usado NUMERIC,
  tags_risco JSONB,
  fontes_consultadas JSONB,
  acertou_ia BOOLEAN,
  acertou_humano BOOLEAN,
  divergencia_ia_humano BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resumos_aprendizado_ia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_inicio DATE,
  periodo_fim DATE,
  total_analises INTEGER DEFAULT 0,
  total_green INTEGER DEFAULT 0,
  total_red INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  roi NUMERIC DEFAULT 0,
  yield NUMERIC DEFAULT 0,
  resumo_geral TEXT,
  aprendizados_por_esporte JSONB,
  aprendizados_por_mercado JSONB,
  alertas_recorrentes JSONB,
  recomendacoes_para_prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.analises_ia
  ADD COLUMN IF NOT EXISTS odd_original NUMERIC,
  ADD COLUMN IF NOT EXISTS odd_ajustada NUMERIC,
  ADD COLUMN IF NOT EXISTS odd_valor NUMERIC,
  ADD COLUMN IF NOT EXISTS edge_original NUMERIC,
  ADD COLUMN IF NOT EXISTS edge_ajustado NUMERIC,
  ADD COLUMN IF NOT EXISTS alertas_online JSONB;

ALTER TABLE public.feedback_ia_resultados
  ADD COLUMN IF NOT EXISTS modo_ia TEXT,
  ADD COLUMN IF NOT EXISTS divergencia_ia_humano BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analises_ia'
      AND column_name = 'tags_risco'
      AND data_type = 'ARRAY'
  ) THEN
    ALTER TABLE public.analises_ia
      ALTER COLUMN tags_risco DROP DEFAULT,
      ALTER COLUMN tags_risco TYPE JSONB USING to_jsonb(tags_risco);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'feedback_ia_resultados'
      AND column_name = 'tags_risco'
      AND data_type = 'ARRAY'
  ) THEN
    ALTER TABLE public.feedback_ia_resultados
      ALTER COLUMN tags_risco DROP DEFAULT,
      ALTER COLUMN tags_risco TYPE JSONB USING to_jsonb(tags_risco);
  END IF;
END $$;

ALTER TABLE public.analises_ia
  ALTER COLUMN tags_risco SET DEFAULT '[]'::jsonb;

ALTER TABLE public.feedback_ia_resultados
  ALTER COLUMN tags_risco SET DEFAULT '[]'::jsonb;

ALTER TABLE public.analises_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_ia_resultados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumos_aprendizado_ia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage analises_ia" ON public.analises_ia;
CREATE POLICY "Admins can manage analises_ia"
ON public.analises_ia
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can manage feedback_ia_resultados" ON public.feedback_ia_resultados;
CREATE POLICY "Admins can manage feedback_ia_resultados"
ON public.feedback_ia_resultados
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can manage resumos_aprendizado_ia" ON public.resumos_aprendizado_ia;
CREATE POLICY "Admins can manage resumos_aprendizado_ia"
ON public.resumos_aprendizado_ia
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analises_ia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_ia_resultados TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resumos_aprendizado_ia TO authenticated;
GRANT ALL ON public.analises_ia TO service_role;
GRANT ALL ON public.feedback_ia_resultados TO service_role;
GRANT ALL ON public.resumos_aprendizado_ia TO service_role;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedback_ia_resultados_set_updated_at ON public.feedback_ia_resultados;
CREATE TRIGGER feedback_ia_resultados_set_updated_at
BEFORE UPDATE ON public.feedback_ia_resultados
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_analises_ia_prognostico_id
ON public.analises_ia (prognostico_id);

CREATE INDEX IF NOT EXISTS idx_analises_ia_modo_ia
ON public.analises_ia (modo_ia);

CREATE INDEX IF NOT EXISTS idx_analises_ia_filters
ON public.analises_ia (esporte, liga, mercado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_modo_ia
ON public.feedback_ia_resultados (modo_ia);

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_prognostico_id
ON public.feedback_ia_resultados (prognostico_id);

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_resultado_real
ON public.feedback_ia_resultados (resultado_real);

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_filters
ON public.feedback_ia_resultados (esporte, liga, mercado, created_at DESC);
