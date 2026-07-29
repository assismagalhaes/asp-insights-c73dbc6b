# Fase 8G — Labels pós-jogo

## 8G.0 — Catálogo

O contrato `highlightly_football_postmatch` versão `1.0.0` possui 27
definições determinísticas e permanece `draft` e desabilitado.

## 8G.1 e 8G.1.1 — Preview de settlement

O preview usa somente dados armazenados. Uma partida sem `ended_at` pode ser
aceita apenas quando existe uma observação persistida da Highlightly com:

- `state.description = Finished`;
- placar igual ao placar canônico;
- `last_seen_at >= kickoff_at`.

Partidas encerradas após prorrogação, pênaltis, abandonadas ou atribuídas
continuam em revisão manual.

## 8G.2 — Canário de labels de placar

A primeira materialização grava somente as 18 definições das famílias:

- `full_time_result`;
- `total_goals`;
- `both_teams_to_score`;
- `asian_handicap`.

`first_team_to_score` e `total_corners` não são gravadas enquanto as fontes
armazenadas não atingirem cobertura suficiente.

Salvaguardas:

- provider Highlightly obrigatoriamente desligado;
- zero chamadas ao provider;
- label set ainda `draft` e desabilitado;
- execução manual, limitada a 200 partidas;
- `ON CONFLICT DO NOTHING` para idempotência;
- labels imutáveis;
- nenhuma ativação de treinamento ou previsão;
- cada execução auditada em `hl_label_materialization_runs`.

## Aplicação

Aplicar:

```text
supabase/migrations/20260729180000_create_highlightly_phase8g2_score_label_canary.sql
```

Validar:

```text
supabase/tests/highlightly_phase8g2_score_label_canary_smoke.sql
```

## Operação na VM

Preview, sem escrita:

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
set -a
. /etc/asp-scraper-api.env
set +a
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.materialize_highlightly_phase8g_labels \
  --days 365 \
  --limit 20
```

Canário confirmado:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.materialize_highlightly_phase8g_labels \
  --days 365 \
  --limit 20 \
  --confirm-materialize
```

Antes e depois da execução, confirmar:

- `sports_providers.enabled=false`;
- 18 definições por label;
- `provider_calls=0`;
- nenhum label de primeiro gol ou cantos;
- nenhuma execução automática de treinamento ou previsão.

## 8G.3 — Dataset auditável

O contrato `highlightly_football_prematch_score` versão `1.0.0` liga:

- feature set `highlightly_football_prematch@1.2.0`;
- horizonte `t24h`;
- label `highlightly_football_postmatch.score.1.0.0`.

Somente entram no dataset snapshots `clean`, elegíveis para modelo, com
cobertura mínima de 70%, fontes anteriores ao cutoff e labels válidos com 18
resultados de placar. As linhas são imutáveis e cada execução usa divisão
temporal determinística: 70% treino, 15% validação e 15% teste, sem shuffle.

Aplicar:

```text
supabase/migrations/20260729183643_bca27b94-4893-4280-a2c5-42deeb3d6da2.sql
```

Validar:

```text
supabase/tests/highlightly_phase8g3_training_dataset_smoke.sql
```

Preview, sem escrita:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.build_highlightly_phase8g3_dataset \
  --days 365 \
  --limit 100
```

Canário confirmado:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.build_highlightly_phase8g3_dataset \
  --days 365 \
  --limit 100 \
  --confirm-build
```

A Fase 8G.3 não chama o provider, não treina modelo e não produz previsões.

### 8G.3.1 — Backfill direcionado de features

Se o preview indicar `missing_feature_snapshot`, aplicar:

```text
supabase/migrations/20260729185127_a3b7cee2-8618-47d9-bfe7-ca615333fa92.sql
```

Validar:

```text
supabase/tests/highlightly_phase8g31_labeled_feature_backfill_smoke.sql
```

Preview:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.backfill_highlightly_phase8g31_features \
  --limit 20
```

Execução confirmada:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.backfill_highlightly_phase8g31_features \
  --limit 20 \
  --confirm-backfill
```

Esse backfill processa somente partidas já rotuladas e reutiliza o
materializador Football existente sobre dados armazenados. O provider continua
desligado e nenhuma label, treinamento ou previsão é gerada.

### 8G.3.2 — Diagnóstico de sobreposição

Quando o backfill processar uma partida sem criar o snapshot esperado, aplicar:

```text
supabase/migrations/20260729210000_create_highlightly_phase8g32_overlap_diagnostics.sql
```

Validar:

```text
supabase/tests/highlightly_phase8g32_overlap_diagnostics_smoke.sql
```

Executar o relatório somente leitura:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.report_highlightly_phase8g32_overlap \
  --limit 200
```

O relatório separa falhas de participantes, status, kickoff e snapshots
intermediários 1.0.0/1.1.0/1.2.0. Ele usa somente dados armazenados, não
escreve no banco, não chama o provider e não gera labels, treinamento ou
previsões.

### 8G.3.3 — Backfill agrupado por kickoff

Quando o diagnóstico apontar `source_v100_snapshot_missing` em partidas que
compartilham o mesmo horário, aplicar:

```text
supabase/migrations/20260729200330_3c2ccb88-a50e-4277-81dd-72fb2564c2e1.sql
```

Validar:

```text
supabase/tests/highlightly_phase8g33_grouped_backfill_smoke.sql
```

Preview:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.backfill_highlightly_phase8g33_features \
  --limit 20 \
  --max-candidates-per-kickoff 200
```

Execução confirmada:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.backfill_highlightly_phase8g33_features \
  --limit 20 \
  --max-candidates-per-kickoff 200 \
  --confirm-backfill
```

O agrupamento executa uma única materialização por horário, usando como limite
o número real de confrontos elegíveis naquele kickoff. Grupos acima do teto
configurado são rejeitados. O provider permanece desligado e nenhuma label,
treinamento ou previsão é gerada.

### 8G.4 — Gate de prontidão para treinamento

Aplicar:

```text
supabase/migrations/20260729211402_33f38735-ffee-456d-99bf-88544117f175.sql
```

Validar:

```text
supabase/tests/highlightly_phase8g4_training_readiness_smoke.sql
```

Gerar o relatório somente leitura:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.report_highlightly_phase8g4_readiness \
  --days 365
```

O relatório separa `data_ready` de `manual_training_authorized`. A política
permanece `draft` e desabilitada, e nenhuma rotina desta fase executa
treinamento ou previsão.

### 8G.4.1 — Acumulador diário auditado

Aplicar:

```text
supabase/migrations/20260729213012_create_highlightly_phase8g41_daily_accumulator.sql
```

Validar:

```text
supabase/tests/highlightly_phase8g41_daily_accumulator_smoke.sql
```

Executar primeiro em `dry-run`:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.run_highlightly_phase8g41_accumulator \
  --days 365 \
  --label-limit 200 \
  --feature-limit 200 \
  --max-candidates-per-kickoff 200 \
  --dataset-limit 5000
```

Instalar os units, mantendo o timer desabilitado até o canário:

```bash
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-training-accumulator.service \
  /etc/systemd/system/highlightly-training-accumulator.service
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-training-accumulator.timer \
  /etc/systemd/system/highlightly-training-accumulator.timer
sudo systemctl daemon-reload
sudo systemctl disable highlightly-training-accumulator.timer
```

O unit compartilha `/run/lock/asp-highlightly-future.lock`, mantém o provider
desligado e executa somente labels, features, dataset e relatório de prontidão
com dados armazenados. Treinamento e previsões continuam proibidos.
