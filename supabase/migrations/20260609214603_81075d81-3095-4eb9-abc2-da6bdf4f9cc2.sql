
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
  -- Somente CONFIRMA conta para banca/ROI/yield/drawdown
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
END; $function$;

-- Recalcula bankroll histórico para refletir o novo critério (somente CONFIRMA)
DELETE FROM public.bankroll_historico;

DO $$
DECLARE
  cfg RECORD;
  r RECORD;
  prog RECORD;
  lucro_reais NUMERIC(12,2);
  banca NUMERIC(12,2);
  lucro_acum NUMERIC(12,2);
  total_stake NUMERIC(12,2);
  roi NUMERIC(8,4);
  yld NUMERIC(8,4);
  pico NUMERIC(12,2);
  dd NUMERIC(8,4);
BEGIN
  SELECT * INTO cfg FROM public.configuracoes ORDER BY created_at ASC LIMIT 1;
  IF cfg IS NULL THEN RETURN; END IF;
  banca := cfg.banca_inicial;
  lucro_acum := 0;
  pico := cfg.banca_inicial;
  FOR r IN
    SELECT res.* FROM public.resultados res
    JOIN public.prognosticos p ON p.id = res.prognostico_id
    WHERE p.status_validacao = 'CONFIRMA'
    ORDER BY res.data_resultado ASC, res.created_at ASC
  LOOP
    lucro_reais := COALESCE(r.lucro_prejuizo,0) * cfg.valor_unidade_padrao;
    banca := banca + lucro_reais;
    lucro_acum := lucro_acum + lucro_reais;
    SELECT COALESCE(SUM(stake),0) INTO total_stake
      FROM public.prognosticos
      WHERE resultado <> 'PENDENTE' AND status_validacao = 'CONFIRMA';
    roi := CASE WHEN cfg.banca_inicial > 0 THEN (lucro_acum / cfg.banca_inicial) ELSE 0 END;
    yld := CASE WHEN total_stake > 0 THEN (lucro_acum / (total_stake * cfg.valor_unidade_padrao)) ELSE 0 END;
    pico := GREATEST(pico, banca);
    dd := CASE WHEN pico > 0 THEN ((pico - banca) / pico) ELSE 0 END;
    INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
    VALUES (r.data_resultado, cfg.banca_inicial, banca, cfg.valor_unidade_padrao, lucro_acum, roi, yld, dd);
  END LOOP;
END $$;
