
-- 1) Restrict prognostico_odds_historico to admins (was USING(true)/WITH CHECK(true))
DROP POLICY IF EXISTS "open access prognostico odds historico" ON public.prognostico_odds_historico;

CREATE POLICY "admins manage prognostico odds historico"
  ON public.prognostico_odds_historico
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Ensure grants are limited to authenticated (and service_role); revoke any anon/public exposure
REVOKE ALL ON public.prognostico_odds_historico FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prognostico_odds_historico TO authenticated;
GRANT ALL ON public.prognostico_odds_historico TO service_role;

-- 2) Recreate view prognosticos_clv with security_invoker so it uses the querying user's RLS
DROP VIEW IF EXISTS public.prognosticos_clv;
CREATE VIEW public.prognosticos_clv
WITH (security_invoker = true) AS
SELECT p.id AS prognostico_id,
    p.mercado,
    p.jogo,
    p.data,
    validation_price.odd AS odd_validacao,
    closing_price.odd AS odd_fechamento,
    CASE
        WHEN validation_price.odd > 1::numeric AND closing_price.odd > 1::numeric
          THEN validation_price.odd / closing_price.odd - 1.0
        ELSE NULL::numeric
    END AS clv,
    validation_price.registrado_em AS validada_em,
    closing_price.registrado_em AS fechamento_registrado_em
FROM public.prognosticos p
LEFT JOIN LATERAL (
    SELECT h.odd, h.registrado_em
    FROM public.prognostico_odds_historico h
    WHERE h.prognostico_id = p.id AND h.tipo = 'VALIDACAO'
    ORDER BY h.registrado_em DESC
    LIMIT 1
) validation_price ON true
LEFT JOIN LATERAL (
    SELECT h.odd, h.registrado_em
    FROM public.prognostico_odds_historico h
    WHERE h.prognostico_id = p.id AND h.tipo = 'FECHAMENTO'
    ORDER BY h.registrado_em DESC
    LIMIT 1
) closing_price ON true;

REVOKE ALL ON public.prognosticos_clv FROM PUBLIC, anon;
GRANT SELECT ON public.prognosticos_clv TO authenticated;
GRANT ALL ON public.prognosticos_clv TO service_role;

-- 3) Revoke public EXECUTE on SECURITY DEFINER trigger functions (they are called by triggers, not clients)
REVOKE ALL ON FUNCTION public.registrar_preco_prognostico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_preco_fechamento() FROM PUBLIC, anon, authenticated;
