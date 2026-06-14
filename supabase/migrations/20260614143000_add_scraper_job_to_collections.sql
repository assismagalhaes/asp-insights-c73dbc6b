-- Link manual/remote odds collections to external Python scraper jobs.

ALTER TABLE public.coletas_odds
ADD COLUMN IF NOT EXISTS job_id text NULL;

CREATE INDEX IF NOT EXISTS idx_coletas_odds_job_id ON public.coletas_odds(job_id);
