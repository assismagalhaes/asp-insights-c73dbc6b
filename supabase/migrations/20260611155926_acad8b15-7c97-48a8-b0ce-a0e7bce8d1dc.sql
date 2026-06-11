
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS tipo_stake TEXT NOT NULL DEFAULT 'FIXO',
  ADD COLUMN IF NOT EXISTS percentual_unidade NUMERIC(6,3) NOT NULL DEFAULT 1.0;

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_tipo_stake_check;
ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_tipo_stake_check CHECK (tipo_stake IN ('FIXO','PERCENTUAL'));
