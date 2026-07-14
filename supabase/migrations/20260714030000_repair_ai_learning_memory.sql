-- Repair and harden the operational AI learning memory.
-- The production project may not have the two V1 tables because the original
-- migration was skipped. This migration is intentionally idempotent.

CREATE TABLE IF NOT EXISTS public.analises_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id uuid REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  validacao_id uuid NULL,
  modo_ia text NOT NULL DEFAULT 'desconhecido',
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
  resultado_teorico text NULL,
  resultado_financeiro text NULL,
  conta_bankroll boolean NOT NULL DEFAULT false,
  lucro_prejuizo numeric NULL,
  lucro_unidades numeric NULL,
  lucro_teorico_unidades numeric NULL,
  lucro_financeiro_unidades numeric NULL,
  odd_usada numeric NULL,
  probabilidade_final numeric NULL,
  edge_usado numeric NULL,
  tags_risco jsonb NULL,
  fontes_consultadas jsonb NULL,
  buscas_realizadas jsonb NULL,
  acertou_ia boolean NULL,
  acertou_humano boolean NULL,
  divergencia_ia_humano boolean NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Complete partially-created schemas too.
ALTER TABLE public.analises_ia
  ADD COLUMN IF NOT EXISTS validacao_id uuid NULL,
  ADD COLUMN IF NOT EXISTS contexto_analisado text NULL,
  ADD COLUMN IF NOT EXISTS tags_risco jsonb NULL,
  ADD COLUMN IF NOT EXISTS fontes_consultadas jsonb NULL,
  ADD COLUMN IF NOT EXISTS buscas_realizadas jsonb NULL,
  ADD COLUMN IF NOT EXISTS prompt_versao text NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.feedback_ia_resultados
  ADD COLUMN IF NOT EXISTS resultado_teorico text NULL,
  ADD COLUMN IF NOT EXISTS resultado_financeiro text NULL,
  ADD COLUMN IF NOT EXISTS conta_bankroll boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lucro_teorico_unidades numeric NULL,
  ADD COLUMN IF NOT EXISTS lucro_financeiro_unidades numeric NULL,
  ADD COLUMN IF NOT EXISTS tags_risco jsonb NULL,
  ADD COLUMN IF NOT EXISTS fontes_consultadas jsonb NULL,
  ADD COLUMN IF NOT EXISTS buscas_realizadas jsonb NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.analises_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_ia_resultados ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analises_ia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_ia_resultados TO authenticated;
GRANT ALL ON public.analises_ia TO service_role;
GRANT ALL ON public.feedback_ia_resultados TO service_role;

DROP POLICY IF EXISTS "admins manage analises_ia" ON public.analises_ia;
DROP POLICY IF EXISTS "authenticated manage analises_ia" ON public.analises_ia;
CREATE POLICY "authenticated manage analises_ia" ON public.analises_ia
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "admins manage feedback_ia_resultados" ON public.feedback_ia_resultados;
DROP POLICY IF EXISTS "authenticated manage feedback_ia_resultados" ON public.feedback_ia_resultados;
CREATE POLICY "authenticated manage feedback_ia_resultados" ON public.feedback_ia_resultados
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_analises_ia_prognostico_id
  ON public.analises_ia(prognostico_id);
CREATE INDEX IF NOT EXISTS idx_analises_ia_scope
  ON public.analises_ia(esporte, mercado, liga, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analises_ia_decisao_sugerida
  ON public.analises_ia(decisao_sugerida);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analises_ia_validacao_unique
  ON public.analises_ia(validacao_id)
  WHERE validacao_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_prognostico_id
  ON public.feedback_ia_resultados(prognostico_id);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_scope
  ON public.feedback_ia_resultados(esporte, mercado, liga, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_resultado_teorico
  ON public.feedback_ia_resultados(resultado_teorico);
CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_decisao_ia
  ON public.feedback_ia_resultados(decisao_ia_sugerida);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_ia_resultados_unique_analysis
  ON public.feedback_ia_resultados(prognostico_id, analise_ia_id);

DROP TRIGGER IF EXISTS trg_analises_ia_touch_updated_at ON public.analises_ia;
CREATE TRIGGER trg_analises_ia_touch_updated_at
  BEFORE UPDATE ON public.analises_ia
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_feedback_ia_touch_updated_at ON public.feedback_ia_resultados;
CREATE TRIGGER trg_feedback_ia_touch_updated_at
  BEFORE UPDATE ON public.feedback_ia_resultados
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Recover snapshots from validations already stored before the learning tables existed.
INSERT INTO public.analises_ia (
  prognostico_id,
  validacao_id,
  modo_ia,
  esporte,
  liga,
  mercado,
  pick,
  linha,
  jogo,
  data_evento,
  hora_evento,
  odd_usada,
  probabilidade_final,
  edge_usado,
  contexto_analisado,
  parecer_ia,
  decisao_sugerida,
  stake_sugerida,
  riscos_identificados,
  fontes_consultadas,
  buscas_realizadas,
  prompt_versao,
  created_at,
  updated_at
)
SELECT
  p.id,
  v.id,
  COALESCE(NULLIF(v.modo_ia, ''), 'desconhecido'),
  p.esporte,
  p.liga,
  p.mercado,
  p.pick,
  NULL,
  p.jogo,
  p.data,
  p.hora,
  COALESCE(p.odd_ajustada, p.odd_ofertada),
  p.probabilidade_final,
  COALESCE(p.edge_ajustado, p.edge),
  v.contexto_adicional,
  v.parecer_ia,
  CASE
    WHEN upper(COALESCE(v.decisao_ia_sugerida, '')) LIKE ANY (ARRAY['%PULAR%', '%PASS%', '%AGUARDAR%']) THEN 'PULAR'
    WHEN upper(COALESCE(v.decisao_ia_sugerida, '')) LIKE '%CONFIRMA%' THEN 'CONFIRMAR'
    ELSE NULL
  END,
  v.stake_ia_sugerida,
  v.parecer_ia,
  v.fontes_consultadas,
  v.buscas_realizadas,
  v.prompt_versao,
  COALESCE(v.data_analise_ia, v.created_at),
  COALESCE(v.data_analise_ia, v.created_at)
FROM public.validacoes v
JOIN public.prognosticos p ON p.id = v.prognostico_id
WHERE v.decisao_ia_sugerida IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.analises_ia a WHERE a.validacao_id = v.id
  );

-- Keep feedback complete even when a result is written by the VM, SQL or another client.
CREATE OR REPLACE FUNCTION public.sync_ai_learning_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p public.prognosticos%ROWTYPE;
  v public.validacoes%ROWTYPE;
  a public.analises_ia%ROWTYPE;
  normalized_result text;
  ai_decision text;
  human_decision text;
  counts_bankroll boolean;
BEGIN
  normalized_result := CASE
    WHEN upper(COALESCE(NEW.resultado, '')) IN ('GREEN', 'WIN', 'WINS') THEN 'GREEN'
    WHEN upper(COALESCE(NEW.resultado, '')) IN ('RED', 'LOSS', 'LOSSES') THEN 'RED'
    ELSE NULL
  END;
  IF normalized_result IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO p FROM public.prognosticos WHERE id = NEW.prognostico_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v
  FROM public.validacoes
  WHERE prognostico_id = NEW.prognostico_id
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT * INTO a
  FROM public.analises_ia
  WHERE prognostico_id = NEW.prognostico_id
    AND decisao_sugerida IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF a.id IS NULL AND v.id IS NOT NULL AND v.decisao_ia_sugerida IS NOT NULL THEN
    INSERT INTO public.analises_ia (
      prognostico_id, validacao_id, modo_ia, esporte, liga, mercado, pick, linha,
      jogo, data_evento, hora_evento, odd_usada, probabilidade_final, edge_usado,
      contexto_analisado, parecer_ia, decisao_sugerida, stake_sugerida,
      riscos_identificados, fontes_consultadas, buscas_realizadas, prompt_versao,
      created_at, updated_at
    ) VALUES (
      p.id, v.id, COALESCE(NULLIF(v.modo_ia, ''), 'desconhecido'), p.esporte, p.liga,
      p.mercado, p.pick, NULL, p.jogo, p.data, p.hora,
      COALESCE(p.odd_ajustada, p.odd_ofertada), p.probabilidade_final,
      COALESCE(p.edge_ajustado, p.edge), v.contexto_adicional, v.parecer_ia,
      v.decisao_ia_sugerida, v.stake_ia_sugerida, v.parecer_ia,
      v.fontes_consultadas, v.buscas_realizadas, v.prompt_versao,
      COALESCE(v.data_analise_ia, v.created_at), COALESCE(v.data_analise_ia, v.created_at)
    )
    ON CONFLICT (validacao_id) WHERE validacao_id IS NOT NULL DO UPDATE
      SET parecer_ia = EXCLUDED.parecer_ia,
          decisao_sugerida = EXCLUDED.decisao_sugerida,
          stake_sugerida = EXCLUDED.stake_sugerida,
          updated_at = now()
    RETURNING * INTO a;
  END IF;

  ai_decision := CASE
    WHEN upper(COALESCE(a.decisao_sugerida, v.decisao_ia_sugerida, '')) LIKE ANY (ARRAY['%PULAR%', '%PASS%', '%AGUARDAR%']) THEN 'PULAR'
    WHEN upper(COALESCE(a.decisao_sugerida, v.decisao_ia_sugerida, '')) LIKE '%CONFIRMA%' THEN 'CONFIRMAR'
    ELSE NULL
  END;
  IF ai_decision IS NULL OR a.id IS NULL THEN RETURN NEW; END IF;

  human_decision := CASE
    WHEN upper(COALESCE(v.decisao, p.status_validacao, '')) LIKE '%CONFIRMA%' THEN 'CONFIRMAR'
    WHEN upper(COALESCE(v.decisao, p.status_validacao, '')) LIKE ANY (ARRAY['%PULAR%', '%PASS%', '%AGUARDAR%']) THEN 'PULAR'
    ELSE NULL
  END;
  counts_bankroll := human_decision = 'CONFIRMAR';

  INSERT INTO public.feedback_ia_resultados (
    prognostico_id, analise_ia_id, modo_ia, esporte, liga, mercado, pick, linha, jogo,
    decisao_ia_sugerida, stake_ia_sugerida, decisao_humana_final, stake_humana_final,
    resultado_real, resultado_teorico, resultado_financeiro, conta_bankroll,
    lucro_prejuizo, lucro_unidades, lucro_teorico_unidades, lucro_financeiro_unidades,
    odd_usada, probabilidade_final, edge_usado, tags_risco, fontes_consultadas,
    buscas_realizadas, acertou_ia, acertou_humano, divergencia_ia_humano,
    created_at, updated_at
  ) VALUES (
    p.id, a.id, a.modo_ia, p.esporte, p.liga, p.mercado, p.pick, NULL, p.jogo,
    ai_decision, a.stake_sugerida, human_decision,
    COALESCE(v.stake_confirmada, p.stake), normalized_result, normalized_result,
    CASE WHEN counts_bankroll THEN normalized_result ELSE NULL END, counts_bankroll,
    CASE WHEN counts_bankroll THEN NEW.lucro_prejuizo ELSE 0 END,
    NEW.lucro_prejuizo, NEW.lucro_prejuizo,
    CASE WHEN counts_bankroll THEN NEW.lucro_prejuizo ELSE 0 END,
    COALESCE(p.odd_ajustada, p.odd_ofertada), p.probabilidade_final,
    COALESCE(p.edge_ajustado, p.edge), a.tags_risco, a.fontes_consultadas,
    a.buscas_realizadas,
    CASE WHEN ai_decision = 'CONFIRMAR' THEN normalized_result = 'GREEN' ELSE normalized_result = 'RED' END,
    CASE
      WHEN human_decision = 'CONFIRMAR' THEN normalized_result = 'GREEN'
      WHEN human_decision = 'PULAR' THEN normalized_result = 'RED'
      ELSE NULL
    END,
    CASE WHEN human_decision IS NULL THEN NULL ELSE ai_decision <> human_decision END,
    COALESCE(NEW.created_at, now()), now()
  )
  ON CONFLICT (prognostico_id, analise_ia_id) DO UPDATE SET
    modo_ia = EXCLUDED.modo_ia,
    decisao_ia_sugerida = EXCLUDED.decisao_ia_sugerida,
    stake_ia_sugerida = EXCLUDED.stake_ia_sugerida,
    decisao_humana_final = EXCLUDED.decisao_humana_final,
    stake_humana_final = EXCLUDED.stake_humana_final,
    resultado_real = EXCLUDED.resultado_real,
    resultado_teorico = EXCLUDED.resultado_teorico,
    resultado_financeiro = EXCLUDED.resultado_financeiro,
    conta_bankroll = EXCLUDED.conta_bankroll,
    lucro_prejuizo = EXCLUDED.lucro_prejuizo,
    lucro_unidades = EXCLUDED.lucro_unidades,
    lucro_teorico_unidades = EXCLUDED.lucro_teorico_unidades,
    lucro_financeiro_unidades = EXCLUDED.lucro_financeiro_unidades,
    odd_usada = EXCLUDED.odd_usada,
    probabilidade_final = EXCLUDED.probabilidade_final,
    edge_usado = EXCLUDED.edge_usado,
    tags_risco = EXCLUDED.tags_risco,
    fontes_consultadas = EXCLUDED.fontes_consultadas,
    buscas_realizadas = EXCLUDED.buscas_realizadas,
    acertou_ia = EXCLUDED.acertou_ia,
    acertou_humano = EXCLUDED.acertou_humano,
    divergencia_ia_humano = EXCLUDED.divergencia_ia_humano,
    updated_at = now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_ai_learning_feedback ON public.resultados;
CREATE TRIGGER trg_sync_ai_learning_feedback
  AFTER INSERT OR UPDATE OF resultado, lucro_prejuizo ON public.resultados
  FOR EACH ROW EXECUTE FUNCTION public.sync_ai_learning_feedback();

-- Backfill resolved results without touching resultados (and therefore bankroll triggers).
INSERT INTO public.feedback_ia_resultados (
  prognostico_id, analise_ia_id, modo_ia, esporte, liga, mercado, pick, linha, jogo,
  decisao_ia_sugerida, stake_ia_sugerida, decisao_humana_final, stake_humana_final,
  resultado_real, resultado_teorico, resultado_financeiro, conta_bankroll,
  lucro_prejuizo, lucro_unidades, lucro_teorico_unidades, lucro_financeiro_unidades,
  odd_usada, probabilidade_final, edge_usado, tags_risco, fontes_consultadas,
  buscas_realizadas, acertou_ia, acertou_humano, divergencia_ia_humano,
  created_at, updated_at
)
SELECT
  p.id,
  a.id,
  a.modo_ia,
  p.esporte,
  p.liga,
  p.mercado,
  p.pick,
  NULL,
  p.jogo,
  d.ai_decision,
  a.stake_sugerida,
  d.human_decision,
  COALESCE(v.stake_confirmada, p.stake),
  d.normalized_result,
  d.normalized_result,
  CASE WHEN d.human_decision = 'CONFIRMAR' THEN d.normalized_result ELSE NULL END,
  d.human_decision = 'CONFIRMAR',
  CASE WHEN d.human_decision = 'CONFIRMAR' THEN r.lucro_prejuizo ELSE 0 END,
  r.lucro_prejuizo,
  r.lucro_prejuizo,
  CASE WHEN d.human_decision = 'CONFIRMAR' THEN r.lucro_prejuizo ELSE 0 END,
  COALESCE(p.odd_ajustada, p.odd_ofertada),
  p.probabilidade_final,
  COALESCE(p.edge_ajustado, p.edge),
  a.tags_risco,
  a.fontes_consultadas,
  a.buscas_realizadas,
  CASE WHEN d.ai_decision = 'CONFIRMAR' THEN d.normalized_result = 'GREEN' ELSE d.normalized_result = 'RED' END,
  CASE WHEN d.human_decision = 'CONFIRMAR' THEN d.normalized_result = 'GREEN' ELSE d.normalized_result = 'RED' END,
  d.ai_decision <> d.human_decision,
  r.created_at,
  now()
FROM public.prognosticos p
JOIN LATERAL (
  SELECT * FROM public.resultados rr
  WHERE rr.prognostico_id = p.id
  ORDER BY rr.created_at DESC
  LIMIT 1
) r ON true
JOIN LATERAL (
  SELECT * FROM public.validacoes vv
  WHERE vv.prognostico_id = p.id
    AND vv.decisao_ia_sugerida IS NOT NULL
  ORDER BY vv.created_at DESC
  LIMIT 1
) v ON true
JOIN LATERAL (
  SELECT * FROM public.analises_ia aa
  WHERE aa.prognostico_id = p.id
    AND aa.decisao_sugerida IS NOT NULL
  ORDER BY aa.created_at DESC
  LIMIT 1
) a ON true
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN upper(COALESCE(r.resultado, '')) IN ('GREEN', 'WIN', 'WINS') THEN 'GREEN'
      WHEN upper(COALESCE(r.resultado, '')) IN ('RED', 'LOSS', 'LOSSES') THEN 'RED'
      ELSE NULL
    END AS normalized_result,
    CASE
      WHEN upper(COALESCE(a.decisao_sugerida, v.decisao_ia_sugerida, '')) LIKE ANY (ARRAY['%PULAR%', '%PASS%', '%AGUARDAR%']) THEN 'PULAR'
      WHEN upper(COALESCE(a.decisao_sugerida, v.decisao_ia_sugerida, '')) LIKE '%CONFIRMA%' THEN 'CONFIRMAR'
      ELSE NULL
    END AS ai_decision,
    CASE
      WHEN upper(COALESCE(v.decisao, p.status_validacao, '')) LIKE '%CONFIRMA%' THEN 'CONFIRMAR'
      WHEN upper(COALESCE(v.decisao, p.status_validacao, '')) LIKE ANY (ARRAY['%PULAR%', '%PASS%', '%AGUARDAR%']) THEN 'PULAR'
      ELSE NULL
    END AS human_decision
) d
WHERE d.normalized_result IS NOT NULL
  AND d.ai_decision IS NOT NULL
  AND d.human_decision IS NOT NULL
ON CONFLICT (prognostico_id, analise_ia_id) DO UPDATE SET
  resultado_real = EXCLUDED.resultado_real,
  resultado_teorico = EXCLUDED.resultado_teorico,
  resultado_financeiro = EXCLUDED.resultado_financeiro,
  conta_bankroll = EXCLUDED.conta_bankroll,
  lucro_prejuizo = EXCLUDED.lucro_prejuizo,
  lucro_unidades = EXCLUDED.lucro_unidades,
  lucro_teorico_unidades = EXCLUDED.lucro_teorico_unidades,
  lucro_financeiro_unidades = EXCLUDED.lucro_financeiro_unidades,
  acertou_ia = EXCLUDED.acertou_ia,
  acertou_humano = EXCLUDED.acertou_humano,
  divergencia_ia_humano = EXCLUDED.divergencia_ia_humano,
  updated_at = now();
