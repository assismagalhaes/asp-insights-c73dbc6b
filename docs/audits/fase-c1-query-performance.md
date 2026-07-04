# Fase C1 - Consultas Supabase e carregamento

Esta fase reduz peso de consultas sem alterar regras de negocio, layout principal, bankroll, Validator ou Screener.

## Consultas otimizadas

- ASP Validator: a listagem principal de `asp_validator_registros` deixou de usar `select("*")` e passou a selecionar explicitamente as colunas usadas pela tela.
- ASP Validator uploads: a busca de `asp_validator_uploads` tambem passou a usar colunas explicitas.
- ASP Screener MLB: o limite inicial de odds do dia foi reduzido de 20000 para 5000 linhas, mantendo filtro por data, esporte e liga.
- MLB standings service: o limite de odds por data tambem foi reduzido para 5000 linhas.
- Snapshots do Screener: oportunidades de snapshot passaram de um carregamento fixo de 1500 para carregamento inicial de 500, com opcao de carregar mais.
- Services de snapshots e handoffs: leituras passaram a usar listas explicitas de colunas em vez de `select("*")`.
- Bankroll a partir do ASP Validator: consulta auxiliar passou a selecionar apenas as colunas necessarias para mapear registros aplicados na banca.

## Mantido fora de escopo

- Refatoracao ampla de `asp-validator.tsx`.
- Refatoracao ampla de `asp-screener.tsx`.
- Mudancas em `computeMetrics`, `bankrollTimeline`, ROI, yield, CONFIRMAR ou PULAR.
- Mudancas de schema ou limpeza de dados.
- Virtualizacao de tabelas.
- Carregamento sob demanda de payloads JSONB em todos os detalhes.

## Indices recomendados para fase futura

- `odds_jogos(data, esporte, liga, created_at DESC)`.
- `asp_validator_registros(created_at DESC)`.
- `asp_validator_registros(decision, bankroll_applied, is_simulated_result, result_status)`.
- `asp_validator_uploads(validator_id, upload_order)`.
- `asp_screener_mlb_daily_snapshots(user_id, created_at DESC)`.
- `asp_screener_mlb_opportunity_snapshots(daily_snapshot_id, created_at DESC)`.
- `asp_screener_mlb_opportunity_snapshots(run_id)`.
- `asp_screener_validator_handoffs(source_module, source_sport, source_league, created_at DESC)`.
- `asp_screener_validator_handoffs(handoff_id)`.
- `asp_screener_validator_handoffs(validator_record_id)`.
