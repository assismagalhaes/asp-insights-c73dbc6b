CREATE OR REPLACE FUNCTION public._standardize_prediction_market_pick(
  p_model text, p_sport text, p_market text, p_pick text, p_line text, p_home text, p_away text
) RETURNS TABLE (market_out text, pick_out text) LANGUAGE plpgsql AS $$
DECLARE
  v_model text := lower(coalesce(p_model, ''));
  v_sport text := lower(coalesce(p_sport, ''));
  v_market text := lower(coalesce(p_market, ''));
  v_pick text := btrim(coalesce(p_pick, ''));
  v_pick_lower text := lower(btrim(coalesce(p_pick, '')));
  v_line text := replace(coalesce(nullif(btrim(p_line), ''), substring(coalesce(p_pick, '') from '([+-]?[0-9]+([.,][0-9]+)?)')), ',', '.');
  v_signed_line text;
  v_side text := '';
  v_direction text := '';
  v_btts text := '';
BEGIN
  IF v_line IS NOT NULL AND v_line ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN
    IF left(v_line, 1) IN ('+', '-') THEN v_signed_line := v_line;
    ELSIF v_line::numeric >= 0 THEN v_signed_line := '+' || v_line;
    ELSE v_signed_line := v_line; END IF;
  ELSE v_line := NULL; END IF;

  IF v_pick_lower ~ '(^| )(casa|mandante|home)( |$)'
     OR (coalesce(p_home, '') <> '' AND v_pick_lower LIKE '%' || lower(p_home) || '%') THEN v_side := 'home';
  ELSIF v_pick_lower ~ '(^| )(visitante|fora|away)( |$)'
     OR (coalesce(p_away, '') <> '' AND v_pick_lower LIKE '%' || lower(p_away) || '%') THEN v_side := 'away';
  ELSIF v_pick_lower LIKE '%empate%' OR v_pick_lower = 'x' THEN v_side := 'draw'; END IF;

  IF v_pick_lower LIKE '%under%' OR v_market LIKE '%under%' THEN v_direction := 'under';
  ELSIF v_pick_lower LIKE '%over%' OR v_market LIKE '%over%' THEN v_direction := 'over'; END IF;

  IF v_pick_lower ~ '(não|nao| no)( |$)' OR v_market ~ '(não|nao| no)( |$)' THEN v_btts := 'no';
  ELSIF v_pick_lower LIKE '%btts%' OR v_pick_lower LIKE '%sim%' OR v_market LIKE '%btts%' OR v_market LIKE '%ambas%' THEN v_btts := 'yes'; END IF;

  IF v_model LIKE '%goalmatrix%' THEN
    IF v_direction <> '' THEN
      market_out := CASE WHEN v_direction = 'over' THEN 'Over Gols' ELSE 'Under Gols' END;
      pick_out := initcap(v_direction) || CASE WHEN v_line IS NOT NULL THEN ' ' || v_line ELSE '' END;
    ELSE
      market_out := CASE WHEN v_btts = 'no' THEN 'Ambas Marcam Não' ELSE 'Ambas Marcam Sim' END;
      pick_out := CASE WHEN v_btts = 'no' THEN 'BTTS Não' ELSE 'BTTS Sim' END;
    END IF;
  ELSIF v_model LIKE '%cornermatrix%' THEN
    IF v_direction <> '' THEN
      market_out := CASE WHEN v_direction = 'over' THEN 'Over Cantos' ELSE 'Under Cantos' END;
      pick_out := initcap(v_direction) || CASE WHEN v_line IS NOT NULL THEN ' ' || v_line ELSE '' END;
    ELSIF v_market LIKE '%race%' OR v_pick_lower LIKE '%race%' THEN
      market_out := 'Race Cantos';
      pick_out := 'Race ' || coalesce(v_line, '') || ' Cantos ' || CASE WHEN v_side = 'home' THEN 'Casa' ELSE 'Visitante' END;
    ELSE
      market_out := 'Mais Cantos';
      pick_out := CASE WHEN v_side = 'home' THEN 'Mais Cantos Casa' ELSE 'Mais Cantos Visitante' END;
    END IF;
  ELSIF v_model LIKE '%matchmatrix%' THEN
    IF v_market LIKE '%dupla%' OR v_market LIKE '%double chance%' THEN
      market_out := 'Dupla Chance'; pick_out := upper(replace(v_pick, ' ', ''));
    ELSIF v_direction <> '' THEN
      market_out := CASE WHEN v_direction = 'over' THEN 'Over Gols' ELSE 'Under Gols' END;
      pick_out := initcap(v_direction) || CASE WHEN v_line IS NOT NULL THEN ' ' || v_line ELSE '' END;
    ELSIF v_market LIKE '%ambas%' OR v_market LIKE '%btts%' OR v_pick_lower LIKE '%ambas%' OR v_pick_lower LIKE '%btts%' THEN
      market_out := CASE WHEN v_btts = 'no' THEN 'Ambas Marcam Não' ELSE 'Ambas Marcam Sim' END;
      pick_out := CASE WHEN v_btts = 'no' THEN 'BTTS Não' ELSE 'BTTS Sim' END;
    ELSIF v_market LIKE '%handicap%' THEN
      market_out := 'Handicap Asiático';
      pick_out := 'HA ' || CASE WHEN v_side = 'home' THEN 'Casa' ELSE 'Visitante' END || coalesce(' ' || v_signed_line, '');
    ELSE
      market_out := 'Moneyline';
      pick_out := 'Moneyline ' || CASE WHEN v_side = 'home' THEN 'Casa' WHEN v_side = 'away' THEN 'Visitante' ELSE 'Empate' END;
    END IF;
  ELSIF v_model LIKE '%diamond%' THEN
    IF v_direction <> '' THEN
      market_out := CASE WHEN v_direction = 'over' THEN 'Over Corridas' ELSE 'Under Corridas' END;
      pick_out := initcap(v_direction) || CASE WHEN v_line IS NOT NULL THEN ' ' || v_line ELSE '' END;
    ELSIF v_market LIKE '%handicap%' OR v_market LIKE '%run line%' THEN
      market_out := 'Handicap Asiático';
      pick_out := 'HA ' || CASE WHEN v_side = 'home' THEN 'Casa' ELSE 'Visitante' END || coalesce(' ' || v_signed_line, '');
    ELSE
      market_out := 'Moneyline';
      pick_out := CASE WHEN v_side = 'home' THEN 'Moneyline Casa' ELSE 'Moneyline Visitante' END;
    END IF;
  ELSIF v_model IN ('asp court', 'asp court w') THEN
    IF v_direction <> '' THEN
      market_out := CASE WHEN v_direction = 'over' THEN 'Over Pontos' ELSE 'Under Pontos' END;
      pick_out := initcap(v_direction) || CASE WHEN v_line IS NOT NULL THEN ' ' || v_line ELSE '' END;
    ELSIF v_market LIKE '%handicap%' OR v_market LIKE '%spread%' THEN
      market_out := 'Handicap Asiático';
      pick_out := 'HA ' || CASE WHEN v_side = 'home' THEN 'Casa' ELSE 'Visitante' END || coalesce(' ' || v_signed_line, '');
    ELSE
      market_out := 'Moneyline';
      pick_out := CASE WHEN v_side = 'home' THEN 'Moneyline Casa' ELSE 'Moneyline Visitante' END;
    END IF;
  ELSE
    market_out := coalesce(nullif(btrim(p_market), ''), 'Moneyline');
    pick_out := v_pick;
    IF v_line IS NOT NULL AND position(v_line in v_pick) = 0 THEN
      pick_out := btrim(v_pick || ' ' || v_line);
    END IF;
  END IF;

  RETURN NEXT;
END;
$$;

WITH standardized AS (
  SELECT p.id, s.market_out, s.pick_out
  FROM public.prognosticos p
  CROSS JOIN LATERAL public._standardize_prediction_market_pick(
    p.origem_modelo, p.esporte, p.mercado, p.pick, p.linha::text,
    p.mandante, p.visitante
  ) s
)
UPDATE public.prognosticos p
SET mercado = s.market_out,
    pick = s.pick_out,
    linha = NULL,
    updated_at = now()
FROM standardized s
WHERE p.id = s.id;

UPDATE public.validacao_critica_telegram_alerts a
SET market = p.mercado,
    pick = p.pick,
    line = NULL,
    updated_at = now()
FROM public.prognosticos p
WHERE a.source_table = 'prognosticos'
  AND a.source_record_id = p.id;

UPDATE public.configuracoes
SET mercados_ativos = ARRAY[
  'Moneyline', 'Dupla Chance', 'Over Gols', 'Under Gols',
  'Ambas Marcam Sim', 'Ambas Marcam Não', 'Handicap Asiático',
  'Over Cantos', 'Under Cantos', 'Race Cantos', 'Mais Cantos',
  'Over Corridas', 'Under Corridas', 'Over Pontos', 'Under Pontos',
  'ASP BackMatrix'
]::text[],
updated_at = now();

DROP FUNCTION public._standardize_prediction_market_pick(text, text, text, text, text, text, text);