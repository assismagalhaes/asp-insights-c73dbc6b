
CREATE OR REPLACE FUNCTION public.apply_resultado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg RECORD;
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

  SELECT COALESCE(SUM(stake),0) INTO total_stake FROM public.prognosticos WHERE resultado <> 'PENDENTE';
  novo_roi := CASE WHEN cfg.banca_inicial > 0 THEN (novo_lucro / cfg.banca_inicial) ELSE 0 END;
  novo_yield := CASE WHEN total_stake > 0 THEN (novo_lucro / (total_stake * cfg.valor_unidade_padrao)) ELSE 0 END;

  SELECT GREATEST(COALESCE(MAX(banca_atual), cfg.banca_inicial), nova_banca) INTO pico FROM public.bankroll_historico;
  novo_drawdown := CASE WHEN pico > 0 THEN ((pico - nova_banca) / pico) ELSE 0 END;

  INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
  VALUES (NEW.data_resultado, cfg.banca_inicial, nova_banca, cfg.valor_unidade_padrao, novo_lucro, novo_roi, novo_yield, novo_drawdown);

  RETURN NEW;
END; $function$;

-- Recalcula o histórico de bankroll com a fórmula correta
DO $$
DECLARE
  cfg RECORD;
  r RECORD;
  banca NUMERIC(12,2);
  lucro_acc NUMERIC(12,2);
  pico NUMERIC(12,2);
  stake_acc NUMERIC(12,2) := 0;
  total_stake NUMERIC(12,2);
  lucro_reais NUMERIC(12,2);
  novo_roi NUMERIC(8,4);
  novo_yield NUMERIC(8,4);
  novo_dd NUMERIC(8,4);
BEGIN
  SELECT * INTO cfg FROM public.configuracoes ORDER BY created_at ASC LIMIT 1;
  IF cfg IS NULL THEN RETURN; END IF;

  DELETE FROM public.bankroll_historico;

  banca := cfg.banca_inicial;
  lucro_acc := 0;
  pico := cfg.banca_inicial;

  SELECT COALESCE(SUM(stake),0) INTO total_stake FROM public.prognosticos WHERE resultado <> 'PENDENTE';

  FOR r IN
    SELECT res.*, p.stake AS prog_stake
    FROM public.resultados res
    JOIN public.prognosticos p ON p.id = res.prognostico_id
    ORDER BY res.data_resultado ASC, res.created_at ASC
  LOOP
    lucro_reais := COALESCE(r.lucro_prejuizo,0) * cfg.valor_unidade_padrao;
    banca := banca + lucro_reais;
    lucro_acc := lucro_acc + lucro_reais;
    stake_acc := stake_acc + COALESCE(r.prog_stake,0);
    IF banca > pico THEN pico := banca; END IF;

    novo_roi := CASE WHEN cfg.banca_inicial > 0 THEN (lucro_acc / cfg.banca_inicial) ELSE 0 END;
    novo_yield := CASE WHEN stake_acc > 0 THEN (lucro_acc / (stake_acc * cfg.valor_unidade_padrao)) ELSE 0 END;
    novo_dd := CASE WHEN pico > 0 THEN ((pico - banca) / pico) ELSE 0 END;

    INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
    VALUES (r.data_resultado, cfg.banca_inicial, banca, cfg.valor_unidade_padrao, lucro_acc, novo_roi, novo_yield, novo_dd);
  END LOOP;
END $$;
