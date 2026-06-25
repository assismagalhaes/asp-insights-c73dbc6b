-- Ajustes retroativos para analise de validacao.
-- PULAR continua fora do bankroll oficial; stake=1 aqui serve para simulacao/analytics.

UPDATE public.prognosticos
SET stake = 1
WHERE status_validacao = 'PULAR'
  AND COALESCE(stake, 0) = 0;

UPDATE public.prognosticos
SET mercado = CASE
  WHEN mercado IN ('Resultado Final', '1X2') THEN 'Resultado da Partida'
  WHEN mercado IN ('Over/Under', 'Over/Under Gols') AND esporte = 'Futebol' THEN 'Total de Gols'
  WHEN mercado IN ('Over/Under', 'Over/Under Pontos', 'Spread') AND esporte = 'Basketball' THEN
    CASE WHEN mercado = 'Spread' THEN U&'Handicap Asi\00E1tico' ELSE 'Total de Pontos' END
  WHEN mercado IN ('Over/Under', 'Over/Under Corridas', 'Run Line') AND esporte = 'Baseball' THEN
    CASE WHEN mercado = 'Run Line' THEN U&'Handicap Asi\00E1tico' ELSE 'Total de Corridas' END
  WHEN mercado IN ('BTTS') THEN 'Ambas Marcam'
  ELSE mercado
END
WHERE mercado IN (
  'Resultado Final',
  '1X2',
  'Over/Under',
  'Over/Under Gols',
  'Over/Under Pontos',
  'Over/Under Corridas',
  'Spread',
  'Run Line',
  'BTTS'
);

UPDATE public.configuracoes
SET mercados_ativos = ARRAY[
  'Moneyline',
  'Resultado da Partida',
  'Total de Gols',
  'Total de Pontos',
  'Total de Corridas',
  U&'Handicap Asi\00E1tico',
  'Ambas Marcam',
  'Dupla Chance',
  'Total de Escanteios',
  'ASP GoalMatrix',
  'ASP CornerMatrix'
]
WHERE mercados_ativos IS NOT NULL;

-- Limpeza retroativa de linhas concorrentes do mesmo evento/mercado.
-- Escopo: somente grupos ja validados como CONFIRMA/PULAR em mercados de multiplas linhas.
-- Regra:
-- 1) Se existir CONFIRMA no grupo, mantem a melhor CONFIRMA e remove as demais linhas do grupo.
-- 2) Se todas forem PULAR, mantem a melhor PULAR e remove as demais.
-- A escolha usa um score simples e auditavel: edge efetivo, probabilidade e odd ofertada.
WITH candidatos AS (
  SELECT
    p.id,
    p.status_validacao,
    p.created_at,
    (
      COALESCE(p.edge_ajustado, p.edge, 0) * 2
      + COALESCE(p.probabilidade_final, 0)
      + COALESCE(p.odd_ofertada, 0)
    ) AS score_linha,
    concat_ws(
      '|',
      lower(trim(COALESCE(p.esporte, ''))),
      lower(trim(COALESCE(p.liga, ''))),
      COALESCE(p.data::text, ''),
      COALESCE(p.hora::text, ''),
      lower(trim(COALESCE(NULLIF(p.jogo, ''), concat_ws(' vs ', p.mandante, p.visitante), ''))),
      lower(trim(COALESCE(p.mercado, '')))
    ) AS grupo_key
  FROM public.prognosticos p
  WHERE p.status_validacao IN ('CONFIRMA', 'PULAR')
    AND p.mercado IN ('Total de Gols', 'Total de Pontos', 'Total de Corridas', U&'Handicap Asi\00E1tico')
),
grupos AS (
  SELECT
    grupo_key,
    COUNT(*) AS total_linhas,
    COUNT(*) FILTER (WHERE status_validacao = 'CONFIRMA') AS total_confirmadas
  FROM candidatos
  GROUP BY grupo_key
  HAVING COUNT(*) > 1
),
rankeadas AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.grupo_key
      ORDER BY
        CASE
          WHEN g.total_confirmadas > 0 AND c.status_validacao = 'CONFIRMA' THEN 0
          WHEN g.total_confirmadas > 0 THEN 1
          ELSE 0
        END,
        c.score_linha DESC,
        c.created_at ASC,
        c.id ASC
    ) AS rn
  FROM candidatos c
  JOIN grupos g ON g.grupo_key = c.grupo_key
),
remover AS (
  SELECT id
  FROM rankeadas
  WHERE rn > 1
)
DELETE FROM public.prognosticos p
USING remover r
WHERE p.id = r.id;
