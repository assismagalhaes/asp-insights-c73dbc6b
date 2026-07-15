# Avaliação da Highlightly para o ASP Insights

Status: investigação e smoke test BASIC, baseada no OpenAPI 6.13.2 fornecido em 14/07/2026, na documentação pública e em chamadas reais realizadas na mesma data.

## Resumo executivo

A API All Sports é tecnicamente promissora para o ASP Insights: usa REST/JSON, uma única chave, paginação consistente e um prefixo por esporte. O OpenAPI contém 211 operações distribuídas por 11 prefixos esportivos. A cobertura coincide bem com os modelos atuais do projeto: futebol, basketball/WNBA, NBA, baseball/MLB, hockey/NHL e futebol americano.

Ainda não é possível aprovar a adoção. É necessário medir completude histórica, latência, estabilidade dos IDs e qualidade/variedade das odds no plano pago. A contradição documental foi resolvida empiricamente: apesar de a página comercial listar odds no BASIC, chamadas reais a `/odds` retornam HTTP 401 com pedido de upgrade.

## Resultados reais do BASIC

- Quota confirmada: 100 requisições; headers de limite e saldo funcionam.
- `/football/matches`: HTTP 200, 157 partidas em 14/07/2026 e payload completo no BASIC.
- `/basketball/matches`: HTTP 200, 29 partidas na data consultada.
- WNBA aparece com o nome não intuitivo `NBA Women`, league ID `11847`; consultar `leagueName=WNBA` retorna vazio.
- `/baseball/matches?league=MLB`: HTTP 200; foram encontradas 17 partidas em 12/07/2026.
- `/football/bookmakers`: HTTP 200; 126 bookmakers cadastrados, incluindo Pinnacle, Stake, 1xBet e 22Bet.
- Estatísticas WNBA: HTTP 200, 21 métricas por time em uma partida finalizada.
- Estatísticas MLB: HTTP 200, 171 métricas por time, nos grupos Batting, Pitching e Fielding.
- MLB lineups: HTTP 200, titulares, reservas, posições e IDs; o box score retornou 15 jogadores do Padres e 14 do Blue Jays na amostra.
- WNBA last-five e estatísticas agregadas por time: HTTP 200 e dados úteis para forma recente.
- **Falha crítica:** standings da WNBA retornou 30 posições, mas todas apontavam para `Panevezys Women` (ID 784), um time que nem pertence à WNBA. Vitórias, derrotas e pontos variavam, mostrando corrupção apenas da identidade do time.
- Futebol brasileiro: estatísticas retornaram 40 métricas por time, incluindo xG, xA, posse, finalizações, passes e cantos; lineups, 14 eventos e box score individual também retornaram HTTP 200.
- Odds em football, basketball, NBA e baseball: HTTP 401 no BASIC. As tentativas negadas também consumiram quota.
- O endpoint direto rejeitou a assinatura HTTP padrão do Python `urllib` via Cloudflare 1010; o cliente passou a enviar `User-Agent` explícito e então funcionou.
- Há diferenças de filtro entre módulos: basketball usa `leagueName`/`leagueId`; baseball usa `league`. A promessa comercial de “mesmo schema” não deve ser interpretada como contrato idêntico.

## Autenticação e contrato

- Base direta: `https://sports.highlightly.net`.
- Header: `x-rapidapi-key`. O header `x-rapidapi-host` só é necessário via RapidAPI.
- Quota observável em `x-ratelimit-requests-limit` e `x-ratelimit-requests-remaining`.
- Respostas paginadas normalmente contêm `data`, `pagination` e `plan`.
- A chave deve ficar exclusivamente em `HIGHLIGHTLY_API_KEY`, nunca no frontend, banco, logs ou Git.

## Inventário do OpenAPI

| Prefixo | Operações |
|---|---:|
| football | 25 |
| baseball | 20 |
| american-football | 19 |
| basketball | 19 |
| cricket | 19 |
| nba | 19 |
| handball | 18 |
| hockey | 18 |
| nhl | 18 |
| rugby | 18 |
| volleyball | 18 |

Recursos comuns: countries, leagues, teams, matches, highlights, bookmakers, odds, standings, last-five-games e head-to-head. Conforme o esporte, também existem lineups, statistics, players/player statistics, box scores e live events.

## Pontos relevantes para os modelos atuais

- Futebol: maior superfície (25 operações), incluindo estatísticas de time e partida, eventos ao vivo, escalações, jogadores e box score.
- WNBA: está em `/basketball`, identificada como `NBA Women`/ID `11847`; `/nba` é o módulo NBA/NCAAB. IDs e nomes precisam de tabela canônica própria.
- MLB: `/baseball` oferece partidas, odds, escalações, estatísticas, box scores e estatísticas de jogadores.
- Odds: prematch e live, filtráveis por partida, data, liga e bookmaker. A documentação informa retenção de até 28 dias depois da partida e janela de até 7 dias antes; isso é insuficiente como histórico permanente, então a coleta própria é obrigatória.
- Frequência declarada: odds prematch várias vezes por dia e live a cada 10 minutos. Essa frequência pode ser baixa para decisões intrajogo e precisa de medição.

## Planos publicados em 14/07/2026

| Plano | USD/mês | Requisições/dia | Requisições/s |
|---|---:|---:|---:|
| BASIC | 0 | 100 | sem limite publicado |
| PRO | 12,49 | 7.500 | 12 |
| ULTRA | 25,99 | 25.000 | 20 |
| MEGA | 57,99 | 75.000 | 100 |

Os preços e limites precisam ser reconfirmados no checkout. A Highlightly afirma que a quota é compartilhada entre todos os esportes e que contas Highlightly/RapidAPI não são sincronizadas.

## Riscos e critérios de aprovação

1. Cobertura: presença e completude de WNBA, MLB e ligas de futebol usadas pelo ASP.
2. Odds: bookmakers relevantes ao Brasil, mercados suportados, timestamps, live vs prematch e ausência de linhas pareadas.
3. Histórico: profundidade real por endpoint e necessidade de armazenar snapshots próprios.
4. Qualidade: IDs estáveis, duplicatas, atrasos, partidas adiadas/canceladas e correções retroativas.
5. Operação: erros 4xx/5xx, latência p50/p95, quota, retry/backoff e observabilidade.
6. Jurídico: os termos entregam dados “as is” e atribuem ao cliente a responsabilidade por licenças de publicação, logos e imagens.
7. Corrupção silenciosa: um HTTP 200 não significa dado confiável. O caso real de standings WNBA exige validadores semânticos antes da persistência/uso por modelos.

## Protocolo de teste

O probe inicial consome 4 requisições para partidas ou 8 incluindo odds. Respostas 401 de odds também reduzem a quota:

```powershell
$env:HIGHLIGHTLY_API_KEY='<chave-configurada-localmente>'
python scripts/highlightly_probe.py --include-odds --output outputs/highlightly/probe.json
```

Depois do smoke test, executar uma matriz por esporte/liga/data, armazenando apenas respostas redigidas e métricas: status, tamanho, `plan.tier`, paginação, quota restante, latência, campos nulos e timestamp de atualização.

## Decisão provisória

Prosseguir com prova de conceito, mas não substituir scrapers/fontes atuais. O próximo gate é um teste real BASIC e, em seguida, uma janela paga curta no PRO. PRO parece suficiente para avaliação; ULTRA/MEGA só devem ser considerados após estimar chamadas por partida, frequência de polling e número de ligas.

## Arquitetura recomendada para a POC

1. Coletor server-side lê `HIGHLIGHTLY_API_KEY`; nunca chamar a Highlightly pelo navegador.
2. Descobrir partidas por esporte/data e persistir o ID externo junto do ID canônico do ASP.
3. Coletar estatísticas e odds por `matchId`, preservando o JSON bruto e o timestamp da coleta.
4. Normalizar odds para o contrato atual (`data`, `hora`, `esporte`, `liga`, `mandante`, `visitante`, `mercado`, `pick`, `linha`, `odd`, `bookmaker`, `fonte`, `raw_ref`).
5. Deduplicar snapshots por `provider + matchId + bookmakerId + oddsType + market + selection + collected_at`.
6. Executar guardrails de qualidade antes da persistência; payloads críticos devem ir para quarentena.
7. Manter Highlightly em modo shadow até comparar cobertura, atraso e valores com a fonte atual.

O adapter inicial está em `api/highlightly_adapter.py`. Como odds não estão acessíveis no BASIC, ele foi validado contra o schema OpenAPI e fixtures sintéticas; precisa ser reconfirmado com payload pago real. O primeiro guardrail está em `api/highlightly_quality.py` e detecta standings com uma única identidade repetida.

## Matriz de cobertura observada

| Recurso | Football | WNBA (`basketball`) | MLB (`baseball`) | Avaliação |
|---|---|---|---|---|
| Matches | 200 | 200 | 200 | útil |
| Team statistics | não testado | 200 | n/a | útil |
| Match statistics | 200 | 200 | 200 | muito útil |
| Last five | não testado | 200 | 200 | útil |
| Lineups | 200 | n/a no módulo | 200 | útil |
| Box score | 200 | n/a no módulo global | 200 | muito útil |
| Live/match events | 200 | não oferecido | não oferecido | útil |
| Standings | não testado | 200, conteúdo corrompido | endpoint disponível | não confiar sem QA |
| Bookmakers | 200 | endpoint disponível | endpoint disponível | catálogo apenas |
| Odds | 401 BASIC | 401 BASIC | 401 BASIC | requer PRO |

## Orçamento preliminar de chamadas

Um polling ingênuo por esporte/data, sem paginação extra:

| Frequência | Chamadas por endpoint/esporte/dia |
|---|---:|
| a cada 10 minutos, 24h | 144 |
| a cada 5 minutos, 24h | 288 |
| a cada 10 minutos, janela de 12h | 72 |

Exemplo de POC com football, basketball/WNBA e baseball/MLB, consultando partidas e odds a cada 10 minutos durante 12 horas: aproximadamente `3 × 2 × 72 = 432` chamadas/dia, antes de estatísticas, paginação e retries. O PRO (7.500/dia) comporta confortavelmente uma POC; o BASIC (100/dia) não comporta coleta contínua e não fornece odds.

Para produção, o volume deve ser calculado por endpoint e não apenas por partida: consultas por data podem trazer várias partidas numa chamada, mas o limite máximo de página e filtros variam por módulo. Aplicar cache de matches/leagues/teams, backoff em 429/5xx e interromper polling de partidas finalizadas.

## Gate de compra recomendado

Comprar inicialmente apenas um mês de PRO na plataforma onde a chave atual foi criada. Antes da compra, confirmar no checkout que o produto é **All Sports API**, não uma API individual. Após o upgrade, executar durante 7 dias:

- amostragem de odds prematch e live para WNBA, MLB e pelo menos duas ligas de futebol;
- inventário de mercados e bookmakers por esporte;
- comparação de odds e horários contra a fonte atual;
- taxa de partidas sem odds, mercados incompletos e linhas sem par;
- latência e erros p50/p95, correções retroativas e estabilidade dos IDs;
- custo projetado nos cenários de 5, 10 e 15 minutos de polling.

Critério mínimo sugerido para adoção: cobertura ≥95% das partidas-alvo, ≥90% com os mercados essenciais, IDs estáveis, atraso compatível com o uso do ASP e nenhuma divergência estrutural não tratada pelo adapter. Até esse gate, Highlightly deve permanecer como fonte complementar/shadow.

## Fontes

- https://highlightly.net/sport-api/
- https://highlightly.net/sport-api/documentation/
- https://highlightly.net/football-api/documentation/
- https://highlightly.net/basketball-api/documentation/
- https://highlightly.net/terms/
