CREATE OR REPLACE FUNCTION public.set_highlightly_job_shadow_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  derived_scope text;
  is_selective boolean;
BEGIN
  derived_scope := COALESCE(
    NULLIF(btrim(NEW.request_params ->> '_shadow_scope'), ''),
    NULLIF(btrim(NEW.request_params ->> '_fanout_scope'), '')
  );
  is_selective := COALESCE((NEW.request_params ->> '_selective_enrichment')::boolean, false);

  IF is_selective AND derived_scope IS NULL THEN
    RAISE EXCEPTION 'Selective Highlightly jobs require request_params._shadow_scope'
      USING ERRCODE = '22023';
  END IF;
  IF derived_scope IS NOT NULL AND length(derived_scope) > 160 THEN
    RAISE EXCEPTION 'Highlightly shadow scope exceeds 160 characters'
      USING ERRCODE = '22023';
  END IF;

  NEW.shadow_scope := derived_scope;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.set_highlightly_job_shadow_scope()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.set_highlightly_job_shadow_scope()
IS 'Derives queue scope and rejects selective enrichment jobs without an explicit _shadow_scope.';

NOTIFY pgrst, 'reload schema';
