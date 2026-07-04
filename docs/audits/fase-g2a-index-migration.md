# Fase G2A - Migration de indices P0/P1

A G2A aplica somente os indices P0/P1 recomendados na auditoria G1. A migration e pequena,
idempotente e nao destrutiva.

## Migration

- `supabase/migrations/20260704163213_add_p0_p1_performance_indexes.sql`

## Indices criados

- `idx_odds_jogos_data_esporte_liga_created`
  - Tabela: `odds_jogos`
  - Origem: G1 P0
  - Motivo: leitura de odds por data/esporte/liga para Screener MLB e standings.
- `idx_prognosticos_data_created`
  - Tabela: `prognosticos`
  - Origem: G1 P1
  - Motivo: ordenacao da listagem principal por `data` e `created_at`.
- `idx_prognosticos_import_dedupe`
  - Tabela: `prognosticos`
  - Origem: G1 P1
  - Motivo: checagem de duplicidade na importacao.
- `idx_validacoes_prognostico_created`
  - Tabela: `validacoes`
  - Origem: G1 P1
  - Motivo: ultima validacao por prognostico e embeds.
- `idx_resultados_prognostico_created`
  - Tabela: `resultados`
  - Origem: G1 P1
  - Motivo: resultado mais recente por prognostico e embeds.
- `idx_bankroll_historico_data_created`
  - Tabela: `bankroll_historico`
  - Origem: G1 P1
  - Motivo: snapshot mais recente de banca usado por UI, MCP e trigger.
- `idx_asp_validator_real_bankroll_user_match_created`
  - Tabela: `asp_validator_registros`
  - Origem: G1 P1
  - Motivo: consulta de registros reais confirmados que impactam bankroll.

## Fora de escopo

- Indices P2/P3 da G1.
- Indices JSONB/GIN.
- `CREATE INDEX CONCURRENTLY`.
- Alteracoes em queries, runtime, RLS, policies, dados, triggers, funcoes, Screener, Validator, IA,
  OCR ou scraper.

## Observacoes de aplicacao

- A migration usa somente `CREATE INDEX IF NOT EXISTS`.
- Para bases pequenas e medias, a migration normal deve ser suficiente.
- Para producao com tabela muito grande, especialmente `odds_jogos`, avaliar aplicacao operacional
  com `CREATE INDEX CONCURRENTLY` em janela propria, fora de migration transacional comum.
- Recomenda-se aplicar primeiro em staging e medir consultas principais com
  `EXPLAIN (ANALYZE, BUFFERS)` ou observabilidade equivalente.

## Pendencias futuras

- Reavaliar P2/P3 em G2B somente depois de medir ganho real.
- Avaliar indices JSONB apenas se surgirem queries reais sobre payloads JSONB.
