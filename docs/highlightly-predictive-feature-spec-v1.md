# Especificação de estatísticas para os novos modelos Highlightly — V1

Data de definição: 14/07/2026
Esportes: Football, MLB e WNBA
Escopo: mercados pré-jogo com linhas de meio ponto (`.5`)

## Decisão de arquitetura

Não haverá um modelo por linha de mercado. Cada esporte terá um modelo-base de distribuição:

- Football: distribuição conjunta de gols do mandante e visitante; um componente próprio para cantos e outro para primeiro gol.
- MLB: distribuição conjunta de corridas do mandante e visitante.
- WNBA: distribuição conjunta de pontos, total e margem.

As probabilidades de Moneyline/1X2, Over/Under, BTTS e Handicap serão derivadas dessas distribuições. Isso mantém coerência: por exemplo, `P(Over 2.5)` nunca pode ser maior que `P(Over 1.5)`.

## Regra temporal obrigatória

Toda feature deve representar somente informação disponível antes do horário da partida. Estatísticas de `/statistics/{matchId}` e box scores são dados pós-jogo: servem para atualizar o histórico das partidas anteriores, nunca para alimentar a própria partida. Cada registro deve ter `feature_cutoff_at < kickoff_at`.

## Janelas e transformações comuns

Cada métrica bruta marcada como P0 deve gerar, quando houver amostra:

1. `season`: média da temporada até o cutoff;
2. `last_10_ewm`: média exponencial dos últimos 10 jogos, com maior peso nos recentes;
3. `last_5`: média dos últimos 5, usada como diagnóstico de forma;
4. `venue`: mandante somente em casa e visitante somente fora;
5. `opponent_adjusted`: valor corrigido pela força dos adversários;
6. `for`, `against` e `differential` quando a métrica permitir;
7. `home_minus_away` e interação `ataque_do_time × defesa_do_adversário` no dataset da partida.

Temporada e janela recente devem ser encolhidas para a média da liga em amostras pequenas. H2H não será feature principal; no máximo P1 com peso baixo.

Prioridades:

- **P0:** necessária na primeira versão.
- **P1:** enriquecimento depois de comprovar cobertura e ganho fora da amostra.
- **P2:** diagnóstico; não entra inicialmente por redundância, instabilidade ou risco de leakage.

## Football — gols, 1X2, BTTS, primeiro gol e handicap

Fontes principais: `/football/matches`, `/football/statistics/{matchId}`, `/football/teams/statistics/{id}` e `/football/events/{matchId}`.

| ID | Estatística/feature | Definição operacional | Mercados | Prioridade |
|---|---|---|---|---|
| FB-01 | Gols marcados | Gols do time por jogo | Todos de gols/resultado | P0 |
| FB-02 | Gols sofridos | Gols do adversário por jogo | Todos de gols/resultado | P0 |
| FB-03 | Saldo de gols | `gols marcados - gols sofridos` | 1X2 e handicap | P0 |
| FB-04 | Expected Goals (xG) a favor | `Expected Goals` produzido pelo time | Gols, 1X2, BTTS, handicap | P0 |
| FB-05 | Expected Goals contra (xGA) | `Expected Goals` produzido pelo adversário | Gols, 1X2, BTTS, handicap | P0 |
| FB-06 | Saldo de xG | `xG - xGA` | 1X2 e handicap | P0 |
| FB-07 | Finalizações no alvo a favor | `Shots on target` | Gols, BTTS e primeiro gol | P0 |
| FB-08 | Finalizações no alvo contra | `Shots on target` do adversário | Gols, BTTS e handicap | P0 |
| FB-09 | Finalizações totais a favor | `on target + off target + blocked` | Gols e handicap | P0 |
| FB-10 | Finalizações totais contra | Mesmo cálculo para o adversário | Gols e handicap | P0 |
| FB-11 | Finalizações dentro da área a favor | `Shots within penalty area` | Gols e BTTS | P0 |
| FB-12 | Finalizações dentro da área contra | Valor do adversário | Gols e BTTS | P0 |
| FB-13 | Grandes chances criadas | `Big Chances Created` | Gols, BTTS e primeiro gol | P0 |
| FB-14 | Grandes chances cedidas | Valor criado pelos adversários | Gols, BTTS e handicap | P0 |
| FB-15 | Conversão de finalizações | `gols / finalizações`, com shrinkage | Gols e primeiro gol | P0 |
| FB-16 | Conversão de xG | `gols / xG`, limitada para evitar extremos | Gols; regressão à média | P1 |
| FB-17 | Expected Assists (xA) | `Expected Assists` | Gols e BTTS | P0 |
| FB-18 | Passes-chave | `Key Passes` | Gols e BTTS | P0 |
| FB-19 | Passes no terço final | `Passes Into Final Third` | Gols, handicap e cantos | P0 |
| FB-20 | Posse | `Possession` em proporção, não texto `%` | Resultado e handicap | P1 |
| FB-21 | Defesas do goleiro | `Goalkeeper saves` | Força defensiva e BTTS | P0 |
| FB-22 | Taxa de defesa | `defesas / (defesas + gols sofridos)` | Gols e BTTS | P0 |
| FB-23 | Interceptações | `Interceptions` | Resultado e handicap | P1 |
| FB-24 | Desarmes bem-sucedidos | `Successful Tackles` | Resultado e handicap | P1 |
| FB-25 | Cartões vermelhos | Média e frequência de `Red cards` | Variância e risco | P0 |
| FB-26 | Cartões amarelos | Média de `Yellow cards` | Diagnóstico disciplinar | P1 |
| FB-27 | Marca primeiro | Percentual histórico calculado pelos eventos | Primeiro gol, 1X2 | P0 |
| FB-28 | Sofre primeiro | Percentual histórico calculado pelos eventos | Primeiro gol, handicap | P0 |
| FB-29 | Minuto do primeiro gol a favor | Mediana/censura quando não marca | Primeiro gol | P1 |
| FB-30 | Clean sheet | Frequência de zero gols sofridos | BTTS e Under | P0 |
| FB-31 | Failed to score | Frequência de zero gols marcados | BTTS e Under | P0 |
| FB-32 | Aproveitamento | `(3V + 1E) / (3 jogos)` | 1X2 e handicap | P0 |
| FB-33 | Dias de descanso | Dias desde a última partida | Todos | P0 |
| FB-34 | Mandante/visitante | Indicador e splits casa/fora | Todos | P0 |
| FB-35 | Força da liga | Média de gols e vantagem de casa da liga/temporada | Todos | P0 |
| FB-36 | Força da escalação | Soma/ponderação da produção dos titulares confirmados | Todos | P1 |
| FB-37 | Ausências relevantes | Minutos/xG/xA indisponíveis por lesão/suspensão | Todos | P1 |
| FB-38 | Formação | Formação confirmada, agrupada em categorias estáveis | Resultado e cantos | P2 |

Não usar inicialmente: passes para trás, laterais, tiros de meta, faltas e bolas aéreas isoladamente. Eles são muito correlacionados com estilo/posse e só entram se a ablação provar ganho fora da amostra.

## Football — componente de cantos

| ID | Estatística/feature | Definição operacional | Prioridade |
|---|---|---|---|
| FC-01 | Cantos a favor | `Corners` do time por jogo | P0 |
| FC-02 | Cantos contra | `Corners` dos adversários | P0 |
| FC-03 | Total de cantos | `cantos a favor + contra` | P0 |
| FC-04 | Saldo de cantos | `a favor - contra` | P0 |
| FC-05 | Cruzamentos | `Crosses` | P0 |
| FC-06 | Cruzamentos certos | `Successful Crosses` | P0 |
| FC-07 | Taxa de cruzamentos certos | `successful crosses / crosses` | P1 |
| FC-08 | Ataques | `Attacks` | P0 |
| FC-09 | Finalizações totais | FB-09/FB-10 | P0 |
| FC-10 | Chutes bloqueados | `Blocked shots` | P0 |
| FC-11 | Passes no terço final | FB-19 | P0 |
| FC-12 | Posse territorial | Posse e passes no campo adversário | P1 |
| FC-13 | Clearances do adversário | Pressão sofrida pelo oponente | P1 |
| FC-14 | Estado esperado do placar | Probabilidade pré-jogo de favorito ficar atrás/na frente | P1 |
| FC-15 | Média da liga | Cantos por jogo e dispersão por liga/temporada | P0 |

## MLB — Moneyline, totais e run line

Fontes principais: `/baseball/matches`, `/baseball/statistics/{matchId}`, `/baseball/lineups/{matchId}`, `/baseball/box-score/{matchId}`, `/baseball/players/{id}/statistics` e `/baseball/last-five-games`.

| ID | Estatística/feature | Definição operacional | Mercados | Prioridade |
|---|---|---|---|---|
| MLB-01 | Runs for | Corridas marcadas por jogo | Todos | P0 |
| MLB-02 | Runs allowed | Corridas sofridas por jogo | Todos | P0 |
| MLB-03 | Run differential | `runs for - runs allowed` | Moneyline e run line | P0 |
| MLB-04 | Win rate | Vitórias/jogos, com shrinkage | Moneyline | P0 |
| MLB-05 | Hits | `Batting / Total Hits` por jogo | Todos | P0 |
| MLB-06 | Walks | `Batting / Total Walks` por plate appearance | Totais | P0 |
| MLB-07 | Strikeouts ofensivos | `Batting / Total Strikeouts` por plate appearance | Totais e Moneyline | P0 |
| MLB-08 | Home runs | `Batting / Total Home Runs` por plate appearance | Todos | P0 |
| MLB-09 | Extra-base hits | Doubles + triples + home runs por PA | Totais e run line | P0 |
| MLB-10 | Total bases | `Batting / Total Bases` por PA | Totais | P0 |
| MLB-11 | On-Base Percentage | `Batting / On-Base Percentage` | Todos | P0 |
| MLB-12 | Slugging Percentage | `Batting / Slugging Percentage` | Todos | P0 |
| MLB-13 | OPS | `On-Base Plus Slugging` | Todos | P0 |
| MLB-14 | Isolated Power | `Batting / Isolated Power` | Totais e run line | P0 |
| MLB-15 | BABIP ofensivo | `Batting / Balls In Play Average` | Regressão/sorte recente | P1 |
| MLB-16 | Walk-to-strikeout | `Batting / Walk-to-Strikeout Ratio` | Sustentabilidade ofensiva | P0 |
| MLB-17 | Ground/Fly ratio ofensivo | `Batting / Ground-to-Fly Ball Ratio` | Totais | P1 |
| MLB-18 | Runners left on base | `Total Runners Left On Base` por jogo | Conversão ofensiva | P1 |
| MLB-19 | Runs Created/27 | `Runs Created per 27 Outs` | Ataque global | P1 |
| MLB-20 | Starter confirmado | ID do pitcher titular (`P`, `isStarter=true`) | Todos | P0 |
| MLB-21 | ERA do starter | Earned runs por 9 innings do titular | Todos | P0 |
| MLB-22 | WHIP do starter | Walks + hits por inning do titular | Todos | P0 |
| MLB-23 | K/9 do starter | Strikeouts por 9 innings | Todos | P0 |
| MLB-24 | K/BB do starter | Strikeout-to-walk ratio | Todos | P0 |
| MLB-25 | HR/9 do starter | Home runs permitidos por 9 innings | Totais e run line | P0 |
| MLB-26 | Opponent OPS do starter | OPS permitido | Todos | P0 |
| MLB-27 | Game Score médio | `Pitching / Average Game Score` | Moneyline e run line | P1 |
| MLB-28 | Innings por start | Innings do starter / jogos iniciados | Exposição ao bullpen | P0 |
| MLB-29 | Pitch count recente | Arremessos na última saída e média recente | Fadiga | P0 |
| MLB-30 | Descanso do starter | Dias desde a última aparição | Todos | P0 |
| MLB-31 | Bullpen ERA | ERA dos relievers, excluindo starters | Todos | P0 |
| MLB-32 | Bullpen WHIP | WHIP dos relievers | Todos | P0 |
| MLB-33 | Bullpen workload | Innings/arremessos dos relievers nos últimos 3 dias | Todos | P0 |
| MLB-34 | Blown-save rate | Blown saves / save opportunities | Moneyline e run line | P1 |
| MLB-35 | Inherited runners scored | Taxa de corredores herdados que pontuam | Totais | P1 |
| MLB-36 | Fielding percentage | `Fielding / Fielding Percentage` | Todos | P1 |
| MLB-37 | Errors | Erros por jogo | Totais e run line | P0 |
| MLB-38 | Defensive WAR | `Fielding / Defensive WAR` | Moneyline | P1 |
| MLB-39 | Lineup OPS ponderado | OPS dos nove titulares ponderado por ordem | Todos | P1 |
| MLB-40 | Ausências no lineup | Diferença entre lineup confirmado e lineup-base | Todos | P1 |
| MLB-41 | Casa/fora | Indicador e splits | Todos | P0 |
| MLB-42 | Dias de descanso do time | Dias desde o último jogo | Todos | P0 |
| MLB-43 | Doubleheader | Indicador de segundo jogo no mesmo dia | Totais/fadiga | P0 |
| MLB-44 | Média da liga | Runs por equipe e vantagem de casa na temporada | Todos | P0 |
| MLB-45 | Parque/clima | Park factor, vento e temperatura | Totais | P1 externo |
| MLB-46 | Platoon handedness | Ataque vs mão do starter | Todos | P1 externo/condicional |

O bloco do starter é obrigatório para aprovar a MLB V1. Caso a lineup não esteja disponível antes do jogo, a partida deve permanecer sem recomendação ou usar um snapshot anterior explicitamente marcado como `starter_unconfirmed`.

## WNBA — Moneyline, total e spread

Fontes principais: `/basketball/matches`, `/basketball/statistics/{matchId}`, `/basketball/teams/statistics/{id}` e `/basketball/last-five-games`.

| ID | Estatística/feature | Definição operacional | Mercados | Prioridade |
|---|---|---|---|---|
| WNBA-01 | Pontos marcados | Pontos do time por jogo | Todos | P0 |
| WNBA-02 | Pontos sofridos | Pontos do adversário por jogo | Todos | P0 |
| WNBA-03 | Margem | `pontos marcados - sofridos` | Moneyline e spread | P0 |
| WNBA-04 | Win rate | Vitórias/jogos, com shrinkage | Moneyline | P0 |
| WNBA-05 | FGM | `Succesful Field Goals` | Todos | P0 |
| WNBA-06 | FGA | `Field Goals` | Todos | P0 |
| WNBA-07 | 3PM | `Succesful 3 Pointers` | Todos | P0 |
| WNBA-08 | 3PA | `3 Pointers` | Todos | P0 |
| WNBA-09 | FTM | `Succesful Free Throws` | Todos | P0 |
| WNBA-10 | FTA | `Free Throws` | Todos | P0 |
| WNBA-11 | eFG% | `(FGM + 0.5 × 3PM) / FGA` | Todos | P0 |
| WNBA-12 | TS% | `PTS / (2 × (FGA + 0.44 × FTA))` | Todos | P0 |
| WNBA-13 | 3P attempt rate | `3PA / FGA` | Totais/variância | P0 |
| WNBA-14 | Free-throw rate | `FTA / FGA` | Totais | P0 |
| WNBA-15 | Assists | `Assists` por posse | Todos | P0 |
| WNBA-16 | Turnovers | `Turnovers` por posse | Todos | P0 |
| WNBA-17 | Steals | `Steals` por posse | Moneyline/spread | P1 |
| WNBA-18 | Blocks | `Blocks` por posse | Moneyline/spread | P1 |
| WNBA-19 | Offensive rebounds | `Offensive Rebounds` | Todos | P0 |
| WNBA-20 | Defensive rebounds | `Defensive Rebounds` | Todos | P0 |
| WNBA-21 | ORB% | `OREB / (OREB + OPP_DREB)` | Todos | P0 |
| WNBA-22 | Possessions | `FGA - OREB + TOV + 0.44 × FTA` | Base de eficiência | P0 |
| WNBA-23 | Pace | Posses ajustadas pela duração do jogo | Totais | P0 |
| WNBA-24 | Offensive Rating | `100 × pontos / posses` | Todos | P0 |
| WNBA-25 | Defensive Rating | `100 × pontos sofridos / posses adversárias` | Todos | P0 |
| WNBA-26 | Net Rating | `ORtg - DRtg` | Moneyline/spread | P0 |
| WNBA-27 | Fast-break points | `Fast Break Points` por posse | Totais/spread | P1 |
| WNBA-28 | Points off turnovers | Por posse e como % dos pontos | Totais/spread | P1 |
| WNBA-29 | Points in the paint | Por posse | Todos | P1 |
| WNBA-30 | Second-chance points | Por posse | Totais/spread | P1 |
| WNBA-31 | Personal fouls | Por posse | Totais | P1 |
| WNBA-32 | Biggest lead | Mediana; somente diagnóstico, não placar final | Spread | P2 |
| WNBA-33 | Casa/fora | Indicador e splits | Todos | P0 |
| WNBA-34 | Dias de descanso | Dias desde o último jogo | Todos | P0 |
| WNBA-35 | Back-to-back | Jogo no dia seguinte | Todos | P0 |
| WNBA-36 | Jogos em 7 dias | Carga recente | Totais/spread | P0 |
| WNBA-37 | Viagem | Sequência fora/casa e mudança de cidade, se disponível | Todos | P1 externo |
| WNBA-38 | Média da liga | Pace, ORtg, pontos e vantagem de casa | Todos | P0 |
| WNBA-39 | Força/ausência de jogadoras | Minutos e impacto das jogadoras disponíveis | Todos | P1 externo |

O endpoint global de Basketball não expôs lineups ou box score individual na amostra. Portanto, WNBA V1 deve funcionar com estatísticas de equipe; lesões e disponibilidade de jogadoras ficam como enriquecimento externo P1.

## Painel de bookmakers e odd mediana

Os sete nomes comuns observados nos três esportes e recomendados como painel inicial são:

1. bet365
2. Unibet
3. Ladbrokes
4. William Hill
5. Stake.com
6. 1xBet
7. Betway

Novibet, Parimatch, Betano e Betsson permanecem como reservas. Novibet, Parimatch e Betano não apareceram na amostra MLB; por isso não podem formar um painel fixo comum aos três esportes.

Regra da mediana por `matchId + oddsType + market + selection + line`:

- aceitar apenas odds numéricas `> 1.00`;
- uma cotação mais recente por bookmaker;
- exigir no mínimo 3 bookmakers do painel;
- calcular mediana, mínimo, máximo, IQR e quantidade de casas;
- marcar `LOW_BOOKMAKER_COVERAGE` quando houver menos de 3;
- marcar `HIGH_MARKET_DISPERSION` quando o IQR ou desvio relativo exceder o limite calibrado;
- manter a odd mediana fora das features esportivas principais; usá-la para probabilidade implícita sem vig, calibração e cálculo de edge.

## Targets e mercados V1

Somente linhas terminadas em `.5` entram no primeiro contrato. Linhas inteiras e quartos asiáticos ficam fora até implementarmos push/half-win/half-loss corretamente.

- Football: 1X2, totais 0.5–9.5, BTTS, primeiro time a marcar, handicaps `.5` e totais de cantos 6.5–13.5.
- MLB: Moneyline, totais 2.5–14.5 e run lines `.5`.
- WNBA: Moneyline, totais 147.5–195.5 e spreads `.5`.

Não é necessário haver amostra abundante em cada linha para treinar: o target primário é o placar/margem observado. A cobertura de odds por linha determina apenas se haverá comparação de preço e recomendação naquele mercado.

## Dataset canônico por partida

Cada linha do dataset de modelagem deve representar uma partida em um snapshot pré-jogo:

```text
sport, league_id, season, match_id, kickoff_at, feature_cutoff_at,
home_team_id, away_team_id, home_features..., away_features...,
context_features..., lineup_status, data_quality_flags,
home_score, away_score, total_score, margin, result
```

Odds ficam em uma tabela separada, ligadas ao snapshot por `match_id` e tempo. Isso permite treinar o modelo esportivo sem leakage e avaliar preço/edge separadamente.

## Gates de qualidade antes do treino

1. Nenhum dado coletado após o kickoff pode compor features pré-jogo.
2. IDs de time, liga e partida devem estar canonicamente resolvidos.
3. Métricas acumuladas precisam ser convertidas em taxas por jogo, posse, PA ou inning.
4. Percentuais devem estar todos em escala consistente (`0–1`).
5. Features com cobertura abaixo de 80% não entram como P0.
6. Imputação deve usar média da liga/temporada e gerar indicador `was_imputed`.
7. Outliers devem ser limitados por regras esportivas e winsorização calculada somente no treino.
8. Splits e validação devem ser cronológicos, nunca aleatórios entre jogos futuros e passados.
9. A mesma partida não pode aparecer em treino e validação por snapshots diferentes.
10. Probabilidades derivadas devem ser monotônicas entre linhas e calibradas por esporte/mercado.

## Ordem recomendada de implementação

1. Coletar resultados e estatísticas históricas de partidas finalizadas.
2. Materializar features P0 com cutoff temporal, janelas 5/10/temporada e splits casa/fora.
3. Construir um baseline por esporte usando apenas P0.
4. Gerar probabilidades coerentes para todos os mercados a partir da distribuição prevista.
5. Juntar odds medianas somente na camada de precificação.
6. Executar backtest walk-forward e medir Log Loss, Brier Score, calibração, MAE do total/margem e ROI apenas com odds executáveis.
7. Adicionar P1 uma família por vez, mantendo somente o que melhorar validação fora da amostra.
