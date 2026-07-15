-- Highlightly Phase 3: preferred-bookmaker median snapshots for all supported sports.

CREATE OR REPLACE FUNCTION public.refresh_sports_odds_consensus(
  p_match_id uuid,
  p_snapshot_at timestamptz DEFAULT now(),
  p_min_bookmakers integer DEFAULT 5,
  p_max_bookmakers integer DEFAULT 7
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  affected integer := 0;
BEGIN
  IF p_match_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sports_matches WHERE id = p_match_id
  ) THEN
    RAISE EXCEPTION 'sports match not found: %', p_match_id USING ERRCODE = 'P0002';
  END IF;
  IF p_snapshot_at IS NULL THEN
    RAISE EXCEPTION 'p_snapshot_at must not be null';
  END IF;
  IF p_max_bookmakers < 5 OR p_max_bookmakers > 7 THEN
    RAISE EXCEPTION 'p_max_bookmakers must be between 5 and 7';
  END IF;
  IF p_min_bookmakers < 1 OR p_min_bookmakers > p_max_bookmakers THEN
    RAISE EXCEPTION 'p_min_bookmakers must be between 1 and p_max_bookmakers';
  END IF;

  WITH preferred_quotes AS (
    SELECT
      quote.*,
      row_number() OVER (
        PARTITION BY
          quote.match_id, quote.market_definition_id, quote.selection_key,
          quote.line_key, quote.is_live
        ORDER BY
          CASE bookmaker.normalized_name
            WHEN 'bet365' THEN 1
            WHEN '1xbet' THEN 2
            WHEN 'unibet' THEN 3
            WHEN 'william-hill' THEN 4
            WHEN 'stake.com' THEN 5
            WHEN 'betsson' THEN 6
            WHEN 'betway' THEN 7
            WHEN 'ladbrokes' THEN 8
            WHEN 'betano' THEN 9
            WHEN 'novibet' THEN 10
            WHEN 'parimatch' THEN 11
            ELSE 100
          END,
          bookmaker.normalized_name,
          quote.bookmaker_id
      ) AS preference_rank
    FROM public.sports_odds_current AS quote
    JOIN public.sports_bookmakers AS bookmaker ON bookmaker.id = quote.bookmaker_id
    WHERE quote.match_id = p_match_id
      AND quote.quote_status = 'open'
      AND bookmaker.is_active
      AND bookmaker.is_preferred
  ), bounded_quotes AS (
    SELECT *
    FROM preferred_quotes
    WHERE preference_rank <= p_max_bookmakers
  ), aggregates AS (
    SELECT
      match_id,
      market_definition_id,
      selection_key,
      max(selection_name) AS selection_name,
      line_key,
      max(line_value) AS line_value,
      is_live,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY decimal_odds)::numeric AS median_odds,
      max(decimal_odds) AS best_odds,
      min(decimal_odds) AS minimum_odds,
      (
        percentile_cont(0.75) WITHIN GROUP (ORDER BY decimal_odds)
        - percentile_cont(0.25) WITHIN GROUP (ORDER BY decimal_odds)
      )::numeric AS iqr,
      count(*)::integer AS bookmaker_count,
      array_agg(bookmaker_id ORDER BY preference_rank) AS bookmaker_ids
    FROM bounded_quotes
    GROUP BY match_id, market_definition_id, selection_key, line_key, is_live
    HAVING count(*) >= p_min_bookmakers
  )
  INSERT INTO public.sports_odds_consensus (
    match_id, market_definition_id, selection_key, selection_name,
    line_key, line_value, is_live, median_odds, best_odds, minimum_odds,
    iqr, bookmaker_count, bookmaker_ids, snapshot_at
  )
  SELECT
    match_id, market_definition_id, selection_key, selection_name,
    line_key, line_value, is_live, median_odds, best_odds, minimum_odds,
    iqr, bookmaker_count, bookmaker_ids, p_snapshot_at
  FROM aggregates
  ON CONFLICT (match_id, market_definition_id, selection_key, line_key, is_live, snapshot_at)
  DO UPDATE SET
    selection_name = EXCLUDED.selection_name,
    line_value = EXCLUDED.line_value,
    median_odds = EXCLUDED.median_odds,
    best_odds = EXCLUDED.best_odds,
    minimum_odds = EXCLUDED.minimum_odds,
    iqr = EXCLUDED.iqr,
    bookmaker_count = EXCLUDED.bookmaker_count,
    bookmaker_ids = EXCLUDED.bookmaker_ids;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$function$;

REVOKE ALL ON FUNCTION public.refresh_sports_odds_consensus(
  uuid, timestamptz, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_sports_odds_consensus(
  uuid, timestamptz, integer, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
