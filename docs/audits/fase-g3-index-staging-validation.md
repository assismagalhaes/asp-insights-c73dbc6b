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

### Smoke manual autenticado - 2026-07-06 18:11 -03:00

Resultado: **Executado no preview autenticado do projeto Lovable, sem alteracao de codigo,
schema, dados, bankroll ou jobs**.

Foi feita a localizacao do ambiente acessivel para smoke visual:

- Browser integrado do Codex: sem abas abertas e sem sessao autenticada disponivel.
- Repositorio local: nenhuma URL publica do frontend foi encontrada em arquivos nao sensiveis.
- URLs Lovable provaveis testadas (`asp-insights-c73dbc6b.lovable.app` e
  `preview--asp-insights-c73dbc6b.lovable.app`): retornaram 404.
- Projeto Lovable `4dac6de8-943c-4948-9a8d-c134df0576c7`: status `ready` confirmado via
  ferramenta Lovable.
- Preview Lovable localizado em
  `id-preview-8eb5bdd7--4dac6de8-943c-4948-9a8d-c134df0576c7.lovable.app`, mas redirecionou
  para `lovable.dev/auth-bridge` e exibiu tela de login do Lovable.
- VM `ubuntu@201.23.77.253`: conexao SSH OK; `cloudflared` aponta somente
  `jupyter.hseconsulting.com.br` para Jupyter em `localhost:8888`.
- VM `asp-scraper-api`: endpoint local `http://127.0.0.1:8000/health` respondeu
  `{"status":"ok","service":"asp-insights-scraper-api"}`.
- Nao foi encontrado frontend ASP Insights hospedado na VM.
- Aprovacao para uso do Chrome recebida em 2026-07-06. Tentativa bloqueada porque o backend
  `extension` nao apareceu para o Codex; os checks locais indicaram Chrome instalado, mas sem
  native host/registro da Codex Chrome Extension disponivel neste ambiente.
- Apos instalacao/ativacao da Codex Chrome Extension pelo usuario, o Chrome ficou disponivel
  para o Codex e o projeto Lovable abriu com sessao autenticada.
- O app foi validado dentro do preview autenticado do Lovable. A abertura direta do host
  `lovableproject.com` sem a ponte do preview mostrou tela de login do app, portanto o smoke foi
  conduzido pelo iframe autenticado do Lovable, sem registrar token de preview.

Status dos modulos solicitados:

| Modulo | Status | Observacao |
| --- | --- | --- |
| ASP Validator | OK | Tela abriu; formulario manual, dashboard especifico e filtros de periodo/esporte/liga/plataforma/modelo/mercado/decisao/resultado visiveis; `CONFIRMADAS` e `PULADAS` separados; lucro/ROI/yield confirmados exibidos apenas para confirmadas |
| ASP Screener | OK | Tela abriu; secoes Moneyline, Over/Under, Handicap, Opportunity Score, payload critico, historico de handoffs, auditoria e calibracao visiveis; payload/handoff abriu em leitura; rerun de 18:22 confirmou snapshot MLB `validado`, 30 times importados/conciliados e 1000 odds MLB do dia |
| Dashboard geral | OK | Cards carregaram com dados reais; validacao padrao `Confirmadas`; ROI, lucro, banca e win rate exibidos sem evidencia visual de contaminacao por PULAR/handoff/snapshot/simulado |
| Bankroll | OK | Tela abriu; configuracoes, stakes, lucro real, lucro em unidades, ROI, yield, win rate, drawdown e evolucao da banca carregaram; nao houve indicio visual de PULAR/simulado como resultado financeiro real |
| Historico | OK | Tela abriu; filtros por periodo, esporte, liga, mercado, validacao e resultado visiveis; tabela carregou com dados tecnicos como data, hora, mercado, pick, odd, stake, validacao, resultado e lucro |
| Coleta de Odds | OK | Tela abriu; historico de coletas carregou com status `PROCESSADO`, `CONCLUIDA` e `WARNING`; acoes `Status`, `Retomar`, `Importar` e `Baixar CSV` visiveis; nenhum job novo foi iniciado |
| Console | OK com observacao | Sem erro critico de RLS, permissao ou falha de fetch observado; warnings nao bloqueantes do ambiente Lovable/hydration e `[normalizeVmNormalizedPayload] nenhuma linha extraida` apareceram durante a tela de Coleta |

Observacoes de seguranca do smoke:

- Nenhum formulario foi enviado.
- Nenhum job novo de coleta foi iniciado.
- Nenhuma acao de importacao, retomada, publicacao, confirmacao, pulo ou alteracao de bankroll foi executada.
- A verificacao foi visual/leitura; nao houve limpeza, alteracao manual de dados ou migration adicional.

#### Rerun ASP Screener - 2026-07-06 18:22 -03:00

Resultado: **OK**.

O smoke do ASP Screener foi repetido apos o snapshot/odds estarem disponiveis:

- Snapshot MLB: `validado`.
- Ultima atualizacao: `06/07/2026, 18:20`.
- Fonte: `CSV manual`.
- Snapshot: `2026-07-06`.
- Times importados: `30`.
- Times conciliados: `30`.
- Odds MLB do dia: `1000`.
- Avisos: `0`.
- Cache: `diario`.
- Moneyline Screener exibiu `ODDS MLB CARREGADAS: 1000` e origem `Banco odds_jogos`.
- Historico/auditoria de handoffs visivel com `HANDOFFS ENVIADOS: 4`, `APLICADOS: 4` e
  `DESCARTADOS: 0`.
- Payloads/handoffs e calibracao permaneceram visiveis.
- Nenhuma projecao foi gerada, nenhum snapshot foi salvo e nenhum handoff foi enviado durante o
  smoke.
- Sem erro critico de RLS, permissao ou fetch no console durante o rerun.

Recomendacao: **aprovado para manter os indices G2A aplicados**, com acompanhamento normal de
performance. A pendencia operacional anterior do ASP Screener foi fechada no rerun com
snapshot/odds carregados.

## Aplicacao em staging

Resultado: **nao aplicavel ao projeto atual**.

Motivos:

- O projeto Lovable atual usa banco unico, sem ambiente staging separado disponivel.
- A aplicacao autorizada pelo usuario ocorreu diretamente no banco unico atual/produtivo.
- Nenhum acesso SQL de staging foi usado nesta sessao.

Tempo aproximado de aplicacao em staging: **nao aplicavel**.

Erros de aplicacao em staging: **nao aplicavel**.

Observacoes de lock/performance: a aplicacao no banco unico foi reportada como concluida sem
erro. Manter observacao operacional normal para tabelas grandes, especialmente `odds_jogos`.

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

Como nao existe staging separado, o smoke funcional foi executado no preview autenticado do
projeto Lovable apontando para o banco unico atual. Checklist consolidado:

| Area | Fluxo | Status |
| --- | --- | --- |
| ASP Validator | Historico/dashboard carrega | OK |
| ASP Validator | Filtros funcionam/visiveis | OK |
| ASP Validator | Dashboard especifico carrega | OK |
| ASP Validator | CONFIRMAR/PULAR continuam separados | OK |
| ASP Validator | PULAR nao afeta bankroll | OK por leitura visual dos indicadores confirmados |
| ASP Screener | Historico de handoffs carrega | OK |
| ASP Screener | Snapshots carregam | OK: snapshot MLB `2026-07-06` validado, 30 times e 1000 odds |
| ASP Screener | Detalhes de snapshot/handoff carregam | OK para payload/handoff e contexto de snapshot |
| ASP Screener | Shortlist/calibracao continuam acessiveis | OK |
| Dashboard/Bankroll | Dashboard geral carrega | OK |
| Dashboard/Bankroll | Bankroll carrega | OK |
| Dashboard/Bankroll | Simulado/handoff/snapshot nao entram como performance real | OK por leitura visual dos filtros/indicadores reais |
| Coleta de Odds | Listagem de coletas carrega | OK |
| Coleta de Odds | Status de coletas aparece | OK |

## Checagem simples de performance

Sem baseline temporal instrumentado antes/depois, a checagem foi visual. As telas principais
carregaram sem lentidao evidente durante o smoke autenticado. Medidas detalhadas de Network/API
podem ser feitas em ciclo separado, se necessario:

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
| Indices aparecem em `pg_indexes` | OK reportado apos aplicacao |
| Reexecucao nao quebra | OK por `IF NOT EXISTS`; reexecucao real nao necessaria nesta etapa |

## Recomendacao para producao

Classificacao: **Aprovado para manter os indices G2A no banco unico atual/produtivo**.

Motivos:

- G2A esta mergeada na `main`.
- Migration foi autorizada para o banco unico atual.
- Aplicacao foi reportada como concluida sem erro.
- `pg_indexes` confirmou os sete indices.
- Smoke funcional pos-aplicacao passou nos fluxos principais; rerun do Screener confirmou
  snapshot/odds MLB do dia carregados.
- Nenhuma evidencia visual de alteracao em dados, RLS, policies, bankroll, regras ou dashboard
  financeiro foi observada.

Para futuras migrations de indice em tabelas grandes, avaliar janela operacional e, se necessario,
`CREATE INDEX CONCURRENTLY` fora de migration transacional comum.

## Proxima decisao

- Manter G2A aplicada.
- Monitorar telas pesadas e logs operacionais nas proximas horas/dias.
- Monitorar ASP Screener em ciclos futuros, mas a pendencia de snapshot/odds do smoke foi fechada.
- Nao avancar para G2B sem evidencia real de gargalo remanescente.
