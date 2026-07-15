# Fase 2 — vertical slice Football

Data: 15/07/2026
Estado: migrations aplicadas e validadas no banco ativo; shadow operacional pendente

## Resultado

Esta fase transforma a fundação da Fase 1 em um pipeline Football completo e replayable. O recorte recebe uma partida Highlightly, preserva o bruto, normaliza as entidades e fatos, mantém odds atuais e históricas, e expõe read models administrativos para a futura interface.

A ativação continua bloqueada por dois kill switches independentes:

- `HIGHLIGHTLY_ANALYSIS_ENABLED=false` no worker;
- `sports_providers.enabled=false` para o provider `highlightly`.

Aplicar migrations não inicia coleta e não publica nova rota de usuário.

## Migrations

Aplicar depois das três migrations da Fase 1, nesta ordem:

1. `20260715050000_create_highlightly_sports_facts.sql`;
2. `20260715051000_create_highlightly_odds_foundation.sql`;
3. `20260715052000_create_highlightly_football_read_models.sql`.

A primeira migration cria fatos em formato longo para estatísticas dinâmicas, escalações, eventos, standings e highlights. A segunda cria mercados, odds atuais, histórico change-only e consenso. A terceira cria a lista diária Football e o detalhe agregado de partida.

Todas as tabelas têm RLS. `anon` não recebe acesso; `authenticated` lê apenas com role `admin`; escrita permanece restrita ao `service_role`. As RPCs de escrita de odds são `SECURITY DEFINER`, usam `search_path=''` e não podem ser executadas por clientes.

## Pipeline

```text
job com lease
  -> quota guard
  -> Highlightly GET
  -> JSON gzip privado + SHA-256
  -> fingerprint de schema
  -> normalizador Football
  -> upserts canônicos em lotes
  -> odds atuais + histórico somente quando muda
  -> issues de qualidade / quarentena
  -> read models admin-only
```

O runtime fica em `api/highlightly/` e é independente da API web. IDs UUIDv5 determinísticos tornam retries e replay idempotentes. O registry congelado filtra os parâmetros permitidos, portanto credenciais ou campos internos não são encaminhados à Highlightly.

## Cobertura Football

Os 25 endpoints do registry têm roteamento de normalização:

- países, ligas, temporadas, times, jogadores e bookmakers;
- partidas, confrontos diretos e últimos cinco jogos;
- odds prematch/live, todos os mercados e todas as seleções retornadas;
- estatísticas da partida e estatísticas do time;
- escalações e jogadores da escalação;
- eventos ao vivo;
- standings com snapshots;
- box scores por jogador;
- highlights e restrições geográficas;
- estatísticas de jogador.

Métricas não conhecidas não exigem migration: entram em `hl_metric_definitions` com `status='needs_review'` e o valor tipado é preservado na tabela de fatos correspondente.

## Odds

`sports_odds_current` contém uma linha por partida, bookmaker, mercado, seleção, linha e modo live. `sports_odds_history` recebe uma nova linha somente em abertura ou mudança de preço, status ou linha.

A RPC singular usa advisory lock transacional. A RPC em lote limita cada chamada a 1.000 cotações e reaproveita a mesma regra idempotente. Repetir a mesma cotação atualiza apenas `last_seen_at`.

`sports_odds_consensus` está preparado para mediana, melhor odd, mínima, IQR e conjunto de bookmakers. O cálculo/agendamento periódico do consenso será conectado depois que o primeiro shadow confirmar os nomes reais de mercados e bookmakers.

## Quota e paginação

- limite contratual no registry: 7.500 requests/dia;
- reserva operacional: 750 requests;
- jobs de prioridade diferente de zero param em 6.750 requests;
- prioridade zero pode consumir a reserva até 7.500;
- paginação usa `pagination.offset`, `limit` e `totalCount`;
- cada página seguinte recebe dedupe key determinística;
- fan-out shadow é limitado a no máximo 10 partidas por job pai.

## Shadow de uma partida

O executor recomendado realiza um shadow limitado, exige confirmação explícita e pode descobrir automaticamente uma partida a partir da data informada:

```powershell
python -m scripts.run_highlightly_football_shadow `
  --date 2026-07-15 `
  --max-jobs 100 `
  --confirm-bounded-shadow
```

Para testar um ID conhecido, substituir `--date` por `--match-id 123456`.

O executor:

- recusa iniciar se o provider já estiver ligado ou se houver jobs pendentes/running;
- preserva também o payload usado na descoberta automática;
- liga `sports_providers.enabled` apenas dentro do processo;
- cria um escopo de dedupe exclusivo para o shadow;
- processa no máximo o limite solicitado;
- cria fan-out para odds, estatísticas, escalações, eventos, box score, jogadores, highlights, confronto direto, últimos cinco jogos, estatísticas dos dois times e standings;
- restaura `sports_providers.enabled=false` em bloco `finally`, inclusive após falha;
- mantém `HIGHLIGHTLY_ANALYSIS_ENABLED=false` no ambiente normal;
- imprime um relatório JSON sem credenciais.

O caminho manual continua disponível, mas não é o recomendado:

1. habilitar `sports_providers.enabled=true` para `highlightly`;
2. definir `HIGHLIGHTLY_ANALYSIS_ENABLED=true` somente no processo do worker;
3. executar um job por vez:

```powershell
python -m scripts.run_highlightly_worker --max-jobs 1
```

4. acompanhar `hl_ingestion_runs`, `hl_rate_limit_usage` e `hl_data_quality_issues`;
5. ao terminar o lote, retornar os dois kill switches para `false`.

Não ativar o worker antes da aplicação das três migrations.

## Read models

`get_football_daily_matches` usa intervalo semiaberto `[from, to)`, paginação keyset por `(kickoff_at, match_id)` e limite máximo de 200.

`get_football_match_detail` retorna:

- partida, competição, temporada e participantes;
- placares por período;
- todas as estatísticas dos times;
- forma/estatísticas históricas dos times;
- odds atuais e consenso;
- escalações;
- eventos;
- box scores;
- standings mais recentes;
- highlights.

As duas RPCs exigem usuário autenticado com role `admin`.

## Validação

Executar `supabase/tests/highlightly_phase2_smoke.sql`. O script termina com `ROLLBACK` e verifica objetos, grants, provider desativado, escrita de odds singular/em lote, idempotência e histórico change-only.

Evidência local:

```text
PASS 6 migrations em sequência no PGlite 0.3.14
PASS odds idempotency: current=1, history=2, opening -> price
PASS Football daily list e match detail
PASS Phase 2 transactional smoke
PASS 429 testes Python do repositório
PASS TypeScript typecheck
```

## Rollback operacional

1. definir `HIGHLIGHTLY_ANALYSIS_ENABLED=false`;
2. definir `sports_providers.enabled=false`;
3. parar o worker;
4. cancelar jobs pendentes se necessário;
5. preservar bruto e tabelas para replay e auditoria.

Nenhum rollback normal remove dados. Remoção física exigiria migration destrutiva separada e aprovação explícita.
