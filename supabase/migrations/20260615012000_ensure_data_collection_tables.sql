-- Idempotent repair for data collection tables used by /coleta-dados.
-- Safe to run more than once: creates missing tables, columns, policies, and indexes.

CREATE TABLE IF NOT EXISTS public.coletas_odds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'PROCESSADO',
  esporte text NULL,
  liga text NULL,
  data_inicio date NULL,
  data_fim date NULL,
  mercados jsonb NULL,
  parametros jsonb NULL,
  raw_json jsonb NULL,
  normalized_json jsonb NULL,
  total_jogos integer NOT NULL DEFAULT 0,
  total_odds integer NOT NULL DEFAULT 0,
  erro text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.odds_jogos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coleta_id uuid REFERENCES public.coletas_odds(id) ON DELETE CASCADE,
  data date NULL,
  hora time NULL,
  esporte text NULL,
  liga text NULL,
  jogo text NULL,
  mandante text NULL,
  visitante text NULL,
  mercado text NULL,
  pick text NULL,
  linha text NULL,
  odd numeric NULL,
  bookmaker text NULL,
  fonte text NULL,
  capturado_em timestamptz NULL,
  raw_ref jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coletas_odds
ADD COLUMN IF NOT EXISTS job_id text NULL;

ALTER TABLE public.coletas_odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odds_jogos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage coletas_odds" ON public.coletas_odds;
CREATE POLICY "admins manage coletas_odds" ON public.coletas_odds
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins manage odds_jogos" ON public.odds_jogos;
CREATE POLICY "admins manage odds_jogos" ON public.odds_jogos
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_coletas_odds_created_at ON public.coletas_odds(created_at);
CREATE INDEX IF NOT EXISTS idx_coletas_odds_status ON public.coletas_odds(status);
CREATE INDEX IF NOT EXISTS idx_coletas_odds_esporte ON public.coletas_odds(esporte);
CREATE INDEX IF NOT EXISTS idx_coletas_odds_liga ON public.coletas_odds(liga);
CREATE INDEX IF NOT EXISTS idx_coletas_odds_data_inicio ON public.coletas_odds(data_inicio);
CREATE INDEX IF NOT EXISTS idx_coletas_odds_data_fim ON public.coletas_odds(data_fim);
CREATE INDEX IF NOT EXISTS idx_coletas_odds_job_id ON public.coletas_odds(job_id);

CREATE INDEX IF NOT EXISTS idx_odds_jogos_coleta_id ON public.odds_jogos(coleta_id);
CREATE INDEX IF NOT EXISTS idx_odds_jogos_data ON public.odds_jogos(data);
CREATE INDEX IF NOT EXISTS idx_odds_jogos_esporte ON public.odds_jogos(esporte);
CREATE INDEX IF NOT EXISTS idx_odds_jogos_liga ON public.odds_jogos(liga);
CREATE INDEX IF NOT EXISTS idx_odds_jogos_mercado ON public.odds_jogos(mercado);
CREATE INDEX IF NOT EXISTS idx_odds_jogos_bookmaker ON public.odds_jogos(bookmaker);
CREATE INDEX IF NOT EXISTS idx_odds_jogos_created_at ON public.odds_jogos(created_at);
