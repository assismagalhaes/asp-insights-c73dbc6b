ALTER TABLE public.opportunity_ranking_runs
  ADD COLUMN IF NOT EXISTS event_date_from date,
  ADD COLUMN IF NOT EXISTS event_date_to date,
  ADD COLUMN IF NOT EXISTS sport_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS league_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS market_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS scope_key text NOT NULL DEFAULT 'all|all|all|all|all';

UPDATE public.opportunity_ranking_runs
SET
  event_date_from = CASE
    WHEN COALESCE(filters_payload->>'ini', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (filters_payload->>'ini')::date
    ELSE event_date_from
  END,
  event_date_to = CASE
    WHEN COALESCE(filters_payload->>'fim', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (filters_payload->>'fim')::date
    ELSE event_date_to
  END,
  sport_scope = COALESCE(NULLIF(filters_payload->>'esporte', ''), sport_scope, 'all'),
  league_scope = COALESCE(NULLIF(filters_payload->>'liga', ''), league_scope, 'all'),
  market_scope = COALESCE(NULLIF(filters_payload->>'mercado', ''), market_scope, 'all');

UPDATE public.opportunity_ranking_runs
SET scope_key = lower(concat_ws('|',
  COALESCE(event_date_from::text, 'all'),
  COALESCE(event_date_to::text, 'all'),
  COALESCE(NULLIF(sport_scope, ''), 'all'),
  COALESCE(NULLIF(league_scope, ''), 'all'),
  COALESCE(NULLIF(market_scope, ''), 'all')
));

ALTER TABLE public.opportunity_ranking_runs
  DROP CONSTRAINT IF EXISTS opportunity_ranking_runs_user_date_stage_uq,
  DROP CONSTRAINT IF EXISTS opportunity_ranking_runs_user_date_stage_scope_uq;

ALTER TABLE public.opportunity_ranking_runs
  ADD CONSTRAINT opportunity_ranking_runs_user_date_stage_scope_uq
    UNIQUE (user_id, run_date, source_stage, scope_key);

CREATE INDEX IF NOT EXISTS idx_opp_rank_runs_scope_history
  ON public.opportunity_ranking_runs
    (user_id, source_stage, event_date_from DESC, sport_scope, created_at DESC);

ALTER TABLE public.prognosticos
  ADD COLUMN IF NOT EXISTS is_top_final boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS top_final_rank integer,
  ADD COLUMN IF NOT EXISTS top_final_run_id uuid,
  ADD COLUMN IF NOT EXISTS top_final_at timestamptz;

ALTER TABLE public.prognosticos
  DROP CONSTRAINT IF EXISTS prognosticos_top_final_rank_check,
  DROP CONSTRAINT IF EXISTS prognosticos_top_final_run_id_fkey;

ALTER TABLE public.prognosticos
  ADD CONSTRAINT prognosticos_top_final_run_id_fkey
    FOREIGN KEY (top_final_run_id)
    REFERENCES public.opportunity_ranking_runs(id) ON DELETE SET NULL,
  ADD CONSTRAINT prognosticos_top_final_rank_check
    CHECK (top_final_rank IS NULL OR top_final_rank BETWEEN 1 AND 3);

WITH latest_top_final AS (
  SELECT DISTINCT ON (item.prognostico_id)
    item.prognostico_id,
    item.run_id,
    item.rank_final,
    item.updated_at
  FROM public.opportunity_ranking_items item
  JOIN public.opportunity_ranking_runs run ON run.id = item.run_id
  WHERE item.ranking_status = 'TOP_FINAL'
  ORDER BY item.prognostico_id, run.created_at DESC, item.updated_at DESC
)
UPDATE public.prognosticos prognostico
SET
  is_top_final = true,
  top_final_rank = latest.rank_final,
  top_final_run_id = latest.run_id,
  top_final_at = latest.updated_at
FROM latest_top_final latest
WHERE prognostico.id = latest.prognostico_id;

CREATE INDEX IF NOT EXISTS idx_prognosticos_top_final
  ON public.prognosticos (is_top_final, data DESC, esporte, top_final_rank)
  WHERE is_top_final = true;