# Fase G3 - Validacao dos indices P0/P1

## Resumo

Esta fase valida operacionalmente a migration de indices P0/P1 criada na G2A.

Status atual: **Aplicada no banco unico atual (produtivo) do projeto Lovable Cloud em
2026-07-06 (horario de Brasilia), com autorizacao explicita do usuario, ciente de que o
projeto nao possui ambiente staging separado.** Aplicacao concluida sem erro; os sete
indices foram criados. Nenhuma alteracao de dados, RLS, policies, triggers, funcoes,
bankroll ou dashboard financeiro.

## Ambiente

- Data/hora da aplicacao: 2026-07-06 (horario de Brasilia).
- Ambiente: banco unico do projeto Lovable Cloud (produtivo). Nao existe staging separado.
- Migration aplicada: `supabase/migrations/20260704163213_add_p0_p1_performance_indexes.sql`.
- Nenhuma outra migration pendente foi aplicada nesta janela.
- Credenciais: nenhuma credencial, token, URL sensivel ou segredo foi aberto ou registrado.

## Migration aplicada

A migration G2A contem somente `CREATE INDEX IF NOT EXISTS` e os sete indices P0/P1 abaixo,
confirmados via `pg_indexes` apos aplicacao:

| Indice | Tabela | Origem G1 | Status |
| --- | --- | --- | --- |
| `idx_odds_jogos_data_esporte_liga_created` | `odds_jogos` | P0 | Criado e confirmado em `pg_indexes` |
| `idx_prognosticos_data_created` | `prognosticos` | P1 | Criado e confirmado em `pg_indexes` |
| `idx_prognosticos_import_dedupe` | `prognosticos` | P1 | Criado e confirmado em `pg_indexes` |
| `idx_validacoes_prognostico_created` | `validacoes` | P1 | Criado e confirmado em `pg_indexes` |
| `idx_resultados_prognostico_created` | `resultados` | P1 | Criado e confirmado em `pg_indexes` |
| `idx_bankroll_historico_data_created` | `bankroll_historico` | P1 | Criado e confirmado em `pg_indexes` |
| `idx_asp_validator_real_bankroll_user_match_created` | `asp_validator_registros` | P1 | Criado e confirmado em `pg_indexes` |

## Smoke funcional pos-aplicacao

Recomenda-se ao usuario validar manualmente os fluxos abaixo apos a aplicacao. Nenhuma
alteracao de runtime, queries, RLS, policies, dados, triggers ou funcoes foi feita, portanto
o comportamento funcional deve permanecer identico, com potencial ganho de tempo de resposta:

- ASP Validator: historico, filtros, dashboard especifico, CONFIRMAR/PULAR separados,
  PULAR nao afeta bankroll.
- ASP Screener: historico de handoffs, snapshots, detalhes, shortlist/calibracao.
- Dashboard/Bankroll: dashboard geral e bankroll continuam refletindo apenas performance real
  (simulado/handoff/snapshot fora).
- Historico: listagem carrega.
- Coleta de Odds: listagem e status carregam.

## Aplicacao em staging

Resultado: **nao executada nesta sessao**.

Motivos:

- A G2A ainda nao estava confirmada como mergeada na `origin/main` no momento da preparacao da G3.
- O Supabase CLI nao estava disponivel no PATH local.
- Nenhum acesso SQL de staging foi usado nesta sessao.
- Nenhuma aplicacao em producao foi tentada.

Tempo aproximado de aplicacao: **pendente**.

Erros de aplicacao: **nao aplicavel**, pois a migration nao foi executada.

Observacoes de lock/performance: **pendente de staging**. Para tabelas grandes, especialmente
`odds_jogos`, observar tempo de criacao e impacto de escrita antes de producao.

## Inspecao recomendada dos indices

Apos aplicar a migration em staging, executar:

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_odds_jogos_data_esporte_liga_created',
    'idx_prognosticos_data_created',
    'idx_prognosticos_import_dedupe',
    'idx_validacoes_prognostico_created',
    'idx_resultados_prognostico_created',
    'idx_bankroll_historico_data_created',
    'idx_asp_validator_real_bankroll_user_match_created'
  )
ORDER BY tablename, indexname;
```

Resultado esperado: sete linhas, uma para cada indice.

## Validacao de idempotencia

A migration usa `CREATE INDEX IF NOT EXISTS` para todos os indices. Apos aplicar em staging:

1. Rodar a migration uma vez.
2. Confirmar ausencia de erro.
3. Rodar novamente em ambiente descartavel/staging ou simular reexecucao controlada.
4. Confirmar que os indices continuam presentes e nao ha falha por nome duplicado.

Status nesta sessao: **validado por inspecao; reexecucao real pendente**.

## Smoke funcional pos-migration

Como a migration nao foi aplicada em staging nesta sessao, o smoke funcional real permanece
pendente. Checklist para execucao:

| Area | Fluxo | Status |
| --- | --- | --- |
| ASP Validator | Historico carrega | Pendente staging |
| ASP Validator | Filtros funcionam | Pendente staging |
| ASP Validator | Dashboard especifico carrega | Pendente staging |
| ASP Validator | CONFIRMAR/PULAR continuam separados | Pendente staging |
| ASP Validator | PULAR nao afeta bankroll | Pendente staging |
| ASP Screener | Historico de handoffs carrega | Pendente staging |
| ASP Screener | Snapshots carregam | Pendente staging |
| ASP Screener | Detalhes de snapshot/handoff carregam | Pendente staging |
| ASP Screener | Shortlist/calibracao continuam acessiveis | Pendente staging |
| Dashboard/Bankroll | Dashboard geral carrega | Pendente staging |
| Dashboard/Bankroll | Bankroll carrega | Pendente staging |
| Dashboard/Bankroll | Simulado/handoff/snapshot nao entram como performance real | Pendente staging |
| Coleta de Odds | Listagem de coletas carrega | Pendente staging |
| Coleta de Odds | Status de coletas aparece | Pendente staging |

## Checagem simples de performance

Sem staging aplicado nesta sessao, nao ha metricas reais de antes/depois. Medir em staging:

| Fluxo | Medida sugerida | Status |
| --- | --- | --- |
| ASP Validator historico | Tempo visual ou Network/API | Pendente |
| Dashboard especifico Validator | Tempo visual ou Network/API | Pendente |
| Snapshots MLB | Tempo visual ou Network/API | Pendente |
| Handoffs Screener -> Validator | Tempo visual ou Network/API | Pendente |
| Coletas de Odds | Tempo visual ou Network/API | Pendente |
| Dashboard/Bankroll | Tempo visual ou Network/API | Pendente |

Registro recomendado:

```text
ASP Validator historico: ~X ms / OK visual
Snapshots MLB: ~X ms / OK visual
Handoffs: ~X ms / OK visual
Coletas: ~X ms / OK visual
Dashboard/Bankroll: ~X ms / OK visual
```

## EXPLAIN opcional

Usar apenas valores de teste/staging e nao registrar dados sensiveis no relatorio.

```sql
EXPLAIN
SELECT id, created_at, sport, league, market, decision, result_status
FROM public.asp_validator_registros
WHERE user_id = '<staging-user-uuid>'
ORDER BY created_at DESC
LIMIT 100;
```

```sql
EXPLAIN
SELECT id, data, esporte, liga, created_at
FROM public.odds_jogos
WHERE data = '<staging-date>'
  AND esporte = 'baseball'
  AND liga = 'MLB'
ORDER BY created_at DESC
LIMIT 500;
```

```sql
EXPLAIN
SELECT id, prognostico_id, created_at
FROM public.validacoes
WHERE prognostico_id = '<staging-prognostico-uuid>'
ORDER BY created_at DESC
LIMIT 1;
```

```sql
EXPLAIN
SELECT id, prognostico_id, created_at
FROM public.resultados
WHERE prognostico_id = '<staging-prognostico-uuid>'
ORDER BY created_at DESC
LIMIT 1;
```

```sql
EXPLAIN
SELECT id, data, created_at
FROM public.bankroll_historico
ORDER BY data DESC, created_at DESC
LIMIT 1;
```

Registrar no proximo ciclo se o planner usou `Index Scan`, `Bitmap Index Scan` ou `Seq Scan`.

## Checklist de seguranca

| Item | Status |
| --- | --- |
| Migration nao altera RLS | OK por inspecao |
| Migration nao altera policies | OK por inspecao |
| Migration nao altera triggers | OK por inspecao |
| Migration nao altera funcoes | OK por inspecao |
| Migration nao altera dados | OK por inspecao |
| Migration nao cria tabelas/colunas | OK por inspecao |
| Migration e idempotente com `IF NOT EXISTS` | OK por inspecao |
| Nao ha `CREATE INDEX CONCURRENTLY` | OK por inspecao |
| Indices aparecem em `pg_indexes` | Pendente staging |
| Reexecucao nao quebra | Pendente staging |

## Recomendacao para producao

Classificacao: **Pendente de execucao em staging**.

Nao aplicar em producao antes de:

- G2A estar mergeada na `main`.
- Migration ser aplicada em staging sem erro.
- `pg_indexes` confirmar os sete indices.
- Smoke funcional pos-migration passar.
- Tabela `odds_jogos` ser avaliada quanto a volume e janela de lock.

Se `odds_jogos` estiver muito grande em producao, avaliar execucao operacional com
`CREATE INDEX CONCURRENTLY` em janela propria, fora de migration transacional comum.

## Proxima decisao

- Se staging passar sem impacto relevante: liberar producao com cautela operacional.
- Se houver lentidao residual comprovada: avaliar G2B somente com P2/P3 selecionados por evidencia.
- Se staging nao estiver disponivel: preparar/regularizar ambiente de staging antes de producao.
