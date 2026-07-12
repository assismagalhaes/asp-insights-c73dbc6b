CREATE TABLE IF NOT EXISTS public.prognostico_odds_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id UUID NOT NULL REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('REFERENCIA_PACKBALL', 'VALIDACAO', 'FECHAMENTO')),
  odd NUMERIC(8,3) NOT NULL CHECK (odd > 1),
  probabilidade_final NUMERIC(6,4),
  edge NUMERIC(8,4),
  origem TEXT NOT NULL,
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prognostico_odds_historico_lookup_idx
  ON public.prognostico_odds_historico (prognostico_id, tipo, registrado_em DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prognostico_odds_historico TO anon, authenticated;
GRANT ALL ON public.prognostico_odds_historico TO service_role;

ALTER TABLE public.prognostico_odds_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open access prognostico odds historico" ON public.prognostico_odds_historico;
CREATE POLICY "open access prognostico odds historico"
  ON public.prognostico_odds_historico FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.registrar_preco_prognostico()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.odd_ofertada > 1 THEN
    INSERT INTO public.prognostico_odds_historico
      (prognostico_id, tipo, odd, probabilidade_final, edge, origem, registrado_em)
    VALUES
      (NEW.id, 'REFERENCIA_PACKBALL', NEW.odd_ofertada, NEW.probabilidade_final, NEW.edge, 'IMPORTACAO_MODELO', NEW.created_at);
  END IF;

  IF NEW.odd_ajustada > 1 AND TG_OP = 'INSERT' THEN
    INSERT INTO public.prognostico_odds_historico
      (prognostico_id, tipo, odd, probabilidade_final, edge, origem)
    VALUES
      (NEW.id, 'VALIDACAO', NEW.odd_ajustada, NEW.probabilidade_final,
       (NEW.odd_ajustada * NEW.probabilidade_final / 100.0 - 1.0) * 100.0, 'VALIDACAO_CRITICA');
  ELSIF NEW.odd_ajustada > 1
        AND TG_OP = 'UPDATE'
        AND NEW.odd_ajustada IS DISTINCT FROM OLD.odd_ajustada THEN
    INSERT INTO public.prognostico_odds_historico
      (prognostico_id, tipo, odd, probabilidade_final, edge, origem)
    VALUES
      (NEW.id, 'VALIDACAO', NEW.odd_ajustada, NEW.probabilidade_final,
       (NEW.odd_ajustada * NEW.probabilidade_final / 100.0 - 1.0) * 100.0, 'VALIDACAO_CRITICA');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_preco_prognostico ON public.prognosticos;
CREATE TRIGGER trg_registrar_preco_prognostico
AFTER INSERT OR UPDATE OF odd_ajustada ON public.prognosticos
FOR EACH ROW EXECUTE FUNCTION public.registrar_preco_prognostico();

CREATE OR REPLACE FUNCTION public.registrar_preco_fechamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prediction_probability NUMERIC;
BEGIN
  IF NEW.odd_fechamento > 1 AND TG_OP = 'INSERT' THEN
    SELECT probabilidade_final INTO prediction_probability FROM public.prognosticos WHERE id = NEW.prognostico_id;
    INSERT INTO public.prognostico_odds_historico
      (prognostico_id, tipo, odd, probabilidade_final, edge, origem)
    VALUES
      (NEW.prognostico_id, 'FECHAMENTO', NEW.odd_fechamento, prediction_probability,
       (NEW.odd_fechamento * prediction_probability / 100.0 - 1.0) * 100.0, 'RESULTADO');
  ELSIF NEW.odd_fechamento > 1
        AND TG_OP = 'UPDATE'
        AND NEW.odd_fechamento IS DISTINCT FROM OLD.odd_fechamento THEN
    SELECT probabilidade_final INTO prediction_probability FROM public.prognosticos WHERE id = NEW.prognostico_id;
    INSERT INTO public.prognostico_odds_historico
      (prognostico_id, tipo, odd, probabilidade_final, edge, origem)
    VALUES
      (NEW.prognostico_id, 'FECHAMENTO', NEW.odd_fechamento, prediction_probability,
       (NEW.odd_fechamento * prediction_probability / 100.0 - 1.0) * 100.0, 'RESULTADO');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_preco_fechamento ON public.resultados;
CREATE TRIGGER trg_registrar_preco_fechamento
AFTER INSERT OR UPDATE OF odd_fechamento ON public.resultados
FOR EACH ROW EXECUTE FUNCTION public.registrar_preco_fechamento();

INSERT INTO public.prognostico_odds_historico
  (prognostico_id, tipo, odd, probabilidade_final, edge, origem, registrado_em)
SELECT p.id, 'REFERENCIA_PACKBALL', p.odd_ofertada, p.probabilidade_final, p.edge, 'BACKFILL', p.created_at
FROM public.prognosticos p
WHERE p.odd_ofertada > 1
  AND NOT EXISTS (SELECT 1 FROM public.prognostico_odds_historico h WHERE h.prognostico_id = p.id AND h.tipo = 'REFERENCIA_PACKBALL');

INSERT INTO public.prognostico_odds_historico
  (prognostico_id, tipo, odd, probabilidade_final, edge, origem, registrado_em)
SELECT p.id, 'VALIDACAO', p.odd_ajustada, p.probabilidade_final,
  (p.odd_ajustada * p.probabilidade_final / 100.0 - 1.0) * 100.0, 'BACKFILL', p.updated_at
FROM public.prognosticos p
WHERE p.odd_ajustada > 1
  AND NOT EXISTS (SELECT 1 FROM public.prognostico_odds_historico h WHERE h.prognostico_id = p.id AND h.tipo = 'VALIDACAO');

INSERT INTO public.prognostico_odds_historico
  (prognostico_id, tipo, odd, probabilidade_final, edge, origem, registrado_em)
SELECT r.prognostico_id, 'FECHAMENTO', r.odd_fechamento, p.probabilidade_final,
  (r.odd_fechamento * p.probabilidade_final / 100.0 - 1.0) * 100.0, 'BACKFILL', r.created_at
FROM public.resultados r
JOIN public.prognosticos p ON p.id = r.prognostico_id
WHERE r.odd_fechamento > 1
  AND NOT EXISTS (SELECT 1 FROM public.prognostico_odds_historico h WHERE h.prognostico_id = r.prognostico_id AND h.tipo = 'FECHAMENTO');

CREATE OR REPLACE VIEW public.prognosticos_clv AS
SELECT
  p.id AS prognostico_id, p.mercado, p.jogo, p.data,
  validation_price.odd AS odd_validacao,
  closing_price.odd AS odd_fechamento,
  CASE WHEN validation_price.odd > 1 AND closing_price.odd > 1
       THEN validation_price.odd / closing_price.odd - 1.0 ELSE NULL END AS clv,
  validation_price.registrado_em AS validada_em,
  closing_price.registrado_em AS fechamento_registrado_em
FROM public.prognosticos p
LEFT JOIN LATERAL (
  SELECT odd, registrado_em FROM public.prognostico_odds_historico h
  WHERE h.prognostico_id = p.id AND h.tipo = 'VALIDACAO'
  ORDER BY registrado_em DESC LIMIT 1
) validation_price ON true
LEFT JOIN LATERAL (
  SELECT odd, registrado_em FROM public.prognostico_odds_historico h
  WHERE h.prognostico_id = p.id AND h.tipo = 'FECHAMENTO'
  ORDER BY registrado_em DESC LIMIT 1
) closing_price ON true;

GRANT SELECT ON public.prognosticos_clv TO anon, authenticated, service_role;