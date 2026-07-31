-- Highlightly Phase 8H.0/8H.1: versioned, immutable model-input builds.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.model_input_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_key text NOT NULL UNIQUE CHECK (contract_key ~ '^[a-z0-9_]+$'),
  model_name text NOT NULL,
  model_version text NOT NULL,
  sport_code text NOT NULL,
  league_code text,
  schema_version text NOT NULL DEFAULT '1.0.0',
  input_contract jsonb NOT NULL CHECK (jsonb_typeof(input_contract) = 'object'),
  adapter_contract jsonb NOT NULL CHECK (jsonb_typeof(adapter_contract) = 'object'),
  historical_dependencies jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(historical_dependencies) = 'array'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.model_input_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.model_input_contracts(id) ON DELETE RESTRICT,
  target_date date NOT NULL,
  mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'manual')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sealed')),
  source_snapshot_at timestamptz NOT NULL,
  coverage_report jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coverage_report) = 'object'),
  missing_required text[] NOT NULL DEFAULT '{}',
  lineage_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(lineage_summary) = 'object'),
  content_sha256 text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sealed_at timestamptz,
  CONSTRAINT model_input_builds_seal_consistency CHECK (
    (status = 'draft' AND content_sha256 IS NULL AND sealed_at IS NULL)
    OR (status = 'sealed' AND content_sha256 ~ '^[0-9a-f]{64}$' AND sealed_at IS NOT NULL)
  )
);

CREATE INDEX model_input_builds_lookup_idx
  ON public.model_input_builds (contract_id, target_date DESC, created_at DESC);

CREATE TABLE public.model_input_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL REFERENCES public.model_input_builds(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (build_id, match_id),
  UNIQUE (build_id, ordinal)
);

CREATE TABLE public.model_input_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL REFERENCES public.model_input_builds(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE RESTRICT,
  feature_key text NOT NULL,
  feature_value jsonb NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('text', 'number', 'boolean', 'date', 'timestamp', 'json')),
  is_required boolean NOT NULL DEFAULT false,
  source_kind text NOT NULL CHECK (source_kind IN ('highlightly', 'football_data', 'packball', 'manual', 'derived', 'historical_local')),
  observed_at timestamptz,
  source_lineage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_lineage) = 'object'),
  UNIQUE (build_id, match_id, feature_key),
  FOREIGN KEY (build_id, match_id)
    REFERENCES public.model_input_matches(build_id, match_id) ON DELETE CASCADE
);

CREATE TABLE public.model_input_odds_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL REFERENCES public.model_input_builds(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE RESTRICT,
  market_key text NOT NULL,
  selection_key text NOT NULL,
  line_key text NOT NULL DEFAULT '',
  line_value numeric,
  decimal_odds numeric NOT NULL CHECK (decimal_odds > 1),
  bookmaker text,
  source_kind text NOT NULL DEFAULT 'highlightly',
  observed_at timestamptz NOT NULL,
  source_lineage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_lineage) = 'object'),
  UNIQUE (build_id, match_id, market_key, selection_key, line_key, bookmaker),
  FOREIGN KEY (build_id, match_id)
    REFERENCES public.model_input_matches(build_id, match_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION public.prevent_sealed_model_input_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'model_input_builds' THEN
    IF OLD.status = 'sealed' THEN
      RAISE EXCEPTION 'sealed model input builds are immutable';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT status INTO parent_status
  FROM public.model_input_builds
  WHERE id = COALESCE(NEW.build_id, OLD.build_id);
  IF parent_status = 'sealed' THEN
    RAISE EXCEPTION 'children of sealed model input builds are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER model_input_builds_immutable
BEFORE UPDATE OR DELETE ON public.model_input_builds
FOR EACH ROW EXECUTE FUNCTION public.prevent_sealed_model_input_mutation_v1();

DO $triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['model_input_matches', 'model_input_features', 'model_input_odds_snapshots'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_sealed_model_input_mutation_v1()',
      table_name || '_immutable', table_name
    );
  END LOOP;
END
$triggers$;

CREATE OR REPLACE FUNCTION public.create_model_input_build_v1(
  p_contract_key text,
  p_target_date date,
  p_source_snapshot_at timestamptz,
  p_matches jsonb,
  p_features jsonb DEFAULT '[]'::jsonb,
  p_odds jsonb DEFAULT '[]'::jsonb,
  p_mode text DEFAULT 'shadow',
  p_coverage_report jsonb DEFAULT '{}'::jsonb,
  p_missing_required text[] DEFAULT '{}',
  p_lineage_summary jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  contract_row public.model_input_contracts%ROWTYPE;
  build_id uuid;
  canonical_text text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF jsonb_typeof(p_matches) <> 'array' OR jsonb_array_length(p_matches) = 0
     OR jsonb_typeof(p_features) <> 'array' OR jsonb_typeof(p_odds) <> 'array' THEN
    RAISE EXCEPTION 'matches, features and odds must be arrays; matches cannot be empty';
  END IF;

  SELECT * INTO STRICT contract_row
  FROM public.model_input_contracts
  WHERE contract_key = p_contract_key AND active;

  INSERT INTO public.model_input_builds (
    contract_id, target_date, mode, source_snapshot_at, coverage_report,
    missing_required, lineage_summary
  ) VALUES (
    contract_row.id, p_target_date, p_mode, p_source_snapshot_at,
    p_coverage_report, p_missing_required, p_lineage_summary
  ) RETURNING id INTO build_id;

  INSERT INTO public.model_input_matches (build_id, match_id, ordinal, payload)
  SELECT build_id, (item->>'match_id')::uuid, (ord - 1)::integer, item - 'match_id'
  FROM jsonb_array_elements(p_matches) WITH ORDINALITY AS rows(item, ord);

  INSERT INTO public.model_input_features (
    build_id, match_id, feature_key, feature_value, value_type, is_required,
    source_kind, observed_at, source_lineage
  )
  SELECT build_id, (item->>'match_id')::uuid, item->>'feature_key', item->'value',
    item->>'value_type', COALESCE((item->>'is_required')::boolean, false),
    item->>'source_kind', (item->>'observed_at')::timestamptz,
    COALESCE(item->'source_lineage', '{}'::jsonb)
  FROM jsonb_array_elements(p_features) AS rows(item);

  INSERT INTO public.model_input_odds_snapshots (
    build_id, match_id, market_key, selection_key, line_key, line_value,
    decimal_odds, bookmaker, source_kind, observed_at, source_lineage
  )
  SELECT build_id, (item->>'match_id')::uuid, item->>'market_key', item->>'selection_key',
    COALESCE(item->>'line_key', ''), (item->>'line_value')::numeric,
    (item->>'decimal_odds')::numeric, item->>'bookmaker',
    COALESCE(item->>'source_kind', 'highlightly'),
    (item->>'observed_at')::timestamptz, COALESCE(item->'source_lineage', '{}'::jsonb)
  FROM jsonb_array_elements(p_odds) AS rows(item);

  canonical_text := pg_catalog.concat_ws('|', contract_row.contract_key, p_target_date::text,
    p_source_snapshot_at::text, p_matches::text, p_features::text, p_odds::text,
    p_coverage_report::text, p_missing_required::text, p_lineage_summary::text);
  UPDATE public.model_input_builds
  SET status = 'sealed', sealed_at = now(),
      content_sha256 = pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(canonical_text, 'UTF8'), 'sha256'),
        'hex'
      )
  WHERE id = build_id;
  RETURN build_id;
END;
$$;

INSERT INTO public.model_input_contracts (
  contract_key, model_name, model_version, sport_code, league_code,
  input_contract, adapter_contract, historical_dependencies
) VALUES
('asp_matchmatrix_v1', 'ASP MatchMatrix', 'FOOTBALL_V1_5', 'football', NULL,
 '{"format":"collection_long_v1","required":["data","hora","esporte","liga","jogo","mandante","visitante","mercado","pick","linha","odd","bookmaker","fonte"],"optional":["country","odd_melhor","odd_mediana","odd_media","bookmaker_melhor","odds_consistency_status"]}',
 '{"format":"model_wide_v1","base":["date","time","country","league","home","away"],"markets":["1x2","double_chance","totals","btts","asian_handicap"]}',
 '[{"source":"football-data/local","purpose":"team and league history","cutoff":"strictly_before_target_date"}]'),
('asp_diamond_v1', 'ASP Diamond', 'MLB_V2_1_TEMPORAL_UNCERTAINTY', 'baseball', 'MLB',
 '{"format":"collection_long_v1","required":["data","hora","esporte","liga","mandante","visitante","mercado","pick","linha","odd"],"optional":["jogo","odd_melhor","odd_mediana","odd_media","bookmaker","bookmaker_melhor"]}',
 '{"format":"model_wide_v1","base":["date","time","home","away"],"markets":["moneyline","totals","runline"]}',
 '[{"source":"local baseball histories","purpose":"current, recent and previous performance","cutoff":"strictly_before_target_date"}]'),
('asp_court_v1', 'ASP Court', 'NBA_NOTEBOOK_CURRENT', 'basketball', 'NBA',
 '{"format":"collection_long_v1","required":["data","hora","liga","mandante","visitante","mercado","pick","linha","odd"],"optional":["esporte","jogo","odd_melhor","odd_mediana","odd_media","bookmaker","bookmaker_melhor"]}',
 '{"format":"model_wide_v1","base":["date","time","home","away","league"],"markets":["moneyline","totals","asian_handicap"]}',
 '[{"source":"NBA notebook/local history","purpose":"team form and ratings","cutoff":"strictly_before_target_date"}]'),
('asp_court_w_v1', 'ASP Court W', 'BASKETBALL_WNBA_V2_2_ROBUST_GATES', 'basketball', 'WNBA',
 '{"format":"collection_long_v1","required":["data","hora","liga","mandante","visitante","mercado","pick","linha","odd"],"optional":["esporte","jogo","odd_melhor","odd_mediana","odd_media","bookmaker","bookmaker_melhor"]}',
 '{"format":"model_wide_v1","base":["date","time","home","away","league"],"markets":["moneyline","totals","asian_handicap"]}',
 '[{"source":"WNBA notebook/local history","required":["data","adversario","pontos_time","pontos_adversario"],"cutoff":"strictly_before_target_date"}]');

ALTER TABLE public.model_input_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_input_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_input_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_input_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_input_odds_snapshots ENABLE ROW LEVEL SECURITY;

DO $security$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['model_input_contracts','model_input_builds','model_input_matches','model_input_features','model_input_odds_snapshots'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::public.app_role)))',
      table_name || '_admin_read', table_name
    );
  END LOOP;
END
$security$;

REVOKE ALL ON FUNCTION public.prevent_sealed_model_input_mutation_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_model_input_build_v1(text,date,timestamptz,jsonb,jsonb,jsonb,text,jsonb,text[],jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_model_input_build_v1(text,date,timestamptz,jsonb,jsonb,jsonb,text,jsonb,text[],jsonb) TO authenticated, service_role;
