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
