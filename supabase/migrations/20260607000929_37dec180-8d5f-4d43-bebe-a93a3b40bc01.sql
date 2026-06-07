ALTER TABLE public.prognosticos
  ADD COLUMN IF NOT EXISTS data_publicacao timestamptz,
  ADD COLUMN IF NOT EXISTS tip_texto text,
  ADD COLUMN IF NOT EXISTS publicado_em timestamptz,
  ADD COLUMN IF NOT EXISTS publicado_por text,
  ADD COLUMN IF NOT EXISTS canal_publicacao text;

-- Extend resultados to support more outcomes & update trigger to finalize publication
DROP TRIGGER IF EXISTS trg_resultados_apply ON public.resultados;

CREATE OR REPLACE FUNCTION public.apply_resultado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg RECORD;
  ultimo RECORD;
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

  SELECT * INTO ultimo FROM public.bankroll_historico ORDER BY data DESC, created_at DESC LIMIT 1;

  IF ultimo IS NULL THEN
    nova_banca := cfg.banca_inicial + COALESCE(NEW.lucro_prejuizo,0);
    novo_lucro := COALESCE(NEW.lucro_prejuizo,0);
  ELSE
    nova_banca := ultimo.banca_atual + COALESCE(NEW.lucro_prejuizo,0);
    novo_lucro := ultimo.lucro_acumulado + COALESCE(NEW.lucro_prejuizo,0);
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

CREATE TRIGGER trg_resultados_apply
AFTER INSERT ON public.resultados
FOR EACH ROW EXECUTE FUNCTION public.apply_resultado();