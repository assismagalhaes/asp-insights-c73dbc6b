-- Collapse validation decisions to the two real business outcomes:
-- CONFIRMA stays confirmable/publicable; every non-confirmed decision becomes PULAR.

UPDATE public.prognosticos
SET status_validacao = 'PULAR'
WHERE status_validacao NOT IN ('PENDENTE', 'CONFIRMA', 'PULAR');

UPDATE public.validacoes
SET decisao = 'PULAR'
WHERE decisao <> 'CONFIRMA';

ALTER TABLE public.prognosticos
  DROP CONSTRAINT IF EXISTS prognosticos_status_validacao_check;

ALTER TABLE public.prognosticos
  ADD CONSTRAINT prognosticos_status_validacao_check
  CHECK (status_validacao IN ('PENDENTE', 'CONFIRMA', 'PULAR'));

ALTER TABLE public.validacoes
  DROP CONSTRAINT IF EXISTS validacoes_decisao_check;

ALTER TABLE public.validacoes
  ADD CONSTRAINT validacoes_decisao_check
  CHECK (decisao IN ('CONFIRMA', 'PULAR'));

CREATE OR REPLACE FUNCTION public.apply_resultado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg RECORD;
  prog RECORD;
  ultimo RECORD;
  lucro_reais NUMERIC(12,2);
  nova_banca NUMERIC(12,2);
  novo_lucro NUMERIC(12,2);
  total_stake NUMERIC(12,2);
  novo_roi NUMERIC(8,4);
  novo_yield NUMERIC(8,4);
  pico NUMERIC(12,2);
  novo_drawdown NUMERIC(8,4);
BEGIN
  UPDATE public.prognosticos
    SET resultado = NEW.resultado,
        lucro_prejuizo = NEW.lucro_prejuizo,
        status_publicacao = CASE
          WHEN status_publicacao = 'CANCELADO' THEN 'CANCELADO'
          ELSE 'FINALIZADO'
        END
    WHERE id = NEW.prognostico_id;

  SELECT * INTO prog FROM public.prognosticos WHERE id = NEW.prognostico_id;
  IF prog.status_validacao <> 'CONFIRMA' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM public.configuracoes ORDER BY created_at ASC LIMIT 1;
  IF cfg IS NULL THEN RETURN NEW; END IF;

  lucro_reais := COALESCE(NEW.lucro_prejuizo,0) * cfg.valor_unidade_padrao;

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
