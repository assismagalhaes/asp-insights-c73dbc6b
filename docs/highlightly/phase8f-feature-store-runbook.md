# Fase 8F — Feature store esportivo point-in-time

## Objetivo

Criar uma base reproduzível para treinamento e backtest sem misturar informação
pré-jogo com resultados ou fatos conhecidos depois do início da partida.

A primeira versão cobre Football e não:

- chama a Highlightly;
- habilita o provider;
- cria palpites;
- cria labels automaticamente;
- agenda timer;
- ativa o feature set para produção.

## Contrato 1.0.0

Feature set: `highlightly_football_prematch`.

Horizontes:

- `t24h`: cutoff igual a `kickoff_at - 24 hours`;
- `t6h`: cutoff igual a `kickoff_at - 6 hours`;
- `t60m`: cutoff igual a `kickoff_at - 60 minutes`.

Fontes aceitas:

- partidas anteriores encerradas antes do cutoff;
- estatísticas de partidas anteriores coletadas até o cutoff;
- estatísticas de temporada coletadas até o cutoff;
- standings válidos com `snapshot_at <= cutoff`;
- consenso de odds pré-jogo com `snapshot_at <= cutoff`;
- escalações publicadas e atualizadas até o cutoff.

Fontes proibidas para a partida alvo:

- estatísticas da própria partida;
- eventos;
- box scores;
- period scores;
- placar ou estado final.

Os labels pós-resultado ficam em `hl_match_labels`, separados de
`hl_match_feature_snapshots`. Snapshots são imutáveis; uma correção de contrato
exige nova versão do feature set.

## Segurança

- quatro tabelas com RLS;
- `anon` sem acesso;
- leitura de administrador para `authenticated`;
- escrita somente por `service_role`;
- materializador somente por `service_role`;
- relatório admin-gated;
- RPCs `SECURITY INVOKER`;
- feature set instalado como `draft` e `is_enabled=false`.

## Aplicação

Aplicar:

```text
supabase/migrations/20260728191608_create_highlightly_phase8f_feature_store_foundation.sql
```

Validar transacionalmente:

```text
supabase/tests/highlightly_phase8f_feature_store_smoke.sql
```

O provider deve continuar desligado e nenhuma materialização deve ser executada
durante a migration ou o smoke.

## Preview na VM

O preview consulta apenas o relatório e não cria snapshots:

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
set -a
. /etc/asp-scraper-api.env
set +a
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.materialize_highlightly_phase8f_features \
  --from 2026-07-20T00:00:00+00:00 \
  --to 2026-07-21T00:00:00+00:00 \
  --horizon t24h \
  --limit 20
```

## Primeiro canário

Somente após migration, smoke, publicação do bridge e sincronização da VM:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.materialize_highlightly_phase8f_features \
  --from 2026-07-20T00:00:00+00:00 \
  --to 2026-07-21T00:00:00+00:00 \
  --horizon t24h \
  --limit 20 \
  --confirm-materialize
```

Critérios do canário:

- `provider_calls=0`;
- `labels_generated=0`;
- provider Highlightly desligado antes e depois;
- zero snapshots com `leakage_status=blocked`;
- snapshots duplicados ignorados de forma idempotente;
- cobertura reportada por componente;
- nenhuma previsão criada.

Não instalar timer nesta fase. A automação só poderá ser avaliada depois do
canário e da auditoria de cobertura.

## Fase 8F.1 — auditoria de cobertura

A RPC `get_highlightly_feature_store_report_v2` acrescenta:

- cobertura por componente;
- cobertura por país e liga;
- integridade de cutoff, lineage e unicidade;
- contagem separada de labels;
- gates determinísticos para ampliar o canário.

Gates iniciais:

- mínimo de 20 snapshots para diagnosticar cobertura;
- zero snapshots bloqueados por leakage;
- cobertura média alvo de 70%;
- cobertura mínima por componente de 50%;
- expansão para 100 partidas somente após os gates anteriores.

O relatório é somente leitura e não ativa treinamento, previsões, feature set,
timer ou provider.
