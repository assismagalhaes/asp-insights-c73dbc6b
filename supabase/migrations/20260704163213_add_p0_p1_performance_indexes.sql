-- Fase G2A: P0/P1 performance indexes from the G1 Supabase index audit.
-- Non-destructive and idempotent; no schema, policy, trigger, function or data changes.

-- Odds collection: daily MLB screener/standings filters.
CREATE INDEX IF NOT EXISTS idx_odds_jogos_data_esporte_liga_created
ON public.odds_jogos (data, esporte, liga, created_at DESC);

-- Prognosticos: main list ordering and import duplicate checks.
CREATE INDEX IF NOT EXISTS idx_prognosticos_data_created
ON public.prognosticos (data DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prognosticos_import_dedupe
ON public.prognosticos (data, esporte, jogo, mercado, pick);

-- Validacoes/resultados: FK lookups and latest related records.
CREATE INDEX IF NOT EXISTS idx_validacoes_prognostico_created
ON public.validacoes (prognostico_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resultados_prognostico_created
ON public.resultados (prognostico_id, created_at DESC);

-- Bankroll: latest snapshot lookup used by UI, MCP and trigger.
CREATE INDEX IF NOT EXISTS idx_bankroll_historico_data_created
ON public.bankroll_historico (data DESC, created_at DESC);

-- ASP Validator: real bankroll rows only.
CREATE INDEX IF NOT EXISTS idx_asp_validator_real_bankroll_user_match_created
ON public.asp_validator_registros (user_id, match_date DESC, created_at DESC)
WHERE decision = 'CONFIRMAR'
  AND bankroll_applied = true
  AND is_simulated_result = false
  AND result_status IS NOT NULL;
