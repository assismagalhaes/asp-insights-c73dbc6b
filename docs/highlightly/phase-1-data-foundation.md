# Fase 1 — fundação de dados Highlightly

Data: 14/07/2026
Estado: implementação e PostgreSQL efêmero validados; aplicação no banco pendente

## Resultado

A Fase 1 cria uma fundação provider-agnostic para ingestão da Highlightly sem ativar coleta, rota ou interface. O provider é semeado com `enabled=false` e a feature flag permanece desligada.

Entregáveis implementados:

- entidades canônicas para esportes, países, competições, temporadas, times, jogadores, bookmakers e partidas;
- mapeamento `provider + sport + entity_type + external_id -> canonical_id`;
- catálogo dinâmico de métricas, inclusive status de revisão;
- fila idempotente com prioridade, lease, retries, limite de tentativas e recuperação de lock expirado;
- aquisição atômica por `FOR UPDATE SKIP LOCKED`;
- runs, consumo de quota e issues de qualidade;
- registro do bruto com hash SHA-256, retenção e metadados redigidos;
- bucket privado `highlightly-raw` para JSON comprimido;
- RLS admin-only para leitura; escrita exclusivamente pelo `service_role`;
- repositório Python para jobs, runs, upload gzip, validação de checksum e reprocessamento sem nova chamada à Highlightly.

## Migrations

Aplicar nesta ordem:

1. `20260714230000_create_highlightly_canonical_foundation.sql`;
2. `20260714231000_create_highlightly_ingestion_control.sql`;
3. `20260714232000_create_highlightly_ingestion_functions.sql`.

As migrations são aditivas. Não removem nem alteram tabelas operacionais de prognósticos, validações, bankroll ou publicação.

## Segurança

- `anon`: nenhuma permissão;
- `authenticated`: `SELECT`, filtrado por `has_role(..., 'admin')`;
- `service_role`: operações de ingestão e execução das RPCs;
- RPCs da fila: `SECURITY DEFINER`, `search_path=''`, `EXECUTE` revogado de `PUBLIC`, `anon` e `authenticated`;
- Storage: somente policy de leitura para administrador; nenhum write de cliente;
- credenciais em metadados são substituídas por `[REDACTED]` antes de persistir;
- a chave Highlightly não faz parte de nenhuma tabela ou assinatura de função.

## Convenção do bruto

O writer salva JSON canônico comprimido em:

```text
highlightly-raw/{sport}/{yyyy}/{mm}/{dd}/{endpoint_key}/{sha256}.json.gz
```

O hash é calculado sobre o JSON descomprimido. O reprocessamento valida o hash antes de desserializar o payload. Uma nova versão de normalizador cria uma chave de job independente:

```text
reprocess:{raw_object_id}:{normalizer_version}
```

## Idempotência e concorrência

- `hl_ingestion_jobs.dedupe_key` é único;
- enfileirar a mesma chave atualiza somente prioridade/agenda, sem criar uma segunda linha;
- um worker reivindica o job e recebe um lease temporário;
- workers concorrentes pulam linhas bloqueadas;
- lease expirado pode ser reivindicado novamente;
- retry acima de `max_attempts` é transformado em `dead`;
- raw objects usam `(storage_bucket, storage_path)` como chave de upsert.

## Rollback lógico

Como não há staging separado, o rollback padrão não apaga dados:

1. manter `highlightly_analysis_enabled=false`;
2. manter `sports_providers.enabled=false` para `highlightly`;
3. interromper dispatcher/workers;
4. marcar jobs ainda pendentes como `cancelled`, se necessário;
5. preservar tabelas e bruto para investigação/reprocessamento.

Remoção física de tabelas ou objetos não faz parte do rollback operacional e exige uma migration destrutiva separada, backup e aprovação explícita.

## Validação antes da ativação

Executar `supabase/tests/highlightly_phase1_smoke.sql` após aplicar as três migrations. O script roda em transação e termina com `ROLLBACK`; ele verifica:

- seeds e versão do contrato;
- bucket privado;
- RLS para usuário autenticado sem role admin;
- enqueue repetido sem duplicação;
- claim e finalização do job;
- permissões das RPCs.

Depois do smoke, confirmar que a feature flag e o provider continuam desligados. A ativação do worker pertence à Fase 2.

### Evidência local

As três migrations foram executadas, na ordem, em uma instância PostgreSQL efêmera PGlite 0.3.14 com schemas e roles equivalentes aos requisitos usados do Supabase. O smoke transacional também foi executado integralmente.

Resultado em 14/07/2026:

```text
PASS migration 20260714230000_create_highlightly_canonical_foundation.sql
PASS migration 20260714231000_create_highlightly_ingestion_control.sql
PASS migration 20260714232000_create_highlightly_ingestion_functions.sql
PASS transactional smoke
PASS post-smoke state {"providers":1,"sports":3,"bookmakers":11,"jobs":0,"bucket_public":false}
```

Além disso, 28 testes Python/contratuais passaram e o typecheck TypeScript terminou sem erros.

## Estado da aplicação no banco

A tentativa de inspeção pelo conector Lovable em 14/07/2026 retornou:

```text
403 insufficient_scope: Scope 'projects:write' is required for this operation
```

Portanto, nenhum DDL desta fase foi executado por esse canal. Para concluir a implantação, o conector deve ser reautorizado com o escopo exigido ou as migrations devem ser aplicadas pelo fluxo oficial do Supabase que registre o histórico de migrations.

Uma sondagem REST autenticada e somente leitura em `sports_providers` retornou HTTP 404 na mesma data, confirmando que o schema da Fase 1 ainda não está exposto no banco ativo.
