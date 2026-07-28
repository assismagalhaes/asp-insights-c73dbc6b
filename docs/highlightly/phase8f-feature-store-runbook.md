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

### Contrato 8F.1.1

`get_highlightly_feature_store_report_v3` corrige a serialização do array
`components`: cada item passa a conter componente, snapshots disponíveis,
ausentes, percentual e status. A função reaproveita o relatório v2 e não altera
snapshots existentes.

## Fase 8F.2 - cobertura ajustada por horizonte

O feature set Football `1.1.0` permanece `draft` e desabilitado. A versao
`1.0.0` e seus snapshots imutaveis nao sao modificados.

Politica de componentes:

- `t24h`: historico e standings de mandante/visitante sao obrigatorios; odds
  e escalacoes sao opcionais;
- `t6h`: os quatro componentes centrais e odds pre-jogo sao obrigatorios;
  escalacoes sao opcionais;
- `t60m`: os seis componentes sao obrigatorios.

`get_highlightly_feature_store_report_v4` apresenta lado a lado:

- cobertura armazenada, que preserva o denominador historico de seis
  componentes;
- cobertura ajustada, que considera somente os componentes obrigatorios para
  o horizonte;
- catalogo das versoes `1.0.0` e `1.1.0`;
- papel `required` ou `optional` de cada componente;
- recomendacao deterministica para expansao do canario.

O materializador `materialize_highlightly_football_features_v2` fica preparado
para uso futuro. Quando explicitamente confirmado, reutiliza o builder
point-in-time `1.0.0` e deriva snapshots `1.1.0` na mesma transacao, sem chamar
o provedor, gerar labels, treinar modelos ou criar previsoes.

Aplicar:

```text
supabase/migrations/20260728212259_create_highlightly_phase8f2_horizon_policy.sql
```

Validar:

```text
supabase/tests/highlightly_phase8f2_horizon_policy_smoke.sql
```

A migration e o smoke nao executam o materializador. O provider deve permanecer
desligado e o feature set `1.1.0` deve continuar sem snapshots ate autorizacao
especifica de um novo canario.

### Contrato 8F.2.1

`get_highlightly_feature_store_report_v5` corrige a serializacao do campo
`components` no relatorio ajustado por horizonte. Cada item volta a ser um
objeto estruturado e acrescenta:

- `requirement`: `required` ou `optional`;
- `required_for_horizon`: indicador booleano;
- `status`: `optional` para componentes que nao participam do gate daquele
  horizonte.

O v5 preserva os calculos de cobertura do v4 e reutiliza os componentes
estruturados auditados no v3. A correcao e somente leitura e nao materializa
snapshots.

## Fase 8F.3 - elegibilidade por tipo de competicao

O canario de 100 partidas mostrou cobertura ajustada de `66%`. Historico de
mandante/visitante ficou em `82%`/`71%`, mas standings em `56%`/`55%`.
Amistosos e copas explicam parte relevante do gap porque standings nao sao uma
fonte estruturalmente aplicavel a todas essas competicoes.

A versao Football `1.2.0` resolve a diferenca sem excluir jogos da coleta:

- `league`: standings obrigatorios;
- `cup`, `tournament` e `friendly`: standings opcionais;
- `unknown`: coleta preservada, mas modelagem bloqueada ate classificacao;
- T-6h continua exigindo odds;
- T-60m continua exigindo odds e escalacoes;
- cobertura minima para elegibilidade: `70%`;
- leakage diferente de `clean` sempre bloqueia modelagem.

O catalogo `hl_competition_feature_policies` registra perfil, origem da
classificacao, confianca e possibilidade de uso em modelo. Overrides manuais
nao sao sobrescritos pelo seed automatico.

Como `sports_competitions.competition_type` esta ausente nos dados atuais, a
classificacao inicial usa regras deterministicas de nome. Valores desconhecidos
falham de forma fechada e aparecem no relatorio para revisao.

`get_highlightly_feature_store_report_v6` projeta a politica `1.2.0` sobre os
snapshots imutaveis `1.1.0`, sem criar novos snapshots. O relatorio inclui:

- cobertura e elegibilidade por perfil;
- resumo do catalogo por perfil, origem e confianca;
- componentes obrigatorios/opcionais por perfil;
- elegibilidade por pais e competicao;
- competicoes ainda nao classificadas;
- recomendacao para um futuro canario `1.2.0`.

`materialize_highlightly_football_features_v3` fica preparado, mas nao deve ser
executado durante a implantacao. Ele deriva `1.2.0` de `1.1.0` sem chamadas ao
provedor, labels, treinamento ou previsoes.

Aplicar:

```text
supabase/migrations/20260728221019_create_highlightly_phase8f3_competition_eligibility.sql
```

Validar:

```text
supabase/tests/highlightly_phase8f3_competition_eligibility_smoke.sql
```
