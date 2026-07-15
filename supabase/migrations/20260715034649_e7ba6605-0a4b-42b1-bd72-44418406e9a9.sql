-- Applying supabase/migrations/20260715051000_create_highlightly_odds_foundation.sql
CREATE TABLE IF NOT EXISTS public.sports_market_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.sports_providers(id) ON DELETE CASCADE,
  sport_id uuid NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  provider_market_key text NOT NULL,
  canonical_family text NOT NULL,
  display_name text NOT NULL,
  odds_type text NOT NULL DEFAULT 'prematch',
  settlement_rule text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_market_definitions_odds_type_check CHECK (
    odds_type IN ('prematch', 'live', 'unknown')
  ),
  CONSTRAINT sports_market_definitions_unique
    UNIQUE (provider_id, sport_id, odds_type, provider_market_key)
);

CREATE INDEX IF NOT EXISTS idx_sports_market_definitions_sport_family
  ON public.sports_market_definitions (sport_id, canonical_family, is_active);

CREATE TABLE IF NOT EXISTS public.sports_odds_current (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  bookmaker_id uuid NOT NULL REFERENCES public.sports_bookmakers(id) ON DELETE RESTRICT,
  market_definition_id uuid NOT NULL REFERENCES public.sports_market_definitions(id) ON DELETE RESTRICT,
  selection_key text NOT NULL,
  selection_name text NOT NULL,
  line_key text NOT NULL DEFAULT '',
  line_value numeric,
  decimal_odds numeric(12, 4) NOT NULL,
  quote_status text NOT NULL DEFAULT 'open',
  is_live boolean NOT NULL DEFAULT false,
  provider_updated_at timestamptz,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_odds_current_decimal_check CHECK (decimal_odds > 1 AND decimal_odds <= 10000),
  CONSTRAINT sports_odds_current_status_check CHECK (
    quote_status IN ('open', 'suspended', 'closed', 'unknown')
  ),
  CONSTRAINT sports_odds_current_unique
    UNIQUE (match_id, bookmaker_id, market_definition_id, selection_key, line_key, is_live)
);

CREATE INDEX IF NOT EXISTS idx_sports_odds_current_match_market
  ON public.sports_odds_current (match_id, market_definition_id, selection_key, line_key, is_live);
CREATE INDEX IF NOT EXISTS idx_sports_odds_current_bookmaker
  ON public.sports_odds_current (bookmaker_id, match_id);
CREATE INDEX IF NOT EXISTS idx_sports_odds_current_market
  ON public.sports_odds_current (market_definition_id, match_id);
CREATE INDEX IF NOT EXISTS idx_sports_odds_current_raw
  ON public.sports_odds_current (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_odds_current_open
  ON public.sports_odds_current (match_id, updated_at DESC)
  WHERE quote_status = 'open';

CREATE TABLE IF NOT EXISTS public.sports_odds_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  current_quote_id uuid NOT NULL REFERENCES public.sports_odds_current(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  bookmaker_id uuid NOT NULL REFERENCES public.sports_bookmakers(id) ON DELETE RESTRICT,
  market_definition_id uuid NOT NULL REFERENCES public.sports_market_definitions(id) ON DELETE RESTRICT,
  selection_key text NOT NULL,
  selection_name text NOT NULL,
  line_key text NOT NULL DEFAULT '',
  line_value numeric,
  decimal_odds numeric(12, 4) NOT NULL,
  previous_decimal_odds numeric(12, 4),
  quote_status text NOT NULL,
  previous_quote_status text,
  change_kind text NOT NULL,
  is_live boolean NOT NULL DEFAULT false,
  provider_updated_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now(),
  quote_fingerprint text NOT NULL UNIQUE,
  source_raw_object_id uuid REFERENCES public.hl_raw_objects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_odds_history_decimal_check CHECK (decimal_odds > 1 AND decimal_odds <= 10000),
  CONSTRAINT sports_odds_history_previous_decimal_check CHECK (
    previous_decimal_odds IS NULL OR (previous_decimal_odds > 1 AND previous_decimal_odds <= 10000)
  ),
  CONSTRAINT sports_odds_history_status_check CHECK (
    quote_status IN ('open', 'suspended', 'closed', 'unknown')
  ),
  CONSTRAINT sports_odds_history_previous_status_check CHECK (
    previous_quote_status IS NULL OR previous_quote_status IN ('open', 'suspended', 'closed', 'unknown')
  ),
  CONSTRAINT sports_odds_history_change_kind_check CHECK (
    change_kind IN ('opening', 'price', 'status', 'line', 'multiple')
  ),
  CONSTRAINT sports_odds_history_fingerprint_check CHECK (quote_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_sports_odds_history_quote_time
  ON public.sports_odds_history (current_quote_id, captured_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_sports_odds_history_match_time
  ON public.sports_odds_history (match_id, captured_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_sports_odds_history_bookmaker
  ON public.sports_odds_history (bookmaker_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_odds_history_market
  ON public.sports_odds_history (market_definition_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_odds_history_raw
  ON public.sports_odds_history (source_raw_object_id)
  WHERE source_raw_object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sports_odds_history_captured_brin
  ON public.sports_odds_history USING brin (captured_at);

CREATE TABLE IF NOT EXISTS public.sports_odds_consensus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.sports_matches(id) ON DELETE CASCADE,
  market_definition_id uuid NOT NULL REFERENCES public.sports_market_definitions(id) ON DELETE RESTRICT,
  selection_key text NOT NULL,
  selection_name text NOT NULL,
  line_key text NOT NULL DEFAULT '',
  line_value numeric,
  is_live boolean NOT NULL DEFAULT false,
  median_odds numeric(12, 4) NOT NULL,
  best_odds numeric(12, 4) NOT NULL,
  minimum_odds numeric(12, 4) NOT NULL,
  iqr numeric(12, 4) NOT NULL DEFAULT 0,
  bookmaker_count integer NOT NULL,
  bookmaker_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  snapshot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_odds_consensus_odds_check CHECK (
    minimum_odds > 1
    AND median_odds >= minimum_odds
    AND best_odds >= median_odds
    AND iqr >= 0
  ),
  CONSTRAINT sports_odds_consensus_bookmaker_count_check CHECK (bookmaker_count > 0),
  CONSTRAINT sports_odds_consensus_unique
    UNIQUE (match_id, market_definition_id, selection_key, line_key, is_live, snapshot_at)
);

CREATE INDEX IF NOT EXISTS idx_sports_odds_consensus_match_latest
  ON public.sports_odds_consensus (match_id, snapshot_at DESC, market_definition_id);
CREATE INDEX IF NOT EXISTS idx_sports_odds_consensus_market_latest
  ON public.sports_odds_consensus (market_definition_id, snapshot_at DESC);

DO $phase2$
DECLARE
  target_table text;
  tables text[] := ARRAY[
    'sports_market_definitions', 'sports_odds_current',
    'sports_odds_history', 'sports_odds_consensus'
  ];
BEGIN
  FOREACH target_table IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', target_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', target_table);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND policyname = 'admin_read_' || target_table
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::public.app_role)))',
        'admin_read_' || target_table,
        target_table
      );
    END IF;
  END LOOP;

  DROP TRIGGER IF EXISTS trg_sports_market_definitions_touch_updated_at ON public.sports_market_definitions;
  CREATE TRIGGER trg_sports_market_definitions_touch_updated_at
    BEFORE UPDATE ON public.sports_market_definitions
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

  DROP TRIGGER IF EXISTS trg_sports_odds_current_touch_updated_at ON public.sports_odds_current;
  CREATE TRIGGER trg_sports_odds_current_touch_updated_at
    BEFORE UPDATE ON public.sports_odds_current
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
END
$phase2$;

CREATE OR REPLACE FUNCTION public.upsert_sports_odds_quote(
  p_match_id uuid,
  p_bookmaker_id uuid,
  p_market_definition_id uuid,
  p_selection_key text,
  p_selection_name text,
  p_line_key text,
  p_line_value numeric,
  p_decimal_odds numeric,
  p_quote_status text,
  p_is_live boolean,
  p_provider_updated_at timestamptz DEFAULT NULL,
  p_collected_at timestamptz DEFAULT now(),
  p_source_raw_object_id uuid DEFAULT NULL
)
RETURNS public.sports_odds_current
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_row public.sports_odds_current;
  change_kind text;
  fingerprint text;
  fingerprint_source text;
  safe_line_key text := COALESCE(p_line_key, '');
  safe_collected_at timestamptz := COALESCE(p_collected_at, now());
BEGIN
  IF p_decimal_odds IS NULL OR p_decimal_odds <= 1 OR p_decimal_odds > 10000 THEN
    RAISE EXCEPTION 'decimal odds must be greater than 1 and at most 10000';
  END IF;
  IF p_quote_status IS NULL OR p_quote_status NOT IN ('open', 'suspended', 'closed', 'unknown') THEN
    RAISE EXCEPTION 'invalid quote status: %', p_quote_status;
  END IF;
  IF p_selection_key IS NULL OR btrim(p_selection_key) = '' THEN
    RAISE EXCEPTION 'selection_key must not be empty';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws(':', p_match_id::text, p_bookmaker_id::text,
        p_market_definition_id::text, p_selection_key, safe_line_key, p_is_live::text),
      0
    )
  );

  SELECT * INTO current_row
  FROM public.sports_odds_current
  WHERE match_id = p_match_id
    AND bookmaker_id = p_bookmaker_id
    AND market_definition_id = p_market_definition_id
    AND selection_key = p_selection_key
    AND line_key = safe_line_key
    AND is_live = p_is_live
  FOR UPDATE;

  IF current_row.id IS NULL THEN
    INSERT INTO public.sports_odds_current (
      match_id, bookmaker_id, market_definition_id, selection_key, selection_name,
      line_key, line_value, decimal_odds, quote_status, is_live,
      provider_updated_at, source_raw_object_id, first_seen_at, last_seen_at
    ) VALUES (
      p_match_id, p_bookmaker_id, p_market_definition_id, p_selection_key, p_selection_name,
      safe_line_key, p_line_value, p_decimal_odds, p_quote_status, p_is_live,
      p_provider_updated_at, p_source_raw_object_id, safe_collected_at, safe_collected_at
    ) RETURNING * INTO current_row;
    change_kind := 'opening';
  ELSIF current_row.decimal_odds IS DISTINCT FROM p_decimal_odds
     OR current_row.quote_status IS DISTINCT FROM p_quote_status
     OR current_row.line_value IS DISTINCT FROM p_line_value THEN
    change_kind := CASE
      WHEN (current_row.decimal_odds IS DISTINCT FROM p_decimal_odds)::integer
         + (current_row.quote_status IS DISTINCT FROM p_quote_status)::integer
         + (current_row.line_value IS DISTINCT FROM p_line_value)::integer > 1 THEN 'multiple'
      WHEN current_row.decimal_odds IS DISTINCT FROM p_decimal_odds THEN 'price'
      WHEN current_row.quote_status IS DISTINCT FROM p_quote_status THEN 'status'
      ELSE 'line'
    END;
  ELSE
    UPDATE public.sports_odds_current
    SET last_seen_at = GREATEST(last_seen_at, safe_collected_at),
        provider_updated_at = COALESCE(p_provider_updated_at, provider_updated_at),
        source_raw_object_id = COALESCE(p_source_raw_object_id, source_raw_object_id)
    WHERE id = current_row.id
    RETURNING * INTO current_row;
    RETURN current_row;
  END IF;

  fingerprint_source := pg_catalog.concat_ws(
    '|', current_row.id::text, p_decimal_odds::text, p_quote_status,
    safe_line_key, COALESCE(p_line_value::text, ''),
    COALESCE(p_provider_updated_at::text, ''), safe_collected_at::text
  );
  fingerprint := pg_catalog.md5(fingerprint_source)
    || pg_catalog.md5('highlightly|' || fingerprint_source);

  INSERT INTO public.sports_odds_history (
    current_quote_id, match_id, bookmaker_id, market_definition_id,
    selection_key, selection_name, line_key, line_value,
    decimal_odds, previous_decimal_odds, quote_status, previous_quote_status,
    change_kind, is_live, provider_updated_at, captured_at,
    quote_fingerprint, source_raw_object_id
  ) VALUES (
    current_row.id, p_match_id, p_bookmaker_id, p_market_definition_id,
    p_selection_key, p_selection_name, safe_line_key, p_line_value,
    p_decimal_odds,
    CASE WHEN change_kind = 'opening' THEN NULL ELSE current_row.decimal_odds END,
    p_quote_status,
    CASE WHEN change_kind = 'opening' THEN NULL ELSE current_row.quote_status END,
    change_kind, p_is_live, p_provider_updated_at, safe_collected_at,
    fingerprint, p_source_raw_object_id
  ) ON CONFLICT (quote_fingerprint) DO NOTHING;

  IF change_kind <> 'opening' THEN
    UPDATE public.sports_odds_current
    SET selection_name = p_selection_name,
        line_value = p_line_value,
        decimal_odds = p_decimal_odds,
        quote_status = p_quote_status,
        provider_updated_at = p_provider_updated_at,
        source_raw_object_id = p_source_raw_object_id,
        last_seen_at = GREATEST(last_seen_at, safe_collected_at)
    WHERE id = current_row.id
    RETURNING * INTO current_row;
  END IF;

  RETURN current_row;
END
$function$;

REVOKE ALL ON FUNCTION public.upsert_sports_odds_quote(
  uuid, uuid, uuid, text, text, text, numeric, numeric, text, boolean,
  timestamptz, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_sports_odds_quote(
  uuid, uuid, uuid, text, text, text, numeric, numeric, text, boolean,
  timestamptz, timestamptz, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_sports_odds_quotes(p_quotes jsonb)
RETURNS SETOF public.sports_odds_current
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  quote jsonb;
BEGIN
  IF p_quotes IS NULL OR jsonb_typeof(p_quotes) <> 'array' THEN
    RAISE EXCEPTION 'p_quotes must be a JSON array';
  END IF;
  IF jsonb_array_length(p_quotes) > 1000 THEN
    RAISE EXCEPTION 'p_quotes cannot contain more than 1000 entries';
  END IF;

  FOR quote IN SELECT value FROM jsonb_array_elements(p_quotes)
  LOOP
    RETURN NEXT public.upsert_sports_odds_quote(
      (quote->>'p_match_id')::uuid,
      (quote->>'p_bookmaker_id')::uuid,
      (quote->>'p_market_definition_id')::uuid,
      quote->>'p_selection_key',
      quote->>'p_selection_name',
      quote->>'p_line_key',
      (quote->>'p_line_value')::numeric,
      (quote->>'p_decimal_odds')::numeric,
      quote->>'p_quote_status',
      COALESCE((quote->>'p_is_live')::boolean, false),
      (quote->>'p_provider_updated_at')::timestamptz,
      COALESCE((quote->>'p_collected_at')::timestamptz, now()),
      (quote->>'p_source_raw_object_id')::uuid
    );
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.upsert_sports_odds_quotes(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_sports_odds_quotes(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';