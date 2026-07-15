# Fase 0 — contrato canônico Highlightly

Status: aprovado para implementação da fundação.
Contrato do provider: OpenAPI 6.13.2 congelado em `docs/vendor/highlightly/openapi-6.13.2.json`.

## Escopo V1

- Football: 25 operações.
- Baseball/MLB: 20 operações.
- Basketball/WNBA: 19 operações.
- Total: 64 operações GET.

O registry executável está em `config/highlightly/endpoint-registry.json`. Ele é gerado exclusivamente a partir do contrato congelado e das políticas da Fase 0.

## Identidades

- IDs internos: UUID gerado pelo ASP.
- ID do provider: armazenado como `text`, mesmo quando a API o representa como number.
- Chave externa única: `provider + entity_type + external_id`.
- Partida: nunca deduplicar somente por nomes/data. O ID Highlightly é a identidade externa principal.
- Bookmaker: ID Highlightly mais alias canônico; nomes não são identidade suficiente.
- Times/jogadores: preservar nome original, display name e abbreviation separadamente.
- Nenhum ID de uma modalidade pode ser presumido globalmente único fora do namespace `sport + entity_type`.

## Datas e horários

- Instantes: UTC em `timestamptz`.
- `kickoff_at`: instante UTC oficial do evento.
- `provider_timezone`: timezone usado/retornado na consulta.
- `local_date`: data civil da competição para filtros, derivada de timezone explícito.
- `collected_at`: instante em que a resposta foi recebida.
- `provider_updated_at`: atualização informada pelo provider, quando existir.
- `feature_cutoff_at`: limite temporal de features, sempre anterior ao kickoff.
- Data sem horário não deve ser convertida silenciosamente em meia-noite UTC.

## Temporadas e rodadas

- Temporada: `text`, pois pode ser `2026`, `2025/26` ou outro formato.
- Ano numérico, quando disponível, fica em coluna auxiliar.
- Round/rodada: texto original e chave normalizada separadas.
- Liga + temporada + provider formam o escopo mínimo de standings e team stats.

## Números e unidades

- Odds decimais: `numeric(10,4)` e estritamente maiores que `1.00` para consumo analítico.
- Percentuais canônicos: intervalo `0–1`; o valor original permanece no raw.
- Scores, contagens e ranks: inteiros quando semanticamente inteiros.
- Rates/averages: numeric, sem arredondar na ingestão.
- Dinheiro não faz parte do domínio Highlightly.
- Ausência é `null`, nunca zero inventado.
- Valores não numéricos permanecem em `text_value` e geram tipo no catálogo.

Unidades iniciais:

```text
count, ratio, percent, seconds, minutes,
goals, corners, runs, points, innings,
meters, yards, kilograms, unknown
```

## Chaves de métricas

Formato:

```text
<sport>.<scope>.<group_optional>.<metric_slug>
```

Exemplos:

```text
football.match.expected_goals
football.match.shots_on_target
baseball.match.pitching.earned_run_average
basketball.match.offensive_rebounds
```

Regras:

- lowercase `snake_case` em cada segmento;
- remover acentos e pontuação apenas na chave canônica;
- preservar `provider_key`, `display_name` e `group_name` originais;
- métricas novas entram como `status=unreviewed`, nunca são descartadas;
- colisões de slug são resolvidas com grupo/escopo, não sobrescritas;
- conversões de unidade precisam de versão e teste.

## Estado de partidas

Estados canônicos iniciais:

```text
scheduled, delayed, postponed, cancelled,
live, interrupted, finished, after_extra_time,
after_penalties, awarded, unknown
```

O estado original do provider é preservado. Mapeamento desconhecido resulta em `unknown` e issue de qualidade, não em `scheduled`.

## Estatísticas

O grão padrão é:

```text
provider, sport, resource, match/team/player scope,
metric_definition, period/split, value, collected_at
```

- Métricas de partida são pós-evento e não podem alimentar a própria previsão pré-jogo.
- Totais acumulados só viram rates em uma camada derivada com denominador explícito.
- For/against é calculado pela perspectiva da entidade, nunca inferido pelo nome da coluna.
- Box score e lineup usam versões, pois podem sofrer correções.
- Payload HTTP 200 ainda passa por validação semântica.

## Odds

Chave lógica da cotação:

```text
provider + match_id + odds_type + bookmaker_id +
market_key + line + selection_key
```

- `sports_odds_current`: última cotação conhecida.
- `sports_odds_history`: append somente quando odd, status ou linha mudar.
- Odds `<= 1.00`, não numéricas ou sem metadata obrigatória são quarentenadas.
- Um snapshot de consenso exige no mínimo três bookmakers elegíveis.
- Mediana, melhor preço, IQR e quantidade de bookmakers são derivados, não substituem as cotações originais.

## Proveniência mínima

Todo registro normalizado deve poder apontar para:

```text
provider, endpoint_key, ingestion_run_id,
raw_object_id, external_entity_id,
collected_at, normalizer_version, schema_fingerprint
```

## Compatibilidade e schema drift

- O hash do OpenAPI é verificado em teste.
- Toda operação V1 precisa de cadence, prioridade, SLA, normalizer e destino.
- Campo novo em payload é preservado no raw.
- Métrica nova é registrada automaticamente.
- Campo obrigatório removido bloqueia o normalizer daquele recurso e abre issue crítica.
- Mudança de tipo é guardada sem coerção destrutiva e exige revisão.
