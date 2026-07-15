# Fase 3 — vertical slice MLB

Data: 15/07/2026
Estado: implementação e validação local concluídas; migrations e shadow operacional pendentes no banco ativo

## Resultado

A Fase 3 reutiliza a fundação canônica da Fase 2 e acrescenta o pipeline Baseball/MLB sem criar tabelas por métrica. As 171 métricas observadas de partida são armazenadas dinamicamente em `hl_metric_definitions` e `sports_match_team_stats`, mantendo grupo, nome original, tipo e valor.

O provider continua protegido pelos mesmos dois kill switches:

- `HIGHLIGHTLY_ANALYSIS_ENABLED=false` no ambiente normal;
- `sports_providers.enabled=false` para `highlightly`.

Aplicar as migrations não inicia coleta nem publica uma rota para usuários.

## Migrations

Aplicar depois das migrations da Fase 2, nesta ordem:

1. `20260715100000_create_highlightly_odds_consensus_refresh.sql`;
2. `20260715101000_create_highlightly_baseball_read_models.sql`.

A primeira migration cria a RPC service-only `refresh_sports_odds_consensus`. Ela considera apenas bookmakers preferidos e ativos, usa no máximo sete e exige cinco por padrão. A seleção segue prioridade determinística e calcula mediana, melhor odd, mínima e IQR.

A segunda migration cria:

- `sports_baseball_match_summary_v`;
- `get_baseball_daily_matches` com paginação keyset;
- `get_baseball_match_detail` com gate interno de administrador.

`anon` não recebe `SELECT` nem `EXECUTE`. Escrita de consenso continua restrita ao `service_role`.

## Cobertura dos 20 endpoints Baseball

O normalizador em `api/highlightly/normalizers/baseball.py` cobre:

- partidas, detalhe, últimos cinco jogos e H2H;
- times e estatísticas de time;
- 171 métricas de partida agrupadas em Batting, Pitching e Fielding;
- lineups, titulares, reservas e starting pitcher;
- box scores e estatísticas de jogadores por temporada/time;
- standings com quarentena de payload estruturalmente corrompido;
- odds prematch/live, todos os mercados e seleções;
- bookmakers;
- highlights e restrições geográficas.

Campos não normalizados individualmente permanecem no bruto privado e nos campos `state_data`, `metadata` ou `split_data`, permitindo replay sem nova chamada à Highlightly.

## Starting pitcher

Um pitcher titular só é marcado quando o jogador possui simultaneamente:

- `isStarter=true`;
- posição abreviada `P` ou posição semântica `Pitcher`.

O lineup recebe `is_confirmed=true` apenas quando a resposta contém titulares. Um lineup confirmado sem pitcher titular gera `BASEBALL_STARTING_PITCHER_MISSING`. Os read models retornam `confirmed` ou `unconfirmed`; não existe preenchimento silencioso com um reliever.

## Presets MLB

As métricas retornam com preset derivado do grupo e do nome original:

- `general`;
- `attack` para Batting/ofensiva;
- `pitching` para arremesso do starter;
- `bullpen` para métricas de relief, bullpen ou save;
- `defense` para Fielding/defesa.

O detalhe também expõe os presets funcionais `moneyline`, `total`, `run_line`, `median`, `best` e `movement`.

## Odds e consenso

Após persistir um payload de odds, o worker cria um snapshot de consenso por partida, mercado, seleção, linha e modo live. A ordem dos bookmakers é:

1. bet365;
2. 1xBet;
3. Unibet;
4. William Hill;
5. Stake.com;
6. Betsson;
7. Betway;
8. Ladbrokes;
9. Betano;
10. Novibet;
11. Parimatch.

Somente os sete primeiros disponíveis entram no snapshot. Por padrão, mercados com menos de cinco fontes não recebem mediana; as odds individuais permanecem disponíveis e a ausência de consenso fica explícita.

## Fan-out de uma partida

Uma partida MLB agenda no máximo dez partidas por job pai e cria jobs para:

- estatísticas de partida;
- lineups;
- box scores e fan-out de jogadores;
- highlights;
- odds;
- H2H;
- últimos cinco jogos dos dois times;
- estatísticas históricas dos dois times;
- standings da liga/temporada.

Cada box score aceita no máximo 100 jogadores no fan-out. Dedupe keys incluem o escopo do shadow para permitir repetição controlada sem duplicar fatos canônicos.

## Shadow limitado MLB

Depois de aplicar as duas migrations, executar na VM com os secrets já configurados:

```powershell
python -m scripts.run_highlightly_baseball_shadow `
  --date 2026-07-15 `
  --max-jobs 100 `
  --confirm-bounded-shadow
```

Para um ID conhecido, substituir `--date` por `--match-id 123456`.

O executor:

- descobre apenas partidas da liga `MLB`;
- recusa fila não isolada ou provider previamente habilitado;
- liga o provider apenas dentro do processo;
- restaura `sports_providers.enabled=false` em `finally`;
- preserva bruto, quota e issues de qualidade;
- retorna relatório JSON sem credenciais.

## Validação

Executar `supabase/tests/highlightly_phase3_smoke.sql`. O smoke é transacional e termina com `ROLLBACK`.

Evidência local:

```text
PASS 8 migrations em sequência no PGlite 0.3.14
PASS consenso MLB: 5 bookmakers, mediana 2.00
PASS starting pitcher confirmado no summary read model
PASS Phase 3 transactional smoke
PASS 78 testes Python Highlightly
```

## Aceite operacional pendente

A Fase 3 só deve ser marcada como operacionalmente concluída depois de:

1. aplicar as duas migrations no banco ativo;
2. confirmar provider desligado e privilégios esperados;
3. executar um shadow MLB limitado;
4. verificar que as métricas retornadas, lineups, box scores e odds não geraram erros críticos;
5. confirmar que o provider foi restaurado para `false`;
6. iniciar backfill progressivo apenas após o shadow aprovado.

Até esse gate, os novos dados não alimentam prognósticos, bankroll ou publicação.
