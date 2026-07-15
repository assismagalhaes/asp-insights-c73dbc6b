# Fase 3 — vertical slice MLB

Data: 15/07/2026
Estado: implementação, migrations e validação operacional concluídas no banco ativo; provider mantido desligado

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

A RPC service-only `refresh_sports_odds_consensus` considera apenas bookmakers preferidos e ativos, usa no máximo sete e exige duas fontes por padrão. A seleção segue prioridade determinística e calcula mediana, melhor odd, mínima e IQR.

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

Somente os sete primeiros disponíveis entram no snapshot. Mercados com duas ou mais fontes recebem mediana; com uma única fonte, a odd individual permanece disponível e a ausência de consenso fica explícita.

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

## Evidência operacional

As migrations da Fase 3 foram aplicadas no banco ativo e o smoke transacional passou sem exceções. Em seguida, dois shadows isolados foram executados na VM com restauração automática de `sports_providers.enabled=false`.

### All-Star Game — contrato completo e drenagem da fila

- Highlightly match `1545955`;
- canonical match `fc8feaeb-7ed1-5c1e-94b1-c896cd7adf07`;
- 100 jobs iniciais bem-sucedidos e 34 jobs de jogadores drenados pelo escopo `mlb-shadow-20260715T173457Z-c20a80ae`;
- fila final: zero `pending`, `retry` ou `running`;
- 342 estatísticas de equipe, 18 inning scores, 547 eventos, 631 fatos de box score e 192 odds atuais/históricas;
- duas escalações e dois starting pitchers confirmados;
- 12 warnings `SCHEMA_FINGERPRINT_CHANGED`, todos explicados pela diferença esperada entre payloads pré-jogo e pós-jogo, sem erro ou corrupção.

### Dodgers × Diamondbacks — partida regular concluída

- Highlightly match `1543179`;
- canonical match `2746e4ff-6780-5365-845a-07947ef045d1`;
- escopo `mlb-shadow-20260715T180130Z-0e5eac4e`;
- 75 jobs bem-sucedidos e encerramento por fila ociosa;
- fila final vazia e provider restaurado para `false`;
- Dodgers: 171 métricas; Diamondbacks: 171 métricas;
- 18 inning scores, 566 eventos, 328 fatos de box score, duas escalações confirmadas e 32 jogadores de lineup;
- starting pitchers confirmados: Emmet Sheehan e Mitch Bratt;
- 478 odds atuais e 478 aberturas no histórico;
- oito consensos válidos com 5–6 bookmakers: Moneyline e Totais 8.5, 9.5 e 10.5;
- um warning `SCHEMA_FINGERPRINT_CHANGED` no detalhe da partida, sem erro crítico.

## Cobertura real de Run Line e regra atualizada

Uma varredura somente leitura das 15 partidas MLB de 12/07/2026 mostrou cobertura máxima de quatro bookmakers preferidos para uma mesma seleção/linha de Run Line: bet365, Ladbrokes, Stake.com e William Hill. Isso confirmou que a cobertura varia por mercado e partida.

A regra global foi atualizada para 2–7 bookmakers. Com duas, três ou quatro fontes, o sistema calcula a mediana normalmente e mantém `bookmaker_count` e `bookmaker_ids` para que a interface e os modelos conheçam a cobertura. O read model entrega:

- todas as odds individuais de Run Line;
- quantidade e identidade das fontes disponíveis;
- histórico de abertura e mudanças futuras;
- `oddsConsensus` vazio apenas quando existe menos de duas fontes para a mesma seleção/linha.

Moneyline, Totais e Run Line recebem mediana, melhor odd, mínima e IQR quando houver de duas a sete fontes. Quanto maior `bookmaker_count`, maior a cobertura observada; nenhum preço é inventado quando existe somente uma fonte.

## Aceite operacional

- PASS migrations e smoke no banco ativo;
- PASS 171 métricas por equipe pesquisáveis por grupo;
- PASS lineups e starting pitchers com status confirmado;
- PASS eventos, box scores, jogadores, highlights e inning scores;
- PASS Moneyline e Totais com consenso real de 5–6 bookmakers;
- PASS regra global de consenso atualizada para 2–7 bookmakers, incluindo Run Line;
- PASS fila isolada e completamente drenada;
- PASS provider restaurado para `false` e `HIGHLIGHTLY_ANALYSIS_ENABLED=false` mantido;
- PASS nenhum erro de qualidade crítico.

A Fase 3 está operacionalmente validada. Backfill progressivo, alimentação de prognósticos, bankroll e publicação continuam desligados até autorização específica da etapa de ativação.
