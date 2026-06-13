-- AI learning memory for validation analysis.
-- This does not train a base model; it stores internal history and feedback.

CREATE TABLE IF NOT EXISTS public.analises_ia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id UUID NOT NULL REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  modo_ia TEXT NOT NULL CHECK (modo_ia IN ('local', 'online')),
  esporte TEXT NOT NULL,
  liga TEXT NOT NULL,
  mercado TEXT NOT NULL,
  pick TEXT NOT NULL,
  linha TEXT,
  odd_original NUMERIC(8,3),
  odd_ajustada NUMERIC(8,3),
  odd_valor NUMERIC(8,3),
  odd_usada NUMERIC(8,3),
  probabilidade_final NUMERIC(6,2),
  edge_original NUMERIC(6,2),
  edge_ajustado NUMERIC(6,2),
  edge_usado NUMERIC(6,2),
  contexto_analisado TEXT,
  parecer_ia TEXT,
  decisao_sugerida TEXT CHECK (decisao_sugerida IN ('CONFIRMA', 'PULAR')),
  stake_sugerida NUMERIC(4,2),
  riscos_identificados TEXT,
  tags_risco TEXT[] DEFAULT '{}',
  fontes_consultadas JSONB,
  buscas_realizadas JSONB,
  alertas_online JSONB,
  prompt_versao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feedback_ia_resultados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id UUID NOT NULL REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  analise_ia_id UUID REFERENCES public.analises_ia(id) ON DELETE CASCADE,
  modo_ia TEXT CHECK (modo_ia IN ('local', 'online')),
  decisao_ia_sugerida TEXT CHECK (decisao_ia_sugerida IN ('CONFIRMA', 'PULAR')),
  decisao_humana_final TEXT CHECK (decisao_humana_final IN ('CONFIRMA', 'PULAR')),
  resultado_real TEXT CHECK (resultado_real IN ('GREEN', 'RED')),
  lucro_prejuizo NUMERIC(12,2),
  lucro_unidades NUMERIC(12,2),
  esporte TEXT,
  liga TEXT,
  mercado TEXT,
  pick TEXT,
  linha TEXT,
  odd_usada NUMERIC(8,3),
  probabilidade_final NUMERIC(6,2),
  edge_usado NUMERIC(6,2),
  tags_risco TEXT[] DEFAULT '{}',
  fontes_consultadas JSONB,
  acertou_ia BOOLEAN,
  acertou_humano BOOLEAN,
  divergencia_ia_humano BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prognostico_id, analise_ia_id, resultado_real)
);

CREATE TABLE IF NOT EXISTS public.resumos_aprendizado_ia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_inicio DATE,
  periodo_fim DATE,
  total_analises INTEGER NOT NULL DEFAULT 0,
  total_green INTEGER NOT NULL DEFAULT 0,
  total_red INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC(8,2) NOT NULL DEFAULT 0,
  roi NUMERIC(8,2) NOT NULL DEFAULT 0,
  yield NUMERIC(8,2) NOT NULL DEFAULT 0,
  resumo_geral TEXT,
  aprendizados_por_esporte JSONB,
  aprendizados_por_mercado JSONB,
  alertas_recorrentes JSONB,
  recomendacoes_para_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.analises_ia
  ADD COLUMN IF NOT EXISTS prognostico_id UUID REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS modo_ia TEXT,
  ADD COLUMN IF NOT EXISTS esporte TEXT,
  ADD COLUMN IF NOT EXISTS liga TEXT,
  ADD COLUMN IF NOT EXISTS mercado TEXT,
  ADD COLUMN IF NOT EXISTS pick TEXT,
  ADD COLUMN IF NOT EXISTS linha TEXT,
  ADD COLUMN IF NOT EXISTS odd_original NUMERIC,
  ADD COLUMN IF NOT EXISTS odd_ajustada NUMERIC,
  ADD COLUMN IF NOT EXISTS odd_valor NUMERIC,
  ADD COLUMN IF NOT EXISTS odd_usada NUMERIC,
  ADD COLUMN IF NOT EXISTS probabilidade_final NUMERIC,
  ADD COLUMN IF NOT EXISTS edge_original NUMERIC,
  ADD COLUMN IF NOT EXISTS edge_ajustado NUMERIC,
  ADD COLUMN IF NOT EXISTS edge_usado NUMERIC,
  ADD COLUMN IF NOT EXISTS contexto_analisado TEXT,
  ADD COLUMN IF NOT EXISTS parecer_ia TEXT,
  ADD COLUMN IF NOT EXISTS decisao_sugerida TEXT,
  ADD COLUMN IF NOT EXISTS stake_sugerida NUMERIC,
  ADD COLUMN IF NOT EXISTS riscos_identificados TEXT,
  ADD COLUMN IF NOT EXISTS tags_risco TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fontes_consultadas JSONB,
  ADD COLUMN IF NOT EXISTS buscas_realizadas JSONB,
  ADD COLUMN IF NOT EXISTS alertas_online JSONB,
  ADD COLUMN IF NOT EXISTS prompt_versao TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.feedback_ia_resultados
  ADD COLUMN IF NOT EXISTS prognostico_id UUID REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS analise_ia_id UUID REFERENCES public.analises_ia(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS modo_ia TEXT,
  ADD COLUMN IF NOT EXISTS decisao_ia_sugerida TEXT,
  ADD COLUMN IF NOT EXISTS decisao_humana_final TEXT,
  ADD COLUMN IF NOT EXISTS resultado_real TEXT,
  ADD COLUMN IF NOT EXISTS lucro_prejuizo NUMERIC,
  ADD COLUMN IF NOT EXISTS lucro_unidades NUMERIC,
  ADD COLUMN IF NOT EXISTS esporte TEXT,
  ADD COLUMN IF NOT EXISTS liga TEXT,
  ADD COLUMN IF NOT EXISTS mercado TEXT,
  ADD COLUMN IF NOT EXISTS pick TEXT,
  ADD COLUMN IF NOT EXISTS linha TEXT,
  ADD COLUMN IF NOT EXISTS odd_usada NUMERIC,
  ADD COLUMN IF NOT EXISTS probabilidade_final NUMERIC,
  ADD COLUMN IF NOT EXISTS edge_usado NUMERIC,
  ADD COLUMN IF NOT EXISTS tags_risco TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fontes_consultadas JSONB,
  ADD COLUMN IF NOT EXISTS acertou_ia BOOLEAN,
  ADD COLUMN IF NOT EXISTS acertou_humano BOOLEAN,
  ADD COLUMN IF NOT EXISTS divergencia_ia_humano BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS feedback_ia_resultados_unique_result_idx
ON public.feedback_ia_resultados (prognostico_id, analise_ia_id, resultado_real);

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

CREATE INDEX IF NOT EXISTS analises_ia_lookup_idx
ON public.analises_ia (prognostico_id, modo_ia, created_at DESC);

CREATE INDEX IF NOT EXISTS analises_ia_similarity_idx
ON public.analises_ia (esporte, liga, mercado, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_ia_resultados_lookup_idx
ON public.feedback_ia_resultados (esporte, liga, mercado, modo_ia, resultado_real, created_at DESC);

CREATE OR REPLACE FUNCTION public.sync_feedback_ia_for_resultado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prog RECORD;
  val RECORD;
  ana RECORD;
  lucro_u NUMERIC(12,2);
  odd_final NUMERIC(8,3);
BEGIN
  IF NEW.resultado NOT IN ('GREEN', 'RED') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO prog
  FROM public.prognosticos
  WHERE id = NEW.prognostico_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO val
  FROM public.validacoes
  WHERE prognostico_id = NEW.prognostico_id
  ORDER BY created_at DESC
  LIMIT 1;

  odd_final := CASE
    WHEN prog.odd_ajustada IS NOT NULL AND prog.odd_ajustada > 0 THEN prog.odd_ajustada
    ELSE prog.odd_ofertada
  END;

  lucro_u := CASE
    WHEN NEW.resultado = 'GREEN' THEN ROUND((prog.stake * (odd_final - 1))::numeric, 2)
    WHEN NEW.resultado = 'RED' THEN ROUND((-prog.stake)::numeric, 2)
    ELSE 0
  END;

  FOR ana IN
    SELECT *
    FROM public.analises_ia
    WHERE prognostico_id = NEW.prognostico_id
  LOOP
    INSERT INTO public.feedback_ia_resultados (
      prognostico_id,
      analise_ia_id,
      modo_ia,
      decisao_ia_sugerida,
      decisao_humana_final,
      resultado_real,
      lucro_prejuizo,
      lucro_unidades,
      esporte,
      liga,
      mercado,
      pick,
      linha,
      odd_usada,
      probabilidade_final,
      edge_usado,
      tags_risco,
      fontes_consultadas,
      acertou_ia,
      acertou_humano,
      divergencia_ia_humano
    )
    VALUES (
      NEW.prognostico_id,
      ana.id,
      ana.modo_ia,
      ana.decisao_sugerida,
      COALESCE(val.decisao, prog.status_validacao),
      NEW.resultado,
      NEW.lucro_prejuizo,
      lucro_u,
      prog.esporte,
      prog.liga,
      prog.mercado,
      prog.pick,
      prog.linha,
      odd_final,
      prog.probabilidade_final,
      COALESCE(prog.edge_ajustado, prog.edge),
      ana.tags_risco,
      ana.fontes_consultadas,
      CASE
        WHEN ana.decisao_sugerida = 'CONFIRMA' THEN NEW.resultado = 'GREEN'
        WHEN ana.decisao_sugerida = 'PULAR' THEN NEW.resultado = 'RED'
        ELSE NULL
      END,
      CASE
        WHEN COALESCE(val.decisao, prog.status_validacao) = 'CONFIRMA' THEN NEW.resultado = 'GREEN'
        WHEN COALESCE(val.decisao, prog.status_validacao) = 'PULAR' THEN NEW.resultado = 'RED'
        ELSE NULL
      END,
      ana.decisao_sugerida IS NOT NULL
        AND COALESCE(val.decisao, prog.status_validacao) IS NOT NULL
        AND ana.decisao_sugerida <> COALESCE(val.decisao, prog.status_validacao)
    )
    ON CONFLICT (prognostico_id, analise_ia_id, resultado_real)
    DO UPDATE SET
      decisao_humana_final = EXCLUDED.decisao_humana_final,
      lucro_prejuizo = EXCLUDED.lucro_prejuizo,
      lucro_unidades = EXCLUDED.lucro_unidades,
      acertou_ia = EXCLUDED.acertou_ia,
      acertou_humano = EXCLUDED.acertou_humano,
      divergencia_ia_humano = EXCLUDED.divergencia_ia_humano;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_feedback_ia_for_resultado ON public.resultados;
CREATE TRIGGER trg_sync_feedback_ia_for_resultado
AFTER INSERT OR UPDATE OF resultado, lucro_prejuizo
ON public.resultados
FOR EACH ROW
EXECUTE FUNCTION public.sync_feedback_ia_for_resultado();

-- Backfill snapshots from legacy validation rows that already stored an AI opinion.
INSERT INTO public.analises_ia (
  prognostico_id,
  modo_ia,
  esporte,
  liga,
  mercado,
  pick,
  linha,
  odd_original,
  odd_ajustada,
  odd_valor,
  odd_usada,
  probabilidade_final,
  edge_original,
  edge_ajustado,
  edge_usado,
  contexto_analisado,
  parecer_ia,
  decisao_sugerida,
  stake_sugerida,
  riscos_identificados,
  fontes_consultadas,
  buscas_realizadas,
  prompt_versao,
  created_at
)
SELECT
  p.id,
  CASE WHEN v.modo_ia IN ('local', 'online') THEN v.modo_ia ELSE 'local' END,
  p.esporte,
  p.liga,
  p.mercado,
  p.pick,
  p.linha,
  p.odd_ofertada,
  p.odd_ajustada,
  p.odd_valor,
  CASE WHEN p.odd_ajustada IS NOT NULL AND p.odd_ajustada > 0 THEN p.odd_ajustada ELSE p.odd_ofertada END,
  p.probabilidade_final,
  p.edge,
  p.edge_ajustado,
  COALESCE(p.edge_ajustado, p.edge),
  CONCAT_WS(E'\n\n', p.dados_tecnicos, v.contexto_adicional),
  v.parecer_ia,
  CASE WHEN v.decisao_ia_sugerida = 'CONFIRMA' THEN 'CONFIRMA' ELSE 'PULAR' END,
  v.stake_ia_sugerida,
  v.riscos_identificados,
  v.fontes_consultadas,
  v.buscas_realizadas,
  v.prompt_versao,
  COALESCE(v.data_analise_ia, v.created_at)
FROM public.validacoes v
JOIN public.prognosticos p ON p.id = v.prognostico_id
WHERE v.parecer_ia IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.analises_ia a
    WHERE a.prognostico_id = v.prognostico_id
      AND a.parecer_ia = v.parecer_ia
  );

-- Backfill feedback for already-settled results and AI snapshots.
INSERT INTO public.feedback_ia_resultados (
  prognostico_id,
  analise_ia_id,
  modo_ia,
  decisao_ia_sugerida,
  decisao_humana_final,
  resultado_real,
  lucro_prejuizo,
  lucro_unidades,
  esporte,
  liga,
  mercado,
  pick,
  linha,
  odd_usada,
  probabilidade_final,
  edge_usado,
  tags_risco,
  fontes_consultadas,
  acertou_ia,
  acertou_humano,
  divergencia_ia_humano
)
SELECT
  p.id,
  a.id,
  a.modo_ia,
  a.decisao_sugerida,
  COALESCE(v.decisao, p.status_validacao),
  r.resultado,
  r.lucro_prejuizo,
  CASE
    WHEN r.resultado = 'GREEN' THEN ROUND((p.stake * ((CASE WHEN p.odd_ajustada IS NOT NULL AND p.odd_ajustada > 0 THEN p.odd_ajustada ELSE p.odd_ofertada END) - 1))::numeric, 2)
    WHEN r.resultado = 'RED' THEN ROUND((-p.stake)::numeric, 2)
    ELSE 0
  END,
  p.esporte,
  p.liga,
  p.mercado,
  p.pick,
  p.linha,
  CASE WHEN p.odd_ajustada IS NOT NULL AND p.odd_ajustada > 0 THEN p.odd_ajustada ELSE p.odd_ofertada END,
  p.probabilidade_final,
  COALESCE(p.edge_ajustado, p.edge),
  a.tags_risco,
  a.fontes_consultadas,
  CASE
    WHEN a.decisao_sugerida = 'CONFIRMA' THEN r.resultado = 'GREEN'
    WHEN a.decisao_sugerida = 'PULAR' THEN r.resultado = 'RED'
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(v.decisao, p.status_validacao) = 'CONFIRMA' THEN r.resultado = 'GREEN'
    WHEN COALESCE(v.decisao, p.status_validacao) = 'PULAR' THEN r.resultado = 'RED'
    ELSE NULL
  END,
  a.decisao_sugerida <> COALESCE(v.decisao, p.status_validacao)
FROM public.analises_ia a
JOIN public.prognosticos p ON p.id = a.prognostico_id
JOIN public.resultados r ON r.prognostico_id = p.id AND r.resultado IN ('GREEN', 'RED')
LEFT JOIN LATERAL (
  SELECT *
  FROM public.validacoes v2
  WHERE v2.prognostico_id = p.id
  ORDER BY v2.created_at DESC
  LIMIT 1
) v ON true
ON CONFLICT (prognostico_id, analise_ia_id, resultado_real) DO NOTHING;
