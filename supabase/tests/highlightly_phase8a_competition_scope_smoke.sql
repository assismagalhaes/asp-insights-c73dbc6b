BEGIN;

DO $structure$
DECLARE
  selected_count integer;
BEGIN
  IF to_regclass('public.hl_competition_scopes') IS NULL
     OR to_regclass('public.hl_selected_competition_scopes_v') IS NULL THEN
    RAISE EXCEPTION 'Phase 8A competition scope objects are missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sports WHERE code = 'american_football')
     OR NOT EXISTS (SELECT 1 FROM public.sports WHERE code = 'hockey') THEN
    RAISE EXCEPTION 'Phase 8A canonical sports are missing';
  END IF;

  SELECT count(*) INTO selected_count
  FROM public.hl_competition_scopes
  WHERE selected;

  IF selected_count <> 54 THEN
    RAISE EXCEPTION 'Expected 54 selected scopes, found %', selected_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hl_competition_scopes WHERE ingestion_enabled
  ) THEN
    RAISE EXCEPTION 'Phase 8A must not enable ingestion';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sports_providers WHERE code = 'highlightly' AND enabled
  ) THEN
    RAISE EXCEPTION 'Highlightly provider must remain disabled';
  END IF;

  IF has_table_privilege('anon', 'public.hl_competition_scopes', 'SELECT')
     OR has_table_privilege('anon', 'public.hl_selected_competition_scopes_v', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read Phase 8A catalog';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.hl_competition_scopes', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.hl_competition_scopes', 'INSERT') THEN
    RAISE EXCEPTION 'Phase 8A catalog grants are invalid';
  END IF;
END
$structure$;

DO $catalog$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'wnba'
      AND provider_competition_id = '11847'
      AND provider_name = 'NBA Women'
      AND canonical_name = 'WNBA'
  ) THEN
    RAISE EXCEPTION 'WNBA normalization scope is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'bbl-germany'
      AND provider_competition_id = '34824'
      AND region_code = 'DE'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'lnb-france'
      AND provider_competition_id = '2486'
      AND region_code = 'FR'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'nbl-australia'
      AND provider_competition_id = '1635'
      AND region_code = 'AU'
  ) THEN
    RAISE EXCEPTION 'Ambiguous basketball leagues were not resolved by country';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'college-world-series'
      AND provider_name = 'NCAA'
      AND metadata ->> 'stage' = 'College World Series'
  ) THEN
    RAISE EXCEPTION 'College World Series must be represented as an NCAA stage';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'nfl' AND provider_family = 'american-football'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'ncaa-fbs' AND provider_family = 'american-football'
  ) THEN
    RAISE EXCEPTION 'American Football scopes are invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'nhl' AND provider_family = 'nhl'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'ncaa-hockey' AND provider_family = 'nhl'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'khl' AND provider_family = 'hockey' AND provider_competition_id = '30569'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.hl_selected_competition_scopes_v
    WHERE scope_key = 'shl' AND provider_family = 'hockey' AND provider_competition_id = '40781'
  ) THEN
    RAISE EXCEPTION 'Hockey provider-family scopes are invalid';
  END IF;
END
$catalog$;

ROLLBACK;
