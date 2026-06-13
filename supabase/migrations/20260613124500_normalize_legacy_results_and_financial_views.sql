-- Normalize legacy result labels and make financial views resilient to old data.
-- No history is deleted or reset.

-- Keep this migration self-contained: some deployed databases did not receive
-- the AI learning migration before this file tried to backfill feedback.
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
  tags_risco JSONB DEFAULT '[]'::jsonb,
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
  tags_risco JSONB DEFAULT '[]'::jsonb,
  fontes_consultadas JSONB,
  acertou_ia BOOLEAN,
  acertou_humano BOOLEAN,
  divergencia_ia_humano BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS feedback_ia_resultados_unique_result_idx
ON public.feedback_ia_resultados (prognostico_id, analise_ia_id, resultado_real);

ALTER TABLE public.analises_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_ia_resultados ENABLE ROW LEVEL SECURITY;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analises_ia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_ia_resultados TO authenticated;
GRANT ALL ON public.analises_ia TO service_role;
GRANT ALL ON public.feedback_ia_resultados TO service_role;

UPDATE public.resultados
SET resultado = CASE
  WHEN UPPER(TRIM(resultado)) IN ('WIN', 'WINS') THEN 'GREEN'
  WHEN UPPER(TRIM(resultado)) IN ('LOSS', 'LOSSES') THEN 'RED'
  ELSE resultado
END
WHERE UPPER(TRIM(resultado)) IN ('WIN', 'WINS', 'LOSS', 'LOSSES');

UPDATE public.prognosticos
SET resultado = CASE
  WHEN UPPER(TRIM(resultado)) IN ('WIN', 'WINS') THEN 'GREEN'
  WHEN UPPER(TRIM(resultado)) IN ('LOSS', 'LOSSES') THEN 'RED'
  ELSE resultado
END
WHERE UPPER(TRIM(resultado)) IN ('WIN', 'WINS', 'LOSS', 'LOSSES');

UPDATE public.feedback_ia_resultados
SET resultado_real = CASE
  WHEN UPPER(TRIM(resultado_real)) IN ('WIN', 'WINS') THEN 'GREEN'
  WHEN UPPER(TRIM(resultado_real)) IN ('LOSS', 'LOSSES') THEN 'RED'
  ELSE resultado_real
END
WHERE UPPER(TRIM(resultado_real)) IN ('WIN', 'WINS', 'LOSS', 'LOSSES');

CREATE OR REPLACE VIEW public.vw_resultados_financeiros
WITH (security_invoker = true)
AS
WITH cfg AS (
  SELECT banca_inicial, valor_unidade_padrao
  FROM public.configuracoes
  ORDER BY created_at ASC
  LIMIT 1
),
latest_validacoes AS (
  SELECT DISTINCT ON (prognostico_id)
    prognostico_id,
    decisao,
    stake_confirmada
  FROM public.validacoes
  ORDER BY prognostico_id, created_at DESC
),
raw_resultados AS (
  SELECT
    id,
    prognostico_id,
    resultado,
    data_resultado,
    created_at,
    1 AS source_rank
  FROM public.resultados

  UNION ALL

  SELECT
    NULL::uuid AS id,
    p.id AS prognostico_id,
    p.resultado,
    p.data AS data_resultado,
    COALESCE(p.updated_at, p.created_at) AS created_at,
    2 AS source_rank
  FROM public.prognosticos p
),
latest_resultados AS (
  SELECT DISTINCT ON (prognostico_id)
    id,
    prognostico_id,
    CASE
      WHEN UPPER(TRIM(resultado)) IN ('GREEN', 'WIN', 'WINS') THEN 'GREEN'
      WHEN UPPER(TRIM(resultado)) IN ('RED', 'LOSS', 'LOSSES') THEN 'RED'
      ELSE NULL
    END AS resultado,
    data_resultado,
    created_at
  FROM raw_resultados
  WHERE CASE
      WHEN UPPER(TRIM(resultado)) IN ('GREEN', 'WIN', 'WINS') THEN 'GREEN'
      WHEN UPPER(TRIM(resultado)) IN ('RED', 'LOSS', 'LOSSES') THEN 'RED'
      ELSE NULL
    END IN ('GREEN', 'RED')
  ORDER BY prognostico_id, source_rank ASC, created_at DESC
),
base AS (
  SELECT
    r.id AS resultado_id,
    p.id AS prognostico_id,
    p.data,
    r.data_resultado,
    p.esporte,
    p.liga,
    p.mercado,
    p.jogo,
    p.pick,
    p.linha,
    p.status_validacao,
    COALESCE(v.decisao, p.status_validacao) AS decisao_final,
    r.resultado,
    COALESCE(v.stake_confirmada, p.stake) AS stake,
    CASE
      WHEN p.odd_ajustada IS NOT NULL AND p.odd_ajustada > 0 THEN p.odd_ajustada
      ELSE p.odd_ofertada
    END AS odd_efetiva,
    cfg.valor_unidade_padrao AS valor_unidade
  FROM latest_resultados r
  JOIN public.prognosticos p ON p.id = r.prognostico_id
  LEFT JOIN latest_validacoes v ON v.prognostico_id = p.id
  CROSS JOIN cfg
)
SELECT
  resultado_id,
  prognostico_id,
  data,
  data_resultado,
  esporte,
  liga,
  mercado,
  jogo,
  pick,
  status_validacao,
  resultado,
  stake,
  odd_efetiva,
  valor_unidade,
  CASE
    WHEN resultado = 'GREEN' THEN ROUND((stake * (odd_efetiva - 1))::numeric, 2)
    WHEN resultado = 'RED' THEN ROUND((-stake)::numeric, 2)
    ELSE 0
  END AS lucro_unidades,
  CASE
    WHEN resultado = 'GREEN' THEN ROUND((stake * valor_unidade * (odd_efetiva - 1))::numeric, 2)
    WHEN resultado = 'RED' THEN ROUND((-(stake * valor_unidade))::numeric, 2)
    ELSE 0
  END AS lucro_reais,
  linha,
  decisao_final
FROM base;

GRANT SELECT ON public.vw_resultados_financeiros TO authenticated;

CREATE OR REPLACE VIEW public.vw_bankroll_timeline_calculado
WITH (security_invoker = true)
AS
WITH cfg AS (
  SELECT banca_inicial
  FROM public.configuracoes
  ORDER BY created_at ASC
  LIMIT 1
),
daily AS (
  SELECT
    data_resultado AS data,
    SUM(lucro_reais) AS lucro_dia_reais
  FROM public.vw_resultados_financeiros
  GROUP BY data_resultado
),
running AS (
  SELECT
    daily.data,
    daily.lucro_dia_reais,
    SUM(daily.lucro_dia_reais) OVER (ORDER BY daily.data ASC) AS lucro_acum,
    cfg.banca_inicial + SUM(daily.lucro_dia_reais) OVER (ORDER BY daily.data ASC) AS banca,
    cfg.banca_inicial
  FROM daily
  CROSS JOIN cfg
),
with_peak AS (
  SELECT
    *,
    MAX(banca) OVER (ORDER BY data ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS pico
  FROM running
)
SELECT
  data,
  ROUND(lucro_dia_reais::numeric, 2) AS lucro_dia_reais,
  ROUND(lucro_acum::numeric, 2) AS lucro_acum,
  ROUND(banca::numeric, 2) AS banca,
  CASE WHEN banca_inicial > 0 THEN ROUND(((lucro_acum / banca_inicial) * 100)::numeric, 2) ELSE 0 END AS roi,
  CASE WHEN pico > 0 THEN ROUND((((pico - banca) / pico) * 100)::numeric, 2) ELSE 0 END AS drawdown
FROM with_peak
ORDER BY data ASC;

GRANT SELECT ON public.vw_bankroll_timeline_calculado TO authenticated;

-- Fill or refresh AI feedback from the normalized financial source, including legacy
-- settled prognosticos that do not have a row in public.resultados.
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
  f.prognostico_id,
  a.id,
  a.modo_ia,
  a.decisao_sugerida,
  COALESCE(v.decisao, f.status_validacao),
  f.resultado,
  f.lucro_unidades,
  f.lucro_unidades,
  f.esporte,
  f.liga,
  f.mercado,
  f.pick,
  f.linha,
  f.odd_efetiva,
  p.probabilidade_final,
  COALESCE(p.edge_ajustado, p.edge),
  a.tags_risco,
  a.fontes_consultadas,
  CASE
    WHEN a.decisao_sugerida = 'CONFIRMA' THEN f.resultado = 'GREEN'
    WHEN a.decisao_sugerida = 'PULAR' THEN f.resultado = 'RED'
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(v.decisao, f.status_validacao) = 'CONFIRMA' THEN f.resultado = 'GREEN'
    WHEN COALESCE(v.decisao, f.status_validacao) = 'PULAR' THEN f.resultado = 'RED'
    ELSE NULL
  END,
  a.decisao_sugerida IS NOT NULL
    AND COALESCE(v.decisao, f.status_validacao) IS NOT NULL
    AND a.decisao_sugerida <> COALESCE(v.decisao, f.status_validacao)
FROM public.vw_resultados_financeiros f
JOIN public.prognosticos p ON p.id = f.prognostico_id
JOIN public.analises_ia a ON a.prognostico_id = f.prognostico_id
LEFT JOIN LATERAL (
  SELECT *
  FROM public.validacoes v2
  WHERE v2.prognostico_id = f.prognostico_id
  ORDER BY v2.created_at DESC
  LIMIT 1
) v ON true
ON CONFLICT (prognostico_id, analise_ia_id, resultado_real)
DO UPDATE SET
  decisao_humana_final = EXCLUDED.decisao_humana_final,
  lucro_prejuizo = EXCLUDED.lucro_prejuizo,
  lucro_unidades = EXCLUDED.lucro_unidades,
  resultado_real = EXCLUDED.resultado_real,
  acertou_ia = EXCLUDED.acertou_ia,
  acertou_humano = EXCLUDED.acertou_humano,
  divergencia_ia_humano = EXCLUDED.divergencia_ia_humano;
