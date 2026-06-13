
-- Prognósticos: novos campos
ALTER TABLE public.prognosticos
  ADD COLUMN IF NOT EXISTS odd_ajustada numeric(8,3),
  ADD COLUMN IF NOT EXISTS edge_ajustado numeric(8,4),
  ADD COLUMN IF NOT EXISTS dados_tecnicos text;

-- Backfill dados_tecnicos a partir de observacoes (não sobrescrever se já preenchido)
UPDATE public.prognosticos
   SET dados_tecnicos = observacoes
 WHERE dados_tecnicos IS NULL AND observacoes IS NOT NULL;

-- Validações: novos campos
ALTER TABLE public.validacoes
  ADD COLUMN IF NOT EXISTS parecer_validacao text,
  ADD COLUMN IF NOT EXISTS contexto_adicional text,
  ADD COLUMN IF NOT EXISTS parecer_ia text,
  ADD COLUMN IF NOT EXISTS decisao_ia_sugerida text,
  ADD COLUMN IF NOT EXISTS stake_ia_sugerida numeric(8,2),
  ADD COLUMN IF NOT EXISTS data_analise_ia timestamptz,
  ADD COLUMN IF NOT EXISTS prompt_versao text;

-- Backfill parecer_validacao a partir dos campos antigos
UPDATE public.validacoes
   SET parecer_validacao = trim(both E'\n' FROM
     COALESCE(NULLIF('Tese: ' || COALESCE(justificativa,''), 'Tese: '), '') ||
     CASE WHEN riscos_identificados IS NOT NULL AND riscos_identificados <> ''
          THEN E'\n\nRiscos: ' || riscos_identificados ELSE '' END ||
     CASE WHEN comentarios_analista IS NOT NULL AND comentarios_analista <> ''
          THEN E'\n\nComentários: ' || comentarios_analista ELSE '' END
   )
 WHERE parecer_validacao IS NULL
   AND (justificativa IS NOT NULL OR riscos_identificados IS NOT NULL OR comentarios_analista IS NOT NULL);

-- Atualizar apply_resultado para usar odd ajustada quando disponível
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
  IF prog.status_validacao NOT IN ('CONFIRMA', 'CONFIRMA_CAUTELA') THEN
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
      AND status_validacao IN ('CONFIRMA', 'CONFIRMA_CAUTELA');
  novo_roi := CASE WHEN cfg.banca_inicial > 0 THEN (novo_lucro / cfg.banca_inicial) ELSE 0 END;
  novo_yield := CASE WHEN total_stake > 0 THEN (novo_lucro / (total_stake * cfg.valor_unidade_padrao)) ELSE 0 END;

  SELECT GREATEST(COALESCE(MAX(banca_atual), cfg.banca_inicial), nova_banca) INTO pico FROM public.bankroll_historico;
  novo_drawdown := CASE WHEN pico > 0 THEN ((pico - nova_banca) / pico) ELSE 0 END;

  INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
  VALUES (NEW.data_resultado, cfg.banca_inicial, nova_banca, cfg.valor_unidade_padrao, novo_lucro, novo_roi, novo_yield, novo_drawdown);

  RETURN NEW;
END; $function$;
