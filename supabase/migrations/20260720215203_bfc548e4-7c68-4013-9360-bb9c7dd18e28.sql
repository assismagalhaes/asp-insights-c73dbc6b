
DROP POLICY IF EXISTS "authenticated manage analises_ia" ON public.analises_ia;
CREATE POLICY "Admins manage analises_ia" ON public.analises_ia
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "authenticated manage feedback_ia_resultados" ON public.feedback_ia_resultados;
CREATE POLICY "Admins manage feedback_ia_resultados" ON public.feedback_ia_resultados
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated users can read ligas" ON public.ligas;
CREATE POLICY "Admins can read ligas" ON public.ligas
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
