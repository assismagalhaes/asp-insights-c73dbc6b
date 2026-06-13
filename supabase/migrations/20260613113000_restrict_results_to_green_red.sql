-- Keep only GREEN/RED as settled result outcomes.
-- Unsupported historical outcomes are removed from resultados and reset on prognosticos.

DELETE FROM public.resultados
WHERE resultado NOT IN ('GREEN', 'RED');

UPDATE public.prognosticos
SET resultado = 'PENDENTE',
    lucro_prejuizo = NULL
WHERE resultado NOT IN ('PENDENTE', 'GREEN', 'RED');

UPDATE public.resultados r
SET lucro_prejuizo = CASE
  WHEN r.resultado = 'GREEN' THEN ROUND((p.stake * ((CASE WHEN p.odd_ajustada IS NOT NULL AND p.odd_ajustada > 0 THEN p.odd_ajustada ELSE p.odd_ofertada END) - 1))::numeric, 2)
  WHEN r.resultado = 'RED' THEN ROUND((-p.stake)::numeric, 2)
  ELSE 0
END
FROM public.prognosticos p
WHERE p.id = r.prognostico_id;

UPDATE public.prognosticos p
SET lucro_prejuizo = r.lucro_prejuizo
FROM (
  SELECT DISTINCT ON (prognostico_id)
    prognostico_id,
    lucro_prejuizo
  FROM public.resultados
  ORDER BY prognostico_id, created_at DESC
) r
WHERE p.id = r.prognostico_id
  AND p.resultado IN ('GREEN', 'RED');

ALTER TABLE public.prognosticos
  DROP CONSTRAINT IF EXISTS prognosticos_resultado_check;

ALTER TABLE public.prognosticos
  ADD CONSTRAINT prognosticos_resultado_check
  CHECK (resultado IN ('PENDENTE', 'GREEN', 'RED'));

ALTER TABLE public.resultados
  DROP CONSTRAINT IF EXISTS resultados_resultado_check;

ALTER TABLE public.resultados
  ADD CONSTRAINT resultados_resultado_check
  CHECK (resultado IN ('GREEN', 'RED'));

CREATE OR REPLACE FUNCTION public.apply_resultado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg RECORD;
  prog RECORD;
  ultimo RECORD;
  odd_efetiva NUMERIC(8,3);
  lucro_unidades NUMERIC(10,2);
  lucro_reais NUMERIC(12,2);
  nova_banca NUMERIC(12,2);
  novo_lucro NUMERIC(12,2);
  total_stake NUMERIC(12,2);
  novo_roi NUMERIC(8,4);
  novo_yield NUMERIC(8,4);
  pico NUMERIC(12,2);
  novo_drawdown NUMERIC(8,4);
BEGIN
  SELECT * INTO prog FROM public.prognosticos WHERE id = NEW.prognostico_id;
  IF prog IS NULL THEN RETURN NEW; END IF;

  odd_efetiva := CASE
    WHEN prog.odd_ajustada IS NOT NULL AND prog.odd_ajustada > 0 THEN prog.odd_ajustada
    ELSE prog.odd_ofertada
  END;

  lucro_unidades := CASE
    WHEN NEW.resultado = 'GREEN' THEN ROUND((prog.stake * (odd_efetiva - 1))::numeric, 2)
    WHEN NEW.resultado = 'RED' THEN ROUND((-prog.stake)::numeric, 2)
    ELSE 0
  END;

  UPDATE public.resultados
    SET lucro_prejuizo = lucro_unidades
    WHERE id = NEW.id;

  UPDATE public.prognosticos
    SET resultado = NEW.resultado,
        lucro_prejuizo = lucro_unidades,
        status_publicacao = CASE
          WHEN status_publicacao = 'CANCELADO' THEN 'CANCELADO'
          ELSE 'FINALIZADO'
        END
    WHERE id = NEW.prognostico_id;

  IF prog.status_validacao <> 'CONFIRMA' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM public.configuracoes ORDER BY created_at ASC LIMIT 1;
  IF cfg IS NULL THEN RETURN NEW; END IF;

  lucro_reais := lucro_unidades * cfg.valor_unidade_padrao;

  SELECT * INTO ultimo FROM public.bankroll_historico ORDER BY data DESC, created_at DESC LIMIT 1;

  IF ultimo IS NULL THEN
    nova_banca := cfg.banca_inicial + lucro_reais;
    novo_lucro := lucro_reais;
  ELSE
    nova_banca := ultimo.banca_atual + lucro_reais;
    novo_lucro := ultimo.lucro_acumulado + lucro_reais;
  END IF;

  SELECT COALESCE(SUM(stake),0) INTO total_stake
    FROM public.prognosticos
    WHERE resultado <> 'PENDENTE'
      AND status_validacao = 'CONFIRMA';
  novo_roi := CASE WHEN cfg.banca_inicial > 0 THEN (novo_lucro / cfg.banca_inicial) ELSE 0 END;
  novo_yield := CASE WHEN total_stake > 0 THEN (novo_lucro / (total_stake * cfg.valor_unidade_padrao)) ELSE 0 END;

  SELECT GREATEST(COALESCE(MAX(banca_atual), cfg.banca_inicial), nova_banca) INTO pico FROM public.bankroll_historico;
  novo_drawdown := CASE WHEN pico > 0 THEN ((pico - nova_banca) / pico) ELSE 0 END;

  INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
  VALUES (NEW.data_resultado, cfg.banca_inicial, nova_banca, cfg.valor_unidade_padrao, novo_lucro, novo_roi, novo_yield, novo_drawdown);

  RETURN NEW;
END;
$function$;
