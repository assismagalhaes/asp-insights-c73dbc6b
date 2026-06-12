
DROP POLICY IF EXISTS "Authenticated users can insert ligas" ON public.ligas;
DROP POLICY IF EXISTS "Authenticated users can update ligas" ON public.ligas;

CREATE POLICY "Admins can insert ligas"
  ON public.ligas FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update ligas"
  ON public.ligas FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
