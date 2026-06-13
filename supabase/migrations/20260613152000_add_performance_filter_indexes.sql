-- Indexes for common dashboard, history, bankroll, statistics and AI learning filters.
-- This migration is idempotent and avoids touching data.

CREATE INDEX IF NOT EXISTS idx_prognosticos_data
ON public.prognosticos (data);

CREATE INDEX IF NOT EXISTS idx_prognosticos_esporte
ON public.prognosticos (esporte);

CREATE INDEX IF NOT EXISTS idx_prognosticos_liga
ON public.prognosticos (liga);

CREATE INDEX IF NOT EXISTS idx_prognosticos_mercado
ON public.prognosticos (mercado);

CREATE INDEX IF NOT EXISTS idx_prognosticos_resultado
ON public.prognosticos (resultado);

CREATE INDEX IF NOT EXISTS idx_prognosticos_status_publicacao
ON public.prognosticos (status_publicacao);

CREATE INDEX IF NOT EXISTS idx_prognosticos_status_validacao
ON public.prognosticos (status_validacao);

CREATE INDEX IF NOT EXISTS idx_prognosticos_created_at
ON public.prognosticos (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prognosticos_filters
ON public.prognosticos (data DESC, esporte, liga, mercado, resultado, status_validacao, status_publicacao);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prognosticos'
      AND column_name = 'decisao_final'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_prognosticos_decisao_final ON public.prognosticos (decisao_final)';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.analises_ia') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_analises_ia_prognostico_id ON public.analises_ia (prognostico_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_analises_ia_modo_ia ON public.analises_ia (modo_ia)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_analises_ia_esporte ON public.analises_ia (esporte)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_analises_ia_liga ON public.analises_ia (liga)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_analises_ia_mercado ON public.analises_ia (mercado)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_analises_ia_created_at ON public.analises_ia (created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_analises_ia_filters ON public.analises_ia (prognostico_id, modo_ia, esporte, liga, mercado, created_at DESC)';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.feedback_ia_resultados') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_prognostico_id ON public.feedback_ia_resultados (prognostico_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_resultado_real ON public.feedback_ia_resultados (resultado_real)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_esporte ON public.feedback_ia_resultados (esporte)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_liga ON public.feedback_ia_resultados (liga)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_mercado ON public.feedback_ia_resultados (mercado)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_created_at ON public.feedback_ia_resultados (created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_filters ON public.feedback_ia_resultados (resultado_real, esporte, liga, mercado, created_at DESC)';
  END IF;
END $$;
