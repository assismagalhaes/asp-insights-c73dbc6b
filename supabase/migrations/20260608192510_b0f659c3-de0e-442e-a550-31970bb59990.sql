
-- Atualiza trigger de apply_resultado para considerar somente prognosticos validados como CONFIRMA / CONFIRMA COM CAUTELA na evolucao de banca
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
  -- Somente confirma / confirma com cautela contam para banca/ROI/yield/drawdown
  IF prog.status_validacao NOT IN ('CONFIRMA','CONFIRMA COM CAUTELA') THEN
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
      AND status_validacao IN ('CONFIRMA','CONFIRMA COM CAUTELA');
  novo_roi := CASE WHEN cfg.banca_inicial > 0 THEN (novo_lucro / cfg.banca_inicial) ELSE 0 END;
  novo_yield := CASE WHEN total_stake > 0 THEN (novo_lucro / (total_stake * cfg.valor_unidade_padrao)) ELSE 0 END;

  SELECT GREATEST(COALESCE(MAX(banca_atual), cfg.banca_inicial), nova_banca) INTO pico FROM public.bankroll_historico;
  novo_drawdown := CASE WHEN pico > 0 THEN ((pico - nova_banca) / pico) ELSE 0 END;

  INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
  VALUES (NEW.data_resultado, cfg.banca_inicial, nova_banca, cfg.valor_unidade_padrao, novo_lucro, novo_roi, novo_yield, novo_drawdown);

  RETURN NEW;
END; $function$;

-- Recalcula bankroll_historico a partir do zero, considerando apenas confirmados
DO $$
DECLARE
  cfg RECORD;
  r RECORD;
  banca NUMERIC(12,2);
  lucro_acc NUMERIC(12,2) := 0;
  lucro_reais NUMERIC(12,2);
  pico NUMERIC(12,2);
  total_stake NUMERIC(12,2);
  novo_roi NUMERIC(8,4);
  novo_yield NUMERIC(8,4);
  novo_drawdown NUMERIC(8,4);
BEGIN
  SELECT * INTO cfg FROM public.configuracoes ORDER BY created_at ASC LIMIT 1;
  IF cfg IS NULL THEN RETURN; END IF;

  DELETE FROM public.bankroll_historico;
  banca := cfg.banca_inicial;
  pico := cfg.banca_inicial;
  total_stake := 0;

  FOR r IN
    SELECT res.data_resultado, res.lucro_prejuizo, p.stake
    FROM public.resultados res
    JOIN public.prognosticos p ON p.id = res.prognostico_id
    WHERE p.status_validacao IN ('CONFIRMA','CONFIRMA COM CAUTELA')
    ORDER BY res.data_resultado ASC, res.created_at ASC
  LOOP
    lucro_reais := COALESCE(r.lucro_prejuizo,0) * cfg.valor_unidade_padrao;
    banca := banca + lucro_reais;
    lucro_acc := lucro_acc + lucro_reais;
    total_stake := total_stake + COALESCE(r.stake,0);
    IF banca > pico THEN pico := banca; END IF;
    novo_roi := CASE WHEN cfg.banca_inicial > 0 THEN (lucro_acc / cfg.banca_inicial) ELSE 0 END;
    novo_yield := CASE WHEN total_stake > 0 THEN (lucro_acc / (total_stake * cfg.valor_unidade_padrao)) ELSE 0 END;
    novo_drawdown := CASE WHEN pico > 0 THEN ((pico - banca) / pico) ELSE 0 END;
    INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
    VALUES (r.data_resultado, cfg.banca_inicial, banca, cfg.valor_unidade_padrao, lucro_acc, novo_roi, novo_yield, novo_drawdown);
  END LOOP;
END $$;
