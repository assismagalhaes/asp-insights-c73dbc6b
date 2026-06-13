-- Canonical financial source for dashboards and bankroll.
-- bankroll_historico may remain as an audit/snapshot table, but the UI should read
-- these recalculable views derived from settled results.

CREATE OR REPLACE VIEW public.vw_resultados_financeiros
WITH (security_invoker = true)
AS
WITH cfg AS (
  SELECT banca_inicial, valor_unidade_padrao
  FROM public.configuracoes
  ORDER BY created_at ASC
  LIMIT 1
),
latest_resultados AS (
  SELECT DISTINCT ON (prognostico_id)
    id,
    prognostico_id,
    resultado,
    placar_final,
    odd_fechamento,
    data_resultado,
    created_at
  FROM public.resultados
  WHERE resultado IN ('GREEN', 'RED')
  ORDER BY prognostico_id, created_at DESC
)
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
  p.status_validacao,
  r.resultado,
  p.stake,
  CASE
    WHEN p.odd_ajustada IS NOT NULL AND p.odd_ajustada > 0 THEN p.odd_ajustada
    ELSE p.odd_ofertada
  END AS odd_efetiva,
  cfg.valor_unidade_padrao AS valor_unidade,
  CASE
    WHEN r.resultado = 'GREEN' THEN ROUND((p.stake * ((CASE WHEN p.odd_ajustada IS NOT NULL AND p.odd_ajustada > 0 THEN p.odd_ajustada ELSE p.odd_ofertada END) - 1))::numeric, 2)
    WHEN r.resultado = 'RED' THEN ROUND((-p.stake)::numeric, 2)
    ELSE 0
  END AS lucro_unidades,
  CASE
    WHEN r.resultado = 'GREEN' THEN ROUND((p.stake * ((CASE WHEN p.odd_ajustada IS NOT NULL AND p.odd_ajustada > 0 THEN p.odd_ajustada ELSE p.odd_ofertada END) - 1) * cfg.valor_unidade_padrao)::numeric, 2)
    WHEN r.resultado = 'RED' THEN ROUND((-p.stake * cfg.valor_unidade_padrao)::numeric, 2)
    ELSE 0
  END AS lucro_reais
FROM latest_resultados r
JOIN public.prognosticos p ON p.id = r.prognostico_id
CROSS JOIN cfg
WHERE p.status_validacao = 'CONFIRMA';

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
