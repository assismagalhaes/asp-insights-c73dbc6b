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
  counts_bankroll := COALESCE(human_decision = 'CONFIRMAR', false);

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

REVOKE EXECUTE ON FUNCTION public.sync_ai_learning_feedback() FROM PUBLIC, anon, authenticated;