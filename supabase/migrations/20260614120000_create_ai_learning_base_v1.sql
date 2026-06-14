-- AI Learning Base V1: internal operational memory for AI analyses,
-- human decisions and resolved GREEN/RED outcomes.

CREATE TABLE IF NOT EXISTS public.analises_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id uuid REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  validacao_id uuid NULL,
  modo_ia text NOT NULL,
  esporte text NULL,
  liga text NULL,
  mercado text NULL,
  pick text NULL,
  linha text NULL,
  jogo text NULL,
  data_evento date NULL,
  hora_evento time NULL,
  odd_usada numeric NULL,
  probabilidade_final numeric NULL,
  edge_usado numeric NULL,
  contexto_analisado text NULL,
  parecer_ia text NULL,
  decisao_sugerida text NULL,
  stake_sugerida numeric NULL,
  riscos_identificados text NULL,
  tags_risco jsonb NULL,
  fontes_consultadas jsonb NULL,
  buscas_realizadas jsonb NULL,
  prompt_versao text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feedback_ia_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id uuid REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  analise_ia_id uuid REFERENCES public.analises_ia(id) ON DELETE SET NULL,
  modo_ia text NULL,
  esporte text NULL,
  liga text NULL,
  mercado text NULL,
  pick text NULL,
  linha text NULL,
  jogo text NULL,
  decisao_ia_sugerida text NULL,
  stake_ia_sugerida numeric NULL,
  decisao_humana_final text NULL,
  stake_humana_final numeric NULL,
  resultado_real text NULL,
  lucro_prejuizo numeric NULL,
  lucro_unidades numeric NULL,
  odd_usada numeric NULL,
  probabilidade_final numeric NULL,
  edge_usado numeric NULL,
  tags_risco jsonb NULL,
  fontes_consultadas jsonb NULL,
  buscas_realizadas jsonb NULL,
  acertou_ia boolean NULL,
  acertou_humano boolean NULL,
  divergencia_ia_humano boolean NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.analises_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_ia_resultados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage analises_ia" ON public.analises_ia;
CREATE POLICY "admins manage analises_ia" ON public.analises_ia
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins manage feedback_ia_resultados" ON public.feedback_ia_resultados;
CREATE POLICY "admins manage feedback_ia_resultados" ON public.feedback_ia_resultados
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_analises_ia_prognostico_id ON public.analises_ia(prognostico_id);
CREATE INDEX IF NOT EXISTS idx_analises_ia_modo_ia ON public.analises_ia(modo_ia);
CREATE INDEX IF NOT EXISTS idx_analises_ia_esporte ON public.analises_ia(esporte);
CREATE INDEX IF NOT EXISTS idx_analises_ia_liga ON public.analises_ia(liga);
CREATE INDEX IF NOT EXISTS idx_analises_ia_mercado ON public.analises_ia(mercado);
CREATE INDEX IF NOT EXISTS idx_analises_ia_decisao_sugerida ON public.analises_ia(decisao_sugerida);
CREATE INDEX IF NOT EXISTS idx_analises_ia_created_at ON public.analises_ia(created_at);

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_prognostico_id ON public.feedback_ia_resultados(prognostico_id);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_analise_ia_id ON public.feedback_ia_resultados(analise_ia_id);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_modo_ia ON public.feedback_ia_resultados(modo_ia);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_esporte ON public.feedback_ia_resultados(esporte);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_liga ON public.feedback_ia_resultados(liga);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_mercado ON public.feedback_ia_resultados(mercado);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_resultado_real ON public.feedback_ia_resultados(resultado_real);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_decisao_ia_sugerida ON public.feedback_ia_resultados(decisao_ia_sugerida);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_decisao_humana_final ON public.feedback_ia_resultados(decisao_humana_final);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_created_at ON public.feedback_ia_resultados(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_ia_resultados_unique_analysis
ON public.feedback_ia_resultados(prognostico_id, analise_ia_id);
