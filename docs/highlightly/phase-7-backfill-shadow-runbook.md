# Fase 7 — backfill, QA e shadow

## Estado desta entrega

Esta etapa instala os controles necessários para iniciar a janela operacional de sete dias.
Nenhum comando desta entrega liga o provider ou consome a API sem a confirmação explícita
`--confirm-phase7-shadow`.

Continuam desligados em repouso:

```env
HIGHLIGHTLY_ANALYSIS_ENABLED=false
VITE_HIGHLIGHTLY_ANALYSIS_ENABLED=false
```

E no banco:

```text
sports_providers.enabled=false para highlightly
```

## Objetos novos

- `hl_shadow_windows`: configuração, orçamento, SLA e estado da janela;
- `hl_shadow_observations`: jobs, quota, cobertura, freshness, latência e issues por dia/esporte;
- `hl_source_reconciliations`: comparação diária com `odds_jogos`;
- `hl_phase7_window_health_v`: gate agregado `collecting`, `blocked`, `below_sla` ou `ready`;
- `refresh_highlightly_shadow_observation`: consolidação service-role-only;
- `refresh_highlightly_source_reconciliation`: reconciliação service-role-only.

A migration adiciona `shadow_scope` à fila. O campo é preenchido automaticamente a partir dos
parâmetros internos e possui índice parcial próprio, evitando varrer a fila por fragmentos da
`dedupe_key`.

## 1. Aplicar e validar o banco

Aplicar, nesta ordem:

```text
supabase/migrations/20260715230000_create_highlightly_phase7_observability.sql
supabase/tests/highlightly_phase7_smoke.sql
```

O smoke é transacional e termina com `ROLLBACK`. Depois da aplicação, confirmar novamente que o
provider permanece desligado.

## 2. Publicar o bridge antes da VM

O bridge HMAC passa a permitir somente as três tabelas operacionais, a view de saúde e as duas
RPCs da Fase 7. A `service_role` continua somente na Lovable Cloud.

## 3. Escolher as ligas de futebol

O shadow completo exige IDs explícitos de pelo menos duas ligas de futebol. O executor se recusa
a coletar football sem `--football-league-id`; isso impede uma varredura global acidental.

MLB e WNBA já estão limitadas respectivamente a `league=MLB` e `leagueId=11847`.

## 4. Fazer o dry-run na VM

O comando abaixo não lê secrets, não toca o banco e não chama a Highlightly:

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
/home/ubuntu/asp-scraper-api/.venv/bin/python -m scripts.run_highlightly_phase7_shadow \
  --scope phase7-YYYYMMDD \
  --data-start YYYY-MM-DD \
  --backfill-days 1 \
  --football-league-id LEAGUE_ID_1 \
  --football-league-id LEAGUE_ID_2
```

Revisar no JSON:

- três esportes;
- quantidade de seed jobs;
- páginas de 10 partidas;
- orçamento máximo de 1.500;
- reserva de 750;
- mesmo `scope` em todos os jobs.

## 5. Executar uma fatia controlada

Somente após o dry-run aprovado:

```bash
sudo /bin/bash -lc "set -a; source /etc/asp-scraper-api.env; set +a; \
  cd /home/ubuntu/asp-insights-c73dbc6b; \
  PYTHONDONTWRITEBYTECODE=1 /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.run_highlightly_phase7_shadow \
  --scope phase7-YYYYMMDD \
  --data-start YYYY-MM-DD \
  --backfill-days 1 \
  --football-league-id LEAGUE_ID_1 \
  --football-league-id LEAGUE_ID_2 \
  --daily-request-budget 1500 \
  --max-jobs 200 \
  --confirm-phase7-shadow"
```

Reutilizar exatamente o mesmo `scope` durante os sete dias. Executar uma fatia por vez; se houver
jobs ativos do mesmo escopo, a execução pode retomá-los. Jobs ativos de outro escopo ou um job já
em execução bloqueiam o processo.

O teto efetivo é calculado como o menor valor entre:

```text
uso atual + orçamento solicitado
6750 chamadas
```

Assim, as 750 chamadas de reserva nunca ficam disponíveis ao backfill, nem para jobs P0.

## 6. Monitorar sem consumir quota

```bash
sudo /bin/bash -lc "set -a; source /etc/asp-scraper-api.env; set +a; \
  cd /home/ubuntu/asp-insights-c73dbc6b; \
  /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.check_highlightly_phase7_gate --scope phase7-YYYYMMDD"
```

Para o gate final do sétimo dia, acrescentar `--require-ready`. O comando é somente leitura e não
chama a Highlightly. Códigos de saída:

- `0`: coleta saudável ou gate pronto;
- `1`: provider ligado em repouso, gate bloqueado/abaixo do SLA ou `--require-ready` ainda não pronto;
- `2`: janela inexistente.

Alertar operacionalmente em qualquer código diferente de zero e nos seguintes campos:

- `unrecovered_jobs > 0`;
- `open_critical_issues > 0`;
- cobertura de partidas abaixo de 95%;
- cobertura de odds abaixo de 90%;
- freshness p95 acima de 2.160 segundos;
- reserva projetada abaixo de 750 chamadas.

## 7. EXPLAIN e ajuste de índices

Após acumular volume representativo, substituir o scope em
`supabase/tests/highlightly_phase7_explain.sql` e executar as consultas somente leitura. Registrar:

- planning e execution time;
- buffers hit/read;
- sequential scans em tabelas grandes;
- rows removed by filter;
- sorts em disco.

Não criar índices apenas por intuição. Confirmar benefício com o plano real e executar `ANALYZE`
após backfills grandes antes de comparar novamente.

## Gate para a Fase 8

A janela só pode ser marcada como pronta quando:

- existem sete dias distintos observados;
- não existem jobs mortos nem issues críticas abertas;
- cobertura mínima de partidas é pelo menos 95%;
- cobertura mínima de odds é pelo menos 90%;
- freshness permanece dentro do SLA;
- provider está desligado em repouso;
- prognósticos, bankroll e publicação não sofreram regressão.

A feature flag visual e o provider não devem ser ativados automaticamente quando o gate ficar
`ready`; a decisão continua manual na Fase 8.
