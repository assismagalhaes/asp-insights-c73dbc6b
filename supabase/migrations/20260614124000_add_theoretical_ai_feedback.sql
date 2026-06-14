-- AI Learning V1.1: separate theoretical outcome from financial outcome.
-- PULAR can receive GREEN/RED for learning without affecting bankroll.

ALTER TABLE public.feedback_ia_resultados
  ADD COLUMN IF NOT EXISTS resultado_teorico text NULL,
  ADD COLUMN IF NOT EXISTS resultado_financeiro text NULL,
  ADD COLUMN IF NOT EXISTS conta_bankroll boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lucro_teorico_unidades numeric NULL,
  ADD COLUMN IF NOT EXISTS lucro_financeiro_unidades numeric NULL;

UPDATE public.feedback_ia_resultados
SET
  resultado_teorico = COALESCE(resultado_teorico, resultado_real),
  resultado_financeiro = COALESCE(resultado_financeiro, CASE WHEN decisao_humana_final = 'CONFIRMAR' THEN resultado_real ELSE NULL END),
  conta_bankroll = CASE WHEN decisao_humana_final = 'CONFIRMAR' THEN true ELSE COALESCE(conta_bankroll, false) END,
  lucro_teorico_unidades = COALESCE(lucro_teorico_unidades, lucro_unidades),
  lucro_financeiro_unidades = COALESCE(lucro_financeiro_unidades, CASE WHEN decisao_humana_final = 'CONFIRMAR' THEN lucro_unidades ELSE 0 END);

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_resultado_teorico
ON public.feedback_ia_resultados(resultado_teorico);

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_resultado_financeiro
ON public.feedback_ia_resultados(resultado_financeiro);

CREATE INDEX IF NOT EXISTS idx_feedback_ia_resultados_conta_bankroll
ON public.feedback_ia_resultados(conta_bankroll);
