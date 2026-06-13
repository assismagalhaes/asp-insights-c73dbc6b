-- Runtime schema repair for deployed databases that missed or partially applied
-- earlier migrations. This file is intentionally idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

ALTER TABLE public.prognosticos
  ADD COLUMN IF NOT EXISTS hora TIME,
  ADD COLUMN IF NOT EXISTS odd_ajustada NUMERIC,
  ADD COLUMN IF NOT EXISTS edge_ajustado NUMERIC,
  ADD COLUMN IF NOT EXISTS dados_tecnicos TEXT,
  ADD COLUMN IF NOT EXISTS data_publicacao TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tip_texto TEXT,
  ADD COLUMN IF NOT EXISTS publicado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publicado_por TEXT,
  ADD COLUMN IF NOT EXISTS canal_publicacao TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.prognosticos
SET dados_tecnicos = observacoes
WHERE dados_tecnicos IS NULL
  AND observacoes IS NOT NULL;

ALTER TABLE public.validacoes
  ADD COLUMN IF NOT EXISTS parecer_validacao TEXT,
  ADD COLUMN IF NOT EXISTS contexto_adicional TEXT,
  ADD COLUMN IF NOT EXISTS parecer_ia TEXT,
  ADD COLUMN IF NOT EXISTS decisao_ia_sugerida TEXT,
  ADD COLUMN IF NOT EXISTS stake_ia_sugerida NUMERIC,
  ADD COLUMN IF NOT EXISTS data_analise_ia TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prompt_versao TEXT,
  ADD COLUMN IF NOT EXISTS modo_ia TEXT,
  ADD COLUMN IF NOT EXISTS fontes_consultadas JSONB,
  ADD COLUMN IF NOT EXISTS buscas_realizadas JSONB;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS tipo_stake TEXT NOT NULL DEFAULT 'FIXO',
  ADD COLUMN IF NOT EXISTS percentual_unidade NUMERIC NOT NULL DEFAULT 1.0;

CREATE TABLE IF NOT EXISTS public.ligas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  esporte TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (esporte, nome)
);

ALTER TABLE public.ligas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read ligas" ON public.ligas;
CREATE POLICY "Authenticated users can read ligas"
ON public.ligas
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert ligas" ON public.ligas;
CREATE POLICY "Authenticated users can insert ligas"
ON public.ligas
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update ligas" ON public.ligas;
CREATE POLICY "Authenticated users can update ligas"
ON public.ligas
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ligas TO authenticated;
GRANT ALL ON public.ligas TO service_role;

DROP TRIGGER IF EXISTS ligas_set_updated_at ON public.ligas;
CREATE TRIGGER ligas_set_updated_at
BEFORE UPDATE ON public.ligas
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.ligas (nome, esporte)
SELECT DISTINCT trim(liga), esporte
FROM public.prognosticos
WHERE liga IS NOT NULL
  AND trim(liga) <> ''
ON CONFLICT (esporte, nome) DO NOTHING;

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
  ADD COLUMN IF NOT EXISTS alertas_online JSONB,
  ADD COLUMN IF NOT EXISTS tags_risco JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.feedback_ia_resultados
  ADD COLUMN IF NOT EXISTS modo_ia TEXT,
  ADD COLUMN IF NOT EXISTS divergencia_ia_humano BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
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
    SELECT 1 FROM information_schema.columns
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

ALTER TABLE public.analises_ia ALTER COLUMN tags_risco SET DEFAULT '[]'::jsonb;
ALTER TABLE public.feedback_ia_resultados ALTER COLUMN tags_risco SET DEFAULT '[]'::jsonb;

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

GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analises_ia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_ia_resultados TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resumos_aprendizado_ia TO authenticated;
GRANT ALL ON public.analises_ia TO service_role;
GRANT ALL ON public.feedback_ia_resultados TO service_role;
GRANT ALL ON public.resumos_aprendizado_ia TO service_role;

DROP TRIGGER IF EXISTS feedback_ia_resultados_set_updated_at ON public.feedback_ia_resultados;
CREATE TRIGGER feedback_ia_resultados_set_updated_at
BEFORE UPDATE ON public.feedback_ia_resultados
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS feedback_ia_resultados_unique_result_idx
ON public.feedback_ia_resultados (prognostico_id, analise_ia_id, resultado_real);

CREATE INDEX IF NOT EXISTS idx_analises_ia_prognostico_id ON public.analises_ia (prognostico_id);
CREATE INDEX IF NOT EXISTS idx_analises_ia_modo_ia ON public.analises_ia (modo_ia);
CREATE INDEX IF NOT EXISTS idx_analises_ia_filters ON public.analises_ia (esporte, liga, mercado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_prognostico_id ON public.feedback_ia_resultados (prognostico_id);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_resultado_real ON public.feedback_ia_resultados (resultado_real);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_modo_ia ON public.feedback_ia_resultados (modo_ia);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_filters ON public.feedback_ia_resultados (esporte, liga, mercado, created_at DESC);

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
    COALESCE(cfg.valor_unidade_padrao, 10) AS valor_unidade
  FROM latest_resultados r
  JOIN public.prognosticos p ON p.id = r.prognostico_id
  LEFT JOIN latest_validacoes v ON v.prognostico_id = p.id
  LEFT JOIN cfg ON true
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
  SELECT COALESCE(banca_inicial, 1000) AS banca_inicial
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
    COALESCE(cfg.banca_inicial, 1000) + SUM(daily.lucro_dia_reais) OVER (ORDER BY daily.data ASC) AS banca,
    COALESCE(cfg.banca_inicial, 1000) AS banca_inicial
  FROM daily
  LEFT JOIN cfg ON true
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

NOTIFY pgrst, 'reload schema';
