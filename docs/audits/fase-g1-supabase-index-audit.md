# Fase G1 - Auditoria de indices Supabase

Esta fase foi executada como auditoria read-only. Nao foram criadas migrations, nao houve
alteracao de schema, queries, runtime, regras de negocio, bankroll, Validator, Screener, OCR, IA
ou scraper.

## Resumo executivo

- O baseline tecnico estava verde antes da auditoria: `eslint .`, `tsc --noEmit`,
  `vite build` e testes Python.
- As tabelas do ASP Validator e ASP Screener MLB ja possuem indices importantes para historico,
  uploads, handoffs e snapshots.
- As tabelas historicas mais antigas (`prognosticos`, `validacoes`, `resultados` e
  `bankroll_historico`) ainda dependem principalmente dos indices implicitos de primary key.
- A maior lacuna de performance esta em listagens ordenadas, FKs usadas em joins/embeds e filtros
  compostos que hoje aparecem no codigo, mas nao possuem indice composto correspondente.
- A G2 deve validar os candidatos em staging com `EXPLAIN (ANALYZE, BUFFERS)` antes de criar
  indices em producao.

## Metodologia

- Revisao das chamadas Supabase em `src/lib`, `src/routes/_authenticated`, `src/components` e
  `src/lib/mcp`.
- Revisao das migrations em `supabase/migrations` para inventariar indices existentes.
- Uso das recomendacoes da Fase C1 como ponto de partida, removendo candidatos que ja foram
  cobertos por migrations posteriores.
- Priorizacao baseada em frequencia de tela, volume esperado, uso em dashboards/listagens e custo
  de escrita.

## Tabelas auditadas

| Tabela | Uso principal observado | Situacao geral |
| --- | --- | --- |
| `prognosticos` | Listagens, importacao, publicacao, historico, dashboard, IA learning | Precisa de indices compostos para listagem e duplicidade |
| `validacoes` | Ultima validacao por prognostico e listagem MCP | Falta indice de FK/tempo |
| `resultados` | Embed em prognosticos e trigger de bankroll | Falta indice de FK/tempo |
| `bankroll_historico` | Historico crescente e snapshot mais recente | Falta indice por `data`/`created_at` |
| `asp_validator_registros` | Historico do Validator, dashboard e bankroll oficial | Base boa; falta indice parcial/composto para performance financeira |
| `asp_validator_uploads` | Uploads por registro, OCR e Storage | Bem coberta para `validator_id, upload_order` |
| `asp_screener_validator_handoffs` | Auditoria Screener -> Validator | Base boa; falta composto para filtros fixos de origem |
| `asp_screener_mlb_daily_snapshots` | Historico de snapshots MLB | Base boa; `run_id` coberto por unique composto |
| `asp_screener_mlb_opportunity_snapshots` | Oportunidades por snapshot/run/handoff | Base boa; considerar composto para `run_id` + usuario se volume crescer |
| `odds_jogos` | Odds do dia, screener MLB e fallback de coleta | Indices simples existem; falta composto para data/esporte/liga |
| `coletas_odds` | Jobs de coleta, fallback por periodo e listagem recente | Indices simples existem; composto por periodo pode ajudar fallback |
| `mlb_team_standings_snapshots` | Standings por snapshot/temporada e leitura mais recente | Base razoavel; falta composto para `snapshot_date, season, rank` |
| `configuracoes` | Configuracao unica/mais antiga | Sem gargalo esperado |
| `ligas` | Upsert por `esporte,nome` e listagem | Sem gargalo relevante observado |

## Filtros e ordenacoes encontrados

### `prognosticos`

Consultas observadas:

- `select("*, resultados(placar_final, created_at)")`
- `order("data", descending)` + `order("created_at", descending)`
- Busca de duplicidade na importacao com `data`, `esporte`, `jogo`, `mercado`, `pick`
- `update/delete` por `id`
- MCP: `order("created_at", descending)`, `limit`, filtro opcional `ilike("esporte", ...)`
- AI learning: `in("resultado", [...])` com embeds de `resultados` e `validacoes`

Filtros compostos relevantes:

- `(data, esporte, jogo, mercado, pick)` para importacao/deduplicacao.
- `(resultado, created_at DESC)` para aprendizagem/analises liquidadas.
- `(status_validacao, status_publicacao, data DESC, created_at DESC)` para filas de validacao e
  publicacao, embora muitos filtros hoje ainda sejam aplicados no cliente apos `usePrognosticos`.

### `validacoes`

Consultas observadas:

- Ultima validacao por prognostico:
  `eq("prognostico_id", ...)`, `order("created_at", descending)`, `limit(1)`.
- MCP: `order("created_at", descending)`, `limit`, filtro opcional `eq("decisao", ...)`.
- Embed em `prognosticos` para aprendizagem/analise historica.

Filtros compostos relevantes:

- `(prognostico_id, created_at DESC)`.
- `(decisao, created_at DESC)` se a listagem MCP crescer.

### `resultados`

Consultas observadas:

- Insert de resultado.
- Embed em `prognosticos` usando `resultados(placar_final, created_at)`.
- Uso por trigger para atualizar `prognosticos` e `bankroll_historico`.

Filtros compostos relevantes:

- `(prognostico_id, created_at DESC)` para embed e busca do resultado mais recente.
- `(data_resultado DESC, created_at DESC)` para relatorios futuros por periodo.

### `bankroll_historico`

Consultas observadas:

- Tela de bankroll: `order("data", ascending)`, `order("created_at", ascending)`.
- MCP: snapshot mais recente com `order("data", descending)`, `limit(1)`.
- Trigger: busca do ultimo registro com `ORDER BY data DESC, created_at DESC LIMIT 1`.

Filtros compostos relevantes:

- `(data DESC, created_at DESC)`.

### `asp_validator_registros`

Consultas observadas:

- Historico principal: `order("created_at", descending)`, `limit(500)`.
- Bankroll oficial: `eq("decision", "CONFIRMAR")`, `eq("bankroll_applied", true)`,
  `eq("is_simulated_result", false)`, `not("result_status", "is", null)`,
  `order("match_date", descending)`, `order("created_at", descending)`.
- Atualizacoes/deletes por `id`.
- Dashboard do Validator filtra no cliente por decisao, resultado, esporte, liga, mercado e periodo.

Filtros compostos relevantes:

- `(user_id, created_at DESC)` ja existe.
- Parcial para registros financeiros reais confirmados pode reduzir custo do dashboard/bankroll.
- `(user_id, decision, bankroll_applied, is_simulated_result, result_status, created_at DESC)` e
  variantes podem ajudar, mas devem ser validadas contra cardinalidade real antes de virar migration.

### `asp_validator_uploads`

Consultas observadas:

- Uploads por conjunto de registros: `in("validator_id", ids)`, `order("upload_order")`.
- Updates por `id`.
- Busca/Storage por `file_path`.

Filtros compostos relevantes:

- `(validator_id, upload_order)` ja existe.
- `(user_id, created_at DESC)` ja existe.
- `(file_path)` ja existe.

### `asp_screener_validator_handoffs`

Consultas observadas:

- Listagem de auditoria:
  `eq("source_module", "asp_screener")`, `eq("source_sport", "baseball")`,
  `eq("source_league", "MLB")`, `order("created_at", descending)`, `limit`.
- Updates por identificador resolvido: `id`, `handoff_id` ou `validator_record_id`.
- Lookup por `id`.

Filtros compostos relevantes:

- `(user_id, created_at DESC)` ja existe.
- `(handoff_id)` ja existe.
- `(status)` ja existe.
- O filtro fixo de origem ainda nao tem indice composto com `user_id`, que e o escopo esperado
  via RLS.

### `asp_screener_mlb_daily_snapshots`

Consultas observadas:

- Insert de snapshot diario.
- Update por `id`.
- Listagem recente: `order("created_at", descending)`, `limit`.
- Lookup por `run_id`.

Filtros compostos relevantes:

- `(user_id, snapshot_date DESC)` ja existe.
- Unique `(user_id, run_id)` existe por constraint.
- Indice antigo `(user_id, created_at DESC)` tambem aparece em migration anterior.

### `asp_screener_mlb_opportunity_snapshots`

Consultas observadas:

- Insert em lote de oportunidades.
- Listagem com `order("created_at", descending)`, filtros opcionais por `daily_snapshot_id` e
  `run_id`.
- Updates por `opportunity_id` e `handoff_id`.

Filtros compostos relevantes:

- `(daily_snapshot_id)` ja existe.
- `(run_id)` ja existe.
- `(opportunity_id)` ja existe.
- `(handoff_id)` ja existe.
- `(user_id, created_at DESC)` ja existe.
- Se o volume crescer, `(user_id, run_id, created_at DESC)` pode ajudar consultas paginadas por run.

### `odds_jogos`

Consultas observadas:

- Insert em lotes.
- Delete por `coleta_id`.
- Screener/standings: `eq("data", snapshotDate)`, `limit(5000)`, filtros de esporte/liga aplicados
  em memoria.
- Coleta: `eq("data", params.date)`, `order("created_at", descending)`, `limit`.

Filtros compostos relevantes:

- Indices simples de `data`, `esporte`, `liga`, `mercado`, `bookmaker`, `created_at` e `coleta_id`
  ja existem.
- Falta composto para `data + esporte + liga + created_at`, recomendado desde C1.

### `coletas_odds`

Consultas observadas:

- Insert/update de jobs.
- Listagem recente: `order("created_at", descending)`, `limit(50)`.
- Fallback por periodo: `lte("data_inicio", date)`, `gte("data_fim", date)`,
  `order("created_at", descending)`, `limit(10)`.
- Updates/status por `id`.

Filtros compostos relevantes:

- Indices simples de `created_at`, `status`, `esporte`, `liga`, `data_inicio`, `data_fim` e
  `job_id` ja existem.
- Fallback por periodo pode se beneficiar de composto envolvendo `data_inicio`, `data_fim` e
  `created_at`.

### `mlb_team_standings_snapshots`

Consultas observadas:

- Snapshot mais recente:
  `order("snapshot_date", descending)`, `order("updated_at", descending)`, `limit(1)`.
- Snapshot especifico:
  `eq("snapshot_date", date)`, `eq("season", season)`, `order("rank", ascending)`.
- Upsert por `snapshot_date, season, team_key`.

Filtros compostos relevantes:

- `(snapshot_date DESC, season DESC)` ja existe.
- Indices simples de `snapshot_date`, `season`, `team_key`, `updated_at` ja existem.
- Falta composto para o snapshot especifico ordenado por `rank`.

## Indices existentes relevantes

| Tabela | Indice | Colunas | Migration |
| --- | --- | --- | --- |
| `prognosticos` | `idx_prognosticos_origem_modelo` | `origem_modelo` | `20260616120000_add_model_context_to_prognosticos.sql` |
| `prognosticos` | `idx_prognosticos_job_id_coleta` | `job_id_coleta` | `20260616120000_add_model_context_to_prognosticos.sql` |
| `coletas_odds` | `idx_coletas_odds_created_at` | `created_at` | `20260614130000_create_data_collection_tables.sql` |
| `coletas_odds` | `idx_coletas_odds_status` | `status` | `20260614130000_create_data_collection_tables.sql` |
| `coletas_odds` | `idx_coletas_odds_esporte` | `esporte` | `20260614130000_create_data_collection_tables.sql` |
| `coletas_odds` | `idx_coletas_odds_liga` | `liga` | `20260614130000_create_data_collection_tables.sql` |
| `coletas_odds` | `idx_coletas_odds_data_inicio` | `data_inicio` | `20260614130000_create_data_collection_tables.sql` |
| `coletas_odds` | `idx_coletas_odds_data_fim` | `data_fim` | `20260614130000_create_data_collection_tables.sql` |
| `coletas_odds` | `idx_coletas_odds_job_id` | `job_id` | `20260614143000_add_scraper_job_to_collections.sql` |
| `odds_jogos` | `idx_odds_jogos_coleta_id` | `coleta_id` | `20260614130000_create_data_collection_tables.sql` |
| `odds_jogos` | `idx_odds_jogos_data` | `data` | `20260614130000_create_data_collection_tables.sql` |
| `odds_jogos` | `idx_odds_jogos_esporte` | `esporte` | `20260614130000_create_data_collection_tables.sql` |
| `odds_jogos` | `idx_odds_jogos_liga` | `liga` | `20260614130000_create_data_collection_tables.sql` |
| `odds_jogos` | `idx_odds_jogos_mercado` | `mercado` | `20260614130000_create_data_collection_tables.sql` |
| `odds_jogos` | `idx_odds_jogos_bookmaker` | `bookmaker` | `20260614130000_create_data_collection_tables.sql` |
| `odds_jogos` | `idx_odds_jogos_created_at` | `created_at` | `20260614130000_create_data_collection_tables.sql` |
| `asp_validator_registros` | `idx_asp_validator_user_created` | `user_id, created_at DESC` | `20260627160000_create_asp_validator.sql` |
| `asp_validator_registros` | `idx_asp_validator_model_created` | `validator_model, created_at DESC` | `20260627160000_create_asp_validator.sql` |
| `asp_validator_uploads` | `idx_asp_validator_uploads_validator` | `validator_id, upload_order` | `20260627160000_create_asp_validator.sql` |
| `asp_validator_uploads` | `idx_asp_validator_uploads_user_created` | `user_id, created_at DESC` | `20260627160000_create_asp_validator.sql` |
| `asp_validator_uploads` | `idx_asp_validator_uploads_file_path` | `file_path` | `20260627214500_add_asp_validator_upload_storage.sql` |
| `asp_screener_validator_handoffs` | `idx_asp_handoffs_user_created` | `user_id, created_at DESC` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `asp_screener_validator_handoffs` | `idx_asp_handoffs_handoff_id` | `handoff_id` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `asp_screener_validator_handoffs` | `idx_asp_handoffs_status` | `status` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `asp_screener_validator_handoffs` | `idx_asp_screener_validator_handoffs_validator_record` | `validator_record_id` | `20260630120000_create_asp_screener_validator_handoffs.sql` |
| `asp_screener_mlb_daily_snapshots` | `idx_asp_daily_user_date` | `user_id, snapshot_date DESC` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `asp_screener_mlb_opportunity_snapshots` | `idx_asp_opp_snap_daily` | `daily_snapshot_id` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `asp_screener_mlb_opportunity_snapshots` | `idx_asp_opp_snap_run` | `run_id` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `asp_screener_mlb_opportunity_snapshots` | `idx_asp_opp_snap_opportunity` | `opportunity_id` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `asp_screener_mlb_opportunity_snapshots` | `idx_asp_opp_snap_handoff` | `handoff_id` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `asp_screener_mlb_opportunity_snapshots` | `idx_asp_opp_snap_user_created` | `user_id, created_at DESC` | `20260701013158_4398c63f-e428-401f-b1b1-706966443f84.sql` |
| `mlb_team_standings_snapshots` | `idx_mlb_standings_snapshot_date` | `snapshot_date` | `20260629180000_create_mlb_standings_snapshots.sql` |
| `mlb_team_standings_snapshots` | `idx_mlb_standings_season` | `season` | `20260629180000_create_mlb_standings_snapshots.sql` |
| `mlb_team_standings_snapshots` | `idx_mlb_standings_team_key` | `team_key` | `20260629180000_create_mlb_standings_snapshots.sql` |
| `mlb_team_standings_snapshots` | `idx_mlb_standings_updated_at` | `updated_at` | `20260629180000_create_mlb_standings_snapshots.sql` |
| `mlb_team_standings_snapshots` | `mlb_standings_snapshot_date_idx` | `snapshot_date DESC, season DESC` | `20260630233818_35768ba4-cb53-4c0c-a55f-ca70d6d361ae.sql` |

Observacao: algumas migrations antigas repetem `CREATE INDEX IF NOT EXISTS` para as mesmas tabelas de
coleta/odds. Elas nao criam indices duplicados se o nome ja existir, mas mostram historico de
idempotencia.

## Indices candidatos para G2

| Prioridade | Tabela | Indice candidato | Justificativa | Custo/risco |
| --- | --- | --- | --- | --- |
| P0 | `odds_jogos` | `(data, esporte, liga, created_at DESC)` | Screener/standings carregam odds por data e filtram MLB/baseball; tabela tende a ser volumosa | Custo moderado em inserts em lote; criar em staging primeiro |
| P1 | `prognosticos` | `(data DESC, created_at DESC)` | Listagem principal ordena por `data` e `created_at` | Baixo custo; tabela historica cresce com importacoes |
| P1 | `prognosticos` | `(data, esporte, jogo, mercado, pick)` | Importacao consulta duplicidade por esse conjunto | Custo moderado em inserts; considerar incluir `linha` se alta duplicidade por linha |
| P1 | `validacoes` | `(prognostico_id, created_at DESC)` | Busca ultima validacao por prognostico e embeds | Baixo custo; tambem cobre FK frequente |
| P1 | `resultados` | `(prognostico_id, created_at DESC)` | Embed de resultado por prognostico e leitura do mais recente | Baixo custo; tambem cobre FK frequente |
| P1 | `bankroll_historico` | `(data DESC, created_at DESC)` | Snapshot mais recente e trigger usam ultima linha por data/criacao | Baixo custo; tabela pequena, mas query e critica |
| P1 | `asp_validator_registros` | Parcial por `user_id, match_date DESC, created_at DESC` para registros financeiros reais | Bankroll oficial filtra CONFIRMAR + aplicado + nao simulado + resultado preenchido | Custo baixo/moderado; parcial reduz tamanho |
| P2 | `asp_screener_validator_handoffs` | `(user_id, source_module, source_sport, source_league, created_at DESC)` | Auditoria lista sempre origem ASP Screener/Baseball/MLB dentro do escopo do usuario | Custo baixo; pode ser desnecessario se volume seguir pequeno |
| P2 | `coletas_odds` | `(data_inicio, data_fim, created_at DESC)` | Fallback busca coletas cujo periodo contem a data | Custo baixo/moderado; range duplo precisa ser validado por planner |
| P2 | `mlb_team_standings_snapshots` | `(snapshot_date, season, rank)` | Leitura de snapshot especifico ordena por rank | Baixo custo; melhora carregamento de standings |
| P3 | `asp_screener_mlb_opportunity_snapshots` | `(user_id, run_id, created_at DESC)` | Pode ajudar paginacao por run em alto volume | Opcional; indices simples ja cobrem o fluxo atual |
| P3 | `validacoes` | `(decisao, created_at DESC)` | MCP filtra validacoes por decisao | Opcional; baixo volume esperado |
| P3 | `prognosticos` | `(resultado, created_at DESC)` | AI learning consulta prognosticos liquidados | Opcional; pode esperar medicao real |

## SQL sugerido para G2

Este SQL e apenas sugestao para uma fase futura. Nao foi executado nesta G1.

```sql
-- P0/P1
CREATE INDEX IF NOT EXISTS idx_odds_jogos_data_esporte_liga_created
ON public.odds_jogos (data, esporte, liga, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prognosticos_data_created
ON public.prognosticos (data DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prognosticos_import_dedupe
ON public.prognosticos (data, esporte, jogo, mercado, pick);

CREATE INDEX IF NOT EXISTS idx_validacoes_prognostico_created
ON public.validacoes (prognostico_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resultados_prognostico_created
ON public.resultados (prognostico_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bankroll_historico_data_created
ON public.bankroll_historico (data DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_asp_validator_real_bankroll_user_match_created
ON public.asp_validator_registros (user_id, match_date DESC, created_at DESC)
WHERE decision = 'CONFIRMAR'
  AND bankroll_applied = true
  AND is_simulated_result = false
  AND result_status IS NOT NULL;

-- P2
CREATE INDEX IF NOT EXISTS idx_asp_handoffs_source_created
ON public.asp_screener_validator_handoffs
  (user_id, source_module, source_sport, source_league, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coletas_odds_period_created
ON public.coletas_odds (data_inicio, data_fim, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mlb_standings_snapshot_season_rank
ON public.mlb_team_standings_snapshots (snapshot_date, season, rank);

-- P3 / opcionais
CREATE INDEX IF NOT EXISTS idx_asp_opp_snap_user_run_created
ON public.asp_screener_mlb_opportunity_snapshots (user_id, run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_validacoes_decisao_created
ON public.validacoes (decisao, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prognosticos_resultado_created
ON public.prognosticos (resultado, created_at DESC);
```

## Ordem recomendada de aplicacao

1. Staging: aplicar P0/P1 e medir `EXPLAIN (ANALYZE, BUFFERS)` nas telas de odds, historico,
   bankroll e Validator.
2. Producao: criar primeiro `idx_odds_jogos_data_esporte_liga_created`, porque tende a aliviar a
   tabela mais volumosa.
3. Em seguida criar indices de FK/tempo: `validacoes`, `resultados` e `bankroll_historico`.
4. Criar o parcial do ASP Validator se a consulta de bankroll oficial aparecer em `pg_stat_statements`
   com custo relevante.
5. Aplicar P2 apenas se a auditoria/staging confirmar ganho real.
6. Deixar P3 para depois de medir volume real.

## Riscos e cuidados de producao

- Em tabelas grandes, preferir `CREATE INDEX CONCURRENTLY` em producao para reduzir bloqueio de
  escrita. Isso exige migration fora de transacao ou execucao operacional controlada.
- `CREATE INDEX IF NOT EXISTS` e idempotente, mas nao valida se um indice existente com outro nome ja
  cobre a mesma estrategia. Antes da G2, consultar `pg_indexes`/Supabase dashboard.
- Indices compostos melhoram leitura, mas aumentam custo de inserts/updates. O maior impacto
  esperado e em `odds_jogos`, por receber inserts em lote.
- O indice parcial do Validator depende de filtros muito estaveis. Se a regra financeira mudar no
  futuro, ele deve ser reavaliado.
- Para `coletas_odds`, o filtro com `lte(data_inicio)` e `gte(data_fim)` pode ou nao usar bem o
  composto dependendo da distribuicao. Medir antes de aplicar.

## Itens ja cobertos, sem nova recomendacao

- `asp_validator_uploads(validator_id, upload_order)` ja existe.
- `asp_validator_uploads(user_id, created_at DESC)` ja existe.
- `asp_screener_mlb_opportunity_snapshots(run_id)` ja existe.
- `asp_screener_mlb_opportunity_snapshots(daily_snapshot_id)` ja existe.
- `asp_screener_mlb_opportunity_snapshots(handoff_id)` ja existe.
- `asp_screener_validator_handoffs(handoff_id)` ja existe.
- `asp_screener_validator_handoffs(validator_record_id)` ja existe.
- `asp_screener_validator_handoffs(user_id, created_at DESC)` ja existe.
- `asp_screener_mlb_daily_snapshots(user_id, snapshot_date DESC)` ja existe.
- `asp_screener_mlb_daily_snapshots(user_id, run_id)` existe como constraint unica.

## Recomendacao

Seguir para uma G2 pequena e controlada, criando somente indices P0/P1 em staging primeiro. A G2
deve ser uma migration exclusiva de indices, sem mudancas de runtime, e deve anexar evidencias de
`EXPLAIN` antes/depois para as consultas mais importantes.
