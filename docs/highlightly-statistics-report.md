# Catálogo completo de estatísticas da Highlightly

Gerado a partir do OpenAPI All Sports 6.13.2 e das respostas reais BASIC coletadas em 14/07/2026.

## Resumo técnico

- 73 endpoints relacionados a estatísticas, jogadores, escalações, eventos, standings e box scores.
- 1200 campos/métricas distintos após deduplicação por esporte, categoria e caminho.
- Campos `displayName/value` são extensíveis: a lista observada pode crescer conforme liga, esporte e fornecedor upstream.
- HTTP 200 não garante qualidade: standings WNBA retornou identidades de time corrompidas no teste real.

## Definições e escopo

`Documentado` significa presente no contrato OpenAPI. `Observado` significa que o nome da métrica apareceu em uma resposta real da conta BASIC. Estatísticas de odds não estão incluídas porque o BASIC bloqueia `/odds`; mercados e valores precisam ser inventariados após upgrade.

## Endpoints estatísticos

| Grupo | Endpoint | Função | Evidência BASIC |
|---|---|---|---|
| American Football.Lineups | `/american-football/lineups/{matchId}` | Get linups by match id | documentado |
| American Football.Match Box Score | `/american-football/box-score/{matchId}` | Retrieve player box scores for specified match id | documentado |
| American Football.Players | `/american-football/players` | Get all players | documentado |
| American Football.Players | `/american-football/players/{id}` | Get player summary by player id | documentado |
| American Football.Players | `/american-football/players/{id}/statistics` | Get player statistics by player id | documentado |
| American Football.Standings | `/american-football/standings` | Get standings | documentado |
| American Football.Teams | `/american-football/teams` | Get all teams | documentado |
| American Football.Teams | `/american-football/teams/statistics/{id}` | Get team statistics | documentado |
| American Football.Teams | `/american-football/teams/{id}` | Get team by team id | documentado |
| Baseball.Lineups | `/baseball/lineups/{matchId}` | Get linups by match id | confirmado |
| Baseball.Match Box Score | `/baseball/box-scores/{id}` | Retrieve player box score for specified match id | confirmado |
| Baseball.Players | `/baseball/players` | Get all players | documentado |
| Baseball.Players | `/baseball/players/{id}` | Get player summary by player id | documentado |
| Baseball.Players | `/baseball/players/{id}/statistics` | Get player statistics by player id | documentado |
| Baseball.Standings | `/baseball/standings` | Get standings | documentado |
| Baseball.Statistics | `/baseball/statistics/{id}` | Returns detailed match statistics for given id | confirmado |
| Baseball.Teams | `/baseball/teams` | Get all teams | documentado |
| Baseball.Teams | `/baseball/teams/statistics/{id}` | Get team statistics | documentado |
| Baseball.Teams | `/baseball/teams/{id}` | Get team by team id | documentado |
| Basketball.Standings | `/basketball/standings` | Get standings | confirmado |
| Basketball.Statistics | `/basketball/statistics/{matchId}` | Get match statistics by match id | confirmado |
| Basketball.Teams | `/basketball/teams` | Get all teams | documentado |
| Basketball.Teams | `/basketball/teams/statistics/{id}` | Get team statistics | confirmado |
| Basketball.Teams | `/basketball/teams/{id}` | Get team by team id | documentado |
| Cricket.Players | `/cricket/players` | Get all players | documentado |
| Cricket.Players | `/cricket/players/{id}` | Get player summary by player id | documentado |
| Cricket.Standings | `/cricket/standings` | Get standings | documentado |
| Cricket.Teams | `/cricket/teams` | Get all teams | documentado |
| Cricket.Teams | `/cricket/teams/{id}` | Get team by team id | documentado |
| Football.Lineups | `/football/lineups/{matchId}` | Get linups by match id | confirmado |
| Football.Live Events | `/football/events/{id}` | Get live events by match id | confirmado |
| Football.Match Box Score | `/football/box-score/{matchId}` | Retrieve box scores for specified match id. | confirmado |
| Football.Players | `/football/players` | Get all players | documentado |
| Football.Players | `/football/players/{id}` | Get player summary by player id | documentado |
| Football.Players | `/football/players/{id}/statistics` | Get player statistics by player id | documentado |
| Football.Standings | `/football/standings` | Get standings | documentado |
| Football.Statistics | `/football/statistics/{matchId}` | Get match statistics by match id | confirmado |
| Football.Teams | `/football/teams` | Get all teams | documentado |
| Football.Teams | `/football/teams/statistics/{id}` | Get team statistics | documentado |
| Football.Teams | `/football/teams/{id}` | Get team by team id | documentado |
| Handball.Standings | `/handball/standings` | Get standings | documentado |
| Handball.Teams | `/handball/teams` | Get all teams | documentado |
| Handball.Teams | `/handball/teams/statistics/{id}` | Get team statistics | documentado |
| Handball.Teams | `/handball/teams/{id}` | Get team by team id | documentado |
| Hockey.Standings | `/hockey/standings` | Get standings | documentado |
| Hockey.Teams | `/hockey/teams` | Get all teams | documentado |
| Hockey.Teams | `/hockey/teams/statistics/{id}` | Get team statistics | documentado |
| Hockey.Teams | `/hockey/teams/{id}` | Get team by team id | documentado |
| NBA, NCAAB.Lineups | `/nba/lineups/{matchId}` | Get linups by match id | documentado |
| NBA, NCAAB.Match Box Score | `/nba/box-score/{matchId}` | Retrieve box scores for specified match id | documentado |
| NBA, NCAAB.Players | `/nba/players` | Get all players | documentado |
| NBA, NCAAB.Players | `/nba/players/{id}` | Get player summary by player id | documentado |
| NBA, NCAAB.Players | `/nba/players/{id}/statistics` | Get player statistics by player id | documentado |
| NBA, NCAAB.Standings | `/nba/standings` | Get standings | documentado |
| NBA, NCAAB.Teams | `/nba/teams` | Get all teams | documentado |
| NBA, NCAAB.Teams | `/nba/teams/statistics/{id}` | Get team statistics | documentado |
| NBA, NCAAB.Teams | `/nba/teams/{id}` | Get team by team id | documentado |
| NHL, NCAAH.Lineups | `/nhl/lineups/{matchId}` | Get linups by match id | documentado |
| NHL, NCAAH.Players | `/nhl/players` | Get all players | documentado |
| NHL, NCAAH.Players | `/nhl/players/{id}` | Get player summary by player id | documentado |
| NHL, NCAAH.Players | `/nhl/players/{id}/statistics` | Get player statistics by player id | documentado |
| NHL, NCAAH.Standings | `/nhl/standings` | Get standings | documentado |
| NHL, NCAAH.Teams | `/nhl/teams` | Get all teams | documentado |
| NHL, NCAAH.Teams | `/nhl/teams/statistics/{id}` | Get team statistics | documentado |
| NHL, NCAAH.Teams | `/nhl/teams/{id}` | Get team by team id | documentado |
| Rugby.Standings | `/rugby/standings` | Get standings | documentado |
| Rugby.Teams | `/rugby/teams` | Get all teams | documentado |
| Rugby.Teams | `/rugby/teams/statistics/{id}` | Get team statistics | documentado |
| Rugby.Teams | `/rugby/teams/{id}` | Get team by team id | documentado |
| Volleyball.Standings | `/volleyball/standings` | Get standings | documentado |
| Volleyball.Teams | `/volleyball/teams` | Get all teams | documentado |
| Volleyball.Teams | `/volleyball/teams/statistics/{id}` | Get team statistics | documentado |
| Volleyball.Teams | `/volleyball/teams/{id}` | Get team by team id | documentado |

## American Football (NFL/NCAA)

### Box score / desempenho por jogador

12 campos/métricas:

- `boxScores.player.jersey` (number; documentado)
- `boxScores.statistics.group` (string; documentado)
- `boxScores.statistics.value` (number; documentado)
- `group` (string; documentado)
- `jersey` (number; documentado)
- `player.jersey` (number; documentado)
- `statistics.group` (string; documentado)
- `statistics.value` (number; documentado)
- `team.boxScores.player.jersey` (number; documentado)
- `team.boxScores.statistics.group` (string; documentado)
- `team.boxScores.statistics.value` (number; documentado)
- `value` (number; documentado)

### Escalações

15 campos/métricas:

- `away.lineup.isStarter` (boolean; documentado)
- `away.lineup.jersey` (number; documentado)
- `away.lineup.positionAbbreviation` (string; documentado)
- `away.team.abbreviation` (string; documentado)
- `home.lineup.isStarter` (boolean; documentado)
- `home.lineup.jersey` (number; documentado)
- `home.lineup.positionAbbreviation` (string; documentado)
- `home.team.abbreviation` (string; documentado)
- `isStarter` (boolean; documentado)
- `jersey` (number; documentado)
- `lineup.isStarter` (boolean; documentado)
- `lineup.jersey` (number; documentado)
- `lineup.positionAbbreviation` (string; documentado)
- `positionAbbreviation` (string; documentado)
- `team.abbreviation` (string; documentado)

### Estatísticas de equipe

5 campos/métricas:

- `away` (object; documentado) — Game and point statistics corresponding to specific league round, where the team has played as an away team.
- `home` (object; documentado) — Game and point statistics corresponding to specific league round, where the team has played as a home team.
- `leagueName` (string; documentado) — League name to which team statistics are associated.
- `round` (string; documentado) — Round to which team statistics are associated.
- `total` (object; documentado) — Total game and points statistics corresponding to specific league round.

### Eventos

13 campos/métricas:

- `clock` (string; documentado)
- `description` (string; documentado)
- `end.clock` (string; documentado)
- `end.period` (string; documentado)
- `end.yardLine` (number; documentado)
- `isScoringPlay` (boolean; documentado)
- `period` (string; documentado)
- `result` (string; documentado)
- `start.clock` (string; documentado)
- `start.period` (string; documentado)
- `start.yardLine` (number; documentado)
- `team.abbreviation` (string; documentado)
- `yardLine` (number; documentado)

### Jogadores / estatísticas de temporada

42 campos/métricas:

- `abbreviation` (string; documentado)
- `birthDate` (string; documentado) — DD.MM.YYYY format
- `birthPlace` (string; documentado)
- `draft.pick` (number; documentado)
- `draft.round` (number; documentado)
- `draft.year` (number; documentado)
- `height` (string; documentado)
- `isActive` (boolean; documentado)
- `jersey` (number; documentado)
- `main` (string; documentado)
- `pagination.limit` (number; documentado)
- `pagination.offset` (number; documentado)
- `pagination.totalCount` (number; documentado) — Available number of items, relevant to the provided query.
- `perSeason.seasonBreakdown` (string; documentado) — Represents the coverage for the stored statistics. Pre-season is never included.
- `perSeason.stats.category` (string; documentado)
- `perSeason.stats.value` (number; documentado)
- `perSeason.teams.abbreviation` (string; documentado)
- `pick` (number; documentado)
- `plan.message` (string; documentado) — Explanation message regarding your current tier.
- `plan.tier` (string; documentado) — Your current API subscription tier.
- `position.abbreviation` (string; documentado)
- `position.main` (string; documentado)
- `profile.birthDate` (string; documentado) — DD.MM.YYYY format
- `profile.birthPlace` (string; documentado)
- `profile.draft.pick` (number; documentado)
- `profile.draft.round` (number; documentado)
- `profile.draft.year` (number; documentado)
- `profile.height` (string; documentado)
- `profile.isActive` (boolean; documentado)
- `profile.jersey` (string; documentado)
- `profile.position.abbreviation` (string; documentado)
- `profile.position.main` (string; documentado)
- `profile.team.abbreviation` (string; documentado)
- `profile.weight` (string; documentado)
- `round` (number; documentado)
- `seasonBreakdown` (string; documentado) — Represents the coverage for the stored statistics. Pre-season is never included.
- `stats.category` (string; documentado)
- `stats.value` (number; documentado)
- `team.abbreviation` (string; documentado)
- `teams.abbreviation` (string; documentado)
- `weight` (string; documentado)
- `year` (number; documentado)

### Standings / campanha

9 campos/métricas:

- `abbreviation` (string; documentado)
- `data.statistics.value` (string; documentado)
- `data.team.abbreviation` (string; documentado)
- `endDate` (string; documentado)
- `leagueName` (string; documentado)
- `leagueType` (string; documentado)
- `seasonType` (string; documentado)
- `startDate` (string; documentado)
- `year` (number; documentado)


## Baseball (MLB/NCAA)

### Box score / desempenho por jogador

6 campos/métricas:

- `boxScores.statistics.group` (string; documentado)
- `boxScores.statistics.value` (number; documentado)
- `group` (string; documentado)
- `statistics.group` (string; documentado)
- `statistics.value` (number; documentado)
- `value` (number; documentado)

### Escalações

15 campos/métricas:

- `away.lineup.isStarter` (boolean; documentado)
- `away.lineup.jersey` (number; documentado)
- `away.lineup.positionAbbreviation` (string; documentado)
- `away.team.abbreviation` (string; documentado)
- `home.lineup.isStarter` (boolean; documentado)
- `home.lineup.jersey` (number; documentado)
- `home.lineup.positionAbbreviation` (string; documentado)
- `home.team.abbreviation` (string; documentado)
- `isStarter` (boolean; documentado)
- `jersey` (number; documentado)
- `lineup.isStarter` (boolean; documentado)
- `lineup.jersey` (number; documentado)
- `lineup.positionAbbreviation` (string; documentado)
- `positionAbbreviation` (string; documentado)
- `team.abbreviation` (string; documentado)

### Estatísticas de equipe

7 campos/métricas:

- `away` (object; documentado) — Game and point statistics corresponding to specific league round, where the team has played as an away team.
- `home` (object; documentado) — Game and point statistics corresponding to specific league round, where the team has played as a home team.
- `leagueName` (string; documentado) — League name to which team statistics are associated.
- `round` (string; documentado) — Round to which team statistics are associated.
- `statistics.group` (string; documentado)
- `statistics.value` (number; documentado)
- `total` (object; documentado) — Total game and points statistics corresponding to specific league round.

### Estatísticas de partida

173 campos/métricas:

- `Batting / At-Bats per Home Run` (number; observado) — Métrica observada em resposta real.
- `Batting / Balls In Play Average` (number; observado) — Métrica observada em resposta real.
- `Batting / Batter Rating` (number; observado) — Métrica observada em resposta real.
- `Batting / Batting Average` (number; observado) — Métrica observada em resposta real.
- `Batting / Catcher Interference` (number; observado) — Métrica observada em resposta real.
- `Batting / Game-Winning RBIs` (number; observado) — Métrica observada em resposta real.
- `Batting / Games Started` (number; observado) — Métrica observada em resposta real.
- `Batting / Ground-to-Fly Ball Ratio` (number; observado) — Métrica observada em resposta real.
- `Batting / Isolated Power` (number; observado) — Métrica observada em resposta real.
- `Batting / MLB Rating` (number; observado) — Métrica observada em resposta real.
- `Batting / Offensive WAR` (number; observado) — Métrica observada em resposta real.
- `Batting / On-Base Percentage` (number; observado) — Métrica observada em resposta real.
- `Batting / On-Base Plus Slugging` (number; observado) — Métrica observada em resposta real.
- `Batting / Patience Ratio` (number; observado) — Métrica observada em resposta real.
- `Batting / Pinch-Hit Batting Average` (number; observado) — Métrica observada em resposta real.
- `Batting / Pitches per Plate Appearance` (number; observado) — Métrica observada em resposta real.
- `Batting / Player Rating` (number; observado) — Métrica observada em resposta real.
- `Batting / Projected Home Runs` (number; observado) — Métrica observada em resposta real.
- `Batting / Qualified` (number; observado) — Métrica observada em resposta real.
- `Batting / Qualified in Stolen Bases` (number; observado) — Métrica observada em resposta real.
- `Batting / Runs Created` (number; observado) — Métrica observada em resposta real.
- `Batting / Runs Created per 27 Outs` (number; observado) — Métrica observada em resposta real.
- `Batting / Runs Produced` (number; observado) — Métrica observada em resposta real.
- `Batting / Runs Ratio` (number; observado) — Métrica observada em resposta real.
- `Batting / Secondary Average` (number; observado) — Métrica observada em resposta real.
- `Batting / Secondary Avg Minus Batting Avg` (number; observado) — Métrica observada em resposta real.
- `Batting / Slugging Percentage` (number; observado) — Métrica observada em resposta real.
- `Batting / Stolen Base Percentage` (number; observado) — Métrica observada em resposta real.
- `Batting / Team Games Played` (number; observado) — Métrica observada em resposta real.
- `Batting / Total At Bats` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Bases` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Caught Stealing` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Doubles` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Extra Base Hits` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Fly Balls` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Games Played` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Grand Slams` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Ground Balls` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Grounded Into Double Plays` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Hit By Pitch` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Hits` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Home Runs` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Intentional Walks` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Pinch At Bats` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Pinch Hits` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Pitches` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Plate Appearances` (number; observado) — Métrica observada em resposta real.
- `Batting / Total RBIs` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Runners Left On Base` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Runs` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Sacrifice Flies` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Sacrifice Hits` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Stolen Bases` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Strikeouts` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Triples` (number; observado) — Métrica observada em resposta real.
- `Batting / Total WAR` (number; observado) — Métrica observada em resposta real.
- `Batting / Total Walks` (number; observado) — Métrica observada em resposta real.
- `Batting / Walk-to-Strikeout Ratio` (number; observado) — Métrica observada em resposta real.
- `Batting / Walks per Plate Appearance` (number; observado) — Métrica observada em resposta real.
- `Fielding / Balls in the Strike Zone` (number; observado) — Métrica observada em resposta real.
- `Fielding / Catcher ERA` (number; observado) — Métrica observada em resposta real.
- `Fielding / Catcher Earned Runs` (number; observado) — Métrica observada em resposta real.
- `Fielding / Catcher Third Innings Played` (number; observado) — Métrica observada em resposta real.
- `Fielding / Caught Stealing Percentage` (number; observado) — Métrica observada em resposta real.
- `Fielding / Defensive WAR` (number; observado) — Métrica observada em resposta real.
- `Fielding / Extra Bases` (number; observado) — Métrica observada em resposta real.
- `Fielding / Fielding Percentage` (number; observado) — Métrica observada em resposta real.
- `Fielding / Full Innings Played` (number; observado) — Métrica observada em resposta real.
- `Fielding / Games Started` (number; observado) — Métrica observada em resposta real.
- `Fielding / Partial Innings Played` (number; observado) — Métrica observada em resposta real.
- `Fielding / Qualified` (number; observado) — Métrica observada em resposta real.
- `Fielding / Qualified Catcher` (number; observado) — Métrica observada em resposta real.
- `Fielding / Qualified Pitcher` (number; observado) — Métrica observada em resposta real.
- `Fielding / Range Factor` (number; observado) — Métrica observada em resposta real.
- `Fielding / Runners Caught Stealing` (number; observado) — Métrica observada em resposta real.
- `Fielding / Stolen Bases Allowed` (number; observado) — Métrica observada em resposta real.
- `Fielding / Successful Chances` (number; observado) — Métrica observada em resposta real.
- `Fielding / Team Games Played` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Assists` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Bases` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Chances` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Double Plays` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Errors` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Games Played` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Hits` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Opportunities` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Outfield Assists` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Outs Made` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Outs on Field` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Passed Balls` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Pickoffs` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Putouts` (number; observado) — Métrica observada em resposta real.
- `Fielding / Total Triple Plays` (number; observado) — Métrica observada em resposta real.
- `Fielding / Zone Rating` (number; observado) — Métrica observada em resposta real.
- `Pitching / Average Game Score` (number; observado) — Métrica observada em resposta real.
- `Pitching / Balls In Play Average` (number; observado) — Métrica observada em resposta real.
- `Pitching / Catcher Interference` (number; observado) — Métrica observada em resposta real.
- `Pitching / Caught Stealing Percentage` (number; observado) — Métrica observada em resposta real.
- `Pitching / Cheap Wins` (number; observado) — Métrica observada em resposta real.
- `Pitching / Earned Run Average` (number; observado) — Métrica observada em resposta real.
- `Pitching / Full Innings` (number; observado) — Métrica observada em resposta real.
- `Pitching / Games Started` (number; observado) — Métrica observada em resposta real.
- `Pitching / Ground-to-Fly Ball Ratio` (number; observado) — Métrica observada em resposta real.
- `Pitching / Inherited Runners` (number; observado) — Métrica observada em resposta real.
- `Pitching / Inherited Runners Scored` (number; observado) — Métrica observada em resposta real.
- `Pitching / Innings Pitched` (number; observado) — Métrica observada em resposta real.
- `Pitching / Opponent Batting Average` (number; observado) — Métrica observada em resposta real.
- `Pitching / Opponent OPS` (number; observado) — Métrica observada em resposta real.
- `Pitching / Opponent On-Base Percentage` (number; observado) — Métrica observada em resposta real.
- `Pitching / Opponent Slugging Percentage` (number; observado) — Métrica observada em resposta real.
- `Pitching / Opponent Total Bases` (number; observado) — Métrica observada em resposta real.
- `Pitching / Partial Innings` (number; observado) — Métrica observada em resposta real.
- `Pitching / Pitch Count` (number; observado) — Métrica observada em resposta real.
- `Pitching / Pitches per Inning` (number; observado) — Métrica observada em resposta real.
- `Pitching / Pitches per Plate Appearance` (number; observado) — Métrica observada em resposta real.
- `Pitching / Pitches per Start` (number; observado) — Métrica observada em resposta real.
- `Pitching / Player Rating` (number; observado) — Métrica observada em resposta real.
- `Pitching / Qualified` (number; observado) — Métrica observada em resposta real.
- `Pitching / Qualified in Saves` (number; observado) — Métrica observada em resposta real.
- `Pitching / Quality Starts` (number; observado) — Métrica observada em resposta real.
- `Pitching / Run Support Average` (number; observado) — Métrica observada em resposta real.
- `Pitching / Save Opportunities per Win` (number; observado) — Métrica observada em resposta real.
- `Pitching / Save Percentage` (number; observado) — Métrica observada em resposta real.
- `Pitching / Strike-to-Pitch Ratio` (number; observado) — Métrica observada em resposta real.
- `Pitching / Strikeout-to-Walk Ratio` (number; observado) — Métrica observada em resposta real.
- `Pitching / Strikeouts per 9 Innings` (number; observado) — Métrica observada em resposta real.
- `Pitching / Team Earned Runs` (number; observado) — Métrica observada em resposta real.
- `Pitching / Team Games Played` (number; observado) — Métrica observada em resposta real.
- `Pitching / Third Innings Pitched` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total At Bats` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Balks` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Bases` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Batters Faced` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Batters Hit` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Blown Saves` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Caught Stealing` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Complete Games` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Doubles` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Earned Runs` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Finishes` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Fly Balls` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Games Played` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Ground Balls` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Hits` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Holds` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Home Runs` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Intentional Walks` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Losses` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Perfect Games` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Pickoff Attempts` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Pitches` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Pitches as Starter` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total RBIs` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Run Support` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Runs` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Sacrifice Bunts` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Sacrifice Flies` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Save Opportunities` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Saves` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Shutouts` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Stolen Bases` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Strikeouts` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Strikes` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Triples` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total WAR` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Walks` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Wild Pitches` (number; observado) — Métrica observada em resposta real.
- `Pitching / Total Wins` (number; observado) — Métrica observada em resposta real.
- `Pitching / Tough Losses` (number; observado) — Métrica observada em resposta real.
- `Pitching / Walks plus Hits per Inning` (number; observado) — Métrica observada em resposta real.
- `Pitching / Winning Percentage` (number; observado) — Métrica observada em resposta real.
- `team.statistics.group` (string; documentado)
- `team.statistics.value` (number; documentado)

### Jogadores / estatísticas de temporada

35 campos/métricas:

- `abbreviation` (string; documentado)
- `birthDate` (string; documentado) — DD.MM.YYYY format
- `birthPlace` (string; documentado)
- `debut` (number; documentado) — Player debut year
- `height` (string; documentado)
- `isActive` (boolean; documentado)
- `jersey` (string; documentado)
- `main` (string; documentado)
- `pagination.limit` (number; documentado)
- `pagination.offset` (number; documentado)
- `pagination.totalCount` (number; documentado) — Available number of items, relevant to the provided query.
- `perSeason.seasonBreakdown` (string; documentado) — Represents the coverage for the stored statistics. Pre-season is never included.
- `perSeason.stats.category` (string; documentado)
- `perSeason.stats.value` (number; documentado)
- `perSeason.teams.abbreviation` (string; documentado)
- `plan.message` (string; documentado) — Explanation message regarding your current tier.
- `plan.tier` (string; documentado) — Your current API subscription tier.
- `position.abbreviation` (string; documentado)
- `position.main` (string; documentado)
- `profile.birthDate` (string; documentado) — DD.MM.YYYY format
- `profile.birthPlace` (string; documentado)
- `profile.debut` (number; documentado) — Player debut year
- `profile.height` (string; documentado)
- `profile.isActive` (boolean; documentado)
- `profile.jersey` (string; documentado)
- `profile.position.abbreviation` (string; documentado)
- `profile.position.main` (string; documentado)
- `profile.team.abbreviation` (string; documentado)
- `profile.weight` (string; documentado)
- `seasonBreakdown` (string; documentado) — Represents the coverage for the stored statistics. Pre-season is never included.
- `stats.category` (string; documentado)
- `stats.value` (number; documentado)
- `team.abbreviation` (string; documentado)
- `teams.abbreviation` (string; documentado)
- `weight` (string; documentado)

### Standings / campanha

27 campos/métricas:

- `abbreviation` (string; documentado)
- `data.abbreviation` (string; documentado)
- `data.endDate` (string; documentado)
- `data.leagueName` (string; documentado)
- `data.leagueType` (string; documentado)
- `data.seasonType` (string; documentado)
- `data.startDate` (string; documentado)
- `data.stats.abbreviation` (string; documentado)
- `data.stats.description` (string; documentado)
- `data.stats.displayValue` (string; documentado)
- `data.year` (number; documentado)
- `description` (string; documentado)
- `displayValue` (string; documentado)
- `endDate` (string; documentado)
- `leagueName` (string; documentado)
- `leagueType` (string; documentado)
- `pagination.limit` (number; documentado)
- `pagination.offset` (number; documentado)
- `pagination.totalCount` (number; documentado) — Available number of items, relevant to the provided query.
- `plan.message` (string; documentado) — Explanation message regarding your current tier.
- `plan.tier` (string; documentado) — Your current API subscription tier.
- `seasonType` (string; documentado)
- `startDate` (string; documentado)
- `stats.abbreviation` (string; documentado)
- `stats.description` (string; documentado)
- `stats.displayValue` (string; documentado)
- `year` (number; documentado)


## Basketball global (inclui WNBA)

### Estatísticas de equipe

6 campos/métricas:

- `away` (object; documentado) — Game and point statistics corresponding to specific league-season, where the team has played as an away team.
- `home` (object; documentado) — Game and point statistics corresponding to specific league-season, where the team has played as a home team.
- `leagueId` (number; documentado) — League id to which team statistics are associated.
- `leagueName` (string; documentado) — League name to which team statistics are associated.
- `season` (number; documentado) — Season year to which team statistics are associated.
- `total` (object; documentado) — Total game and points statistics corresponding to specific league-season.

### Estatísticas de partida

23 campos/métricas:

- `3 Pointers` (number; observado) — Métrica observada em resposta real.
- `Assists` (number; observado) — Métrica observada em resposta real.
- `Biggest Lead` (number; observado) — Métrica observada em resposta real.
- `Blocks` (number; observado) — Métrica observada em resposta real.
- `Defensive Rebounds` (number; observado) — Métrica observada em resposta real.
- `Fast Break Points` (number; observado) — Métrica observada em resposta real.
- `Field Goals` (number; observado) — Métrica observada em resposta real.
- `Flagrant Fouls` (number; observado) — Métrica observada em resposta real.
- `Free Throws` (number; observado) — Métrica observada em resposta real.
- `Offensive Rebounds` (number; observado) — Métrica observada em resposta real.
- `Personal Fouls` (number; observado) — Métrica observada em resposta real.
- `Points In The Paint` (number; observado) — Métrica observada em resposta real.
- `Points Off Turnovers` (number; observado) — Métrica observada em resposta real.
- `Rebounds` (number; observado) — Métrica observada em resposta real.
- `Second Chance Points` (number; observado) — Métrica observada em resposta real.
- `Steals` (number; observado) — Métrica observada em resposta real.
- `Succesful 3 Pointers` (number; observado) — Métrica observada em resposta real.
- `Succesful Field Goals` (number; observado) — Métrica observada em resposta real.
- `Succesful Free Throws` (number; observado) — Métrica observada em resposta real.
- `Technical Fouls` (number; observado) — Métrica observada em resposta real.
- `Turnovers` (number; observado) — Métrica observada em resposta real.
- `statistics.value` (number; documentado)
- `value` (number; documentado)

### Standings / campanha

15 campos/métricas:

- `gamesPlayed` (number; documentado)
- `groups.standings.gamesPlayed` (number; documentado)
- `groups.standings.loses` (number; documentado)
- `groups.standings.receivedPoints` (number; documentado)
- `groups.standings.scoredPoints` (number; documentado)
- `groups.standings.wins` (number; documentado)
- `loses` (number; documentado)
- `receivedPoints` (number; documentado)
- `scoredPoints` (number; documentado)
- `standings.gamesPlayed` (number; documentado)
- `standings.loses` (number; documentado)
- `standings.receivedPoints` (number; documentado)
- `standings.scoredPoints` (number; documentado)
- `standings.wins` (number; documentado)
- `wins` (number; documentado)


## Cricket

### Estatísticas de partida

51 campos/métricas:

- `abbreviation` (string; documentado) — Cricket team abbreviation
- `byes` (number; documentado) — Byes conceded
- `extras` (number; documentado) — Total extras in the innings
- `fallOfWickets.dismissalBatsman.name` (string; documentado) — Name of Dismissal Batsman
- `fallOfWickets.order` (number; documentado) — Current order number
- `fallOfWickets.overs` (number; documentado) — Number of overs
- `fallOfWickets.runs` (number; documentado) — Number of runs
- `fieldingSummary.catches` (number; documentado) — Catches taken by fielding team
- `fieldingSummary.catchesDropped` (number; documentado) — Catches dropped by fielding team
- `fieldingSummary.runOuts` (number; documentado) — Run outs effected
- `fieldingSummary.runsSaved` (number; documentado) — Runs saved by fielding team
- `fieldingSummary.stumpings` (number; documentado) — Stumpings effected
- `fours` (number; documentado) — Total fours in the innings
- `id` (number; documentado) — Cricket team id
- `inningBatsmen.balls` (number; documentado) — Number of balls
- `inningBatsmen.battingStrikeRate` (number; documentado) — Batting strike rate
- `inningBatsmen.dismissalFielders.isKeeper` (boolean; documentado) — Whether the fielder is the wicketkeeper
- `inningBatsmen.dismissalFielders.isSubstitute` (boolean; documentado) — Whether the fielder is a substitute
- `inningBatsmen.dismissalFielders.name` (string; documentado) — Name of the fielder
- `inningBatsmen.dismissalStatus` (string; documentado) — Dismissal status
- `inningBatsmen.fours` (number; documentado) — Number of fours
- `inningBatsmen.player.name` (string; documentado) — Player name
- `inningBatsmen.runs` (number; documentado) — Number of runs
- `inningBatsmen.sixes` (number; documentado) — Number of sixes
- `inningBowlers.concededRuns` (number; documentado) — Number of conceded runs
- `inningBowlers.economy` (number; documentado) — Economy statistics
- `inningBowlers.maidens` (number; documentado) — Number of maidens
- `inningBowlers.overs` (number; documentado) — Number of overs
- `inningBowlers.player.name` (string; documentado) — Player name
- `inningBowlers.wickets` (number; documentado) — Number of wickets
- `inningNumber` (number; documentado) — Inning number
- `inningPartnerships.balls` (number; documentado) — Number of balls
- `inningPartnerships.firstPlayer.name` (string; documentado) — Player name
- `inningPartnerships.firstPlayerBalls` (number; documentado) — Number of balls related to fist player
- `inningPartnerships.firstPlayerRuns` (number; documentado) — Number of runs related to first player
- `inningPartnerships.overs` (number; documentado) — Number of overs
- `inningPartnerships.runs` (number; documentado) — Number of runs
- `inningPartnerships.secondPlayer.name` (string; documentado) — Player name
- `inningPartnerships.secondPlayerBalls` (number; documentado) — Number of balls related to second player
- `inningPartnerships.secondPlayerRuns` (number; documentado) — Number of runs related to second player
- `legByes` (number; documentado) — Leg byes conceded
- `logo` (string; documentado) — Cricket team logo url
- `name` (number; documentado) — Cricket team name
- `noBalls` (number; documentado) — No balls bowled
- `sixes` (number; documentado) — Total sixes in the innings
- `statistics.average` (number; documentado) — Batting average stats
- `statistics.battingStrikeRate` (number; documentado) — Total batting strike rate
- `statistics.innings` (number; documentado) — Total number of innings
- `statistics.matches` (number; documentado) — Total number of matches
- `statistics.runs` (number; documentado) — Number of runs
- `wides` (number; documentado) — Wides bowled

### Jogadores / estatísticas de temporada

1 campos/métricas:

- `name` (string; documentado) — Player name

### Standings / campanha

24 campos/métricas:

- `groups.standings.loses` (number; documentado)
- `groups.standings.matchesPlayed` (number; documentado)
- `groups.standings.netRunRate` (number; documentado)
- `groups.standings.points` (number; documentado)
- `groups.standings.pointsAgainst` (string; documentado)
- `groups.standings.pointsFor` (string; documentado)
- `groups.standings.ties` (number; documentado)
- `groups.standings.wins` (number; documentado)
- `loses` (number; documentado)
- `matchesPlayed` (number; documentado)
- `netRunRate` (number; documentado)
- `points` (number; documentado)
- `pointsAgainst` (string; documentado)
- `pointsFor` (string; documentado)
- `standings.loses` (number; documentado)
- `standings.matchesPlayed` (number; documentado)
- `standings.netRunRate` (number; documentado)
- `standings.points` (number; documentado)
- `standings.pointsAgainst` (string; documentado)
- `standings.pointsFor` (string; documentado)
- `standings.ties` (number; documentado)
- `standings.wins` (number; documentado)
- `ties` (number; documentado)
- `wins` (number; documentado)


## Football / Soccer

### Box score / desempenho por jogador

43 campos/métricas:

- `isCaptain` (boolean; documentado)
- `isSubstitute` (boolean; documentado)
- `matchRating` (string; documentado)
- `minutesPlayed` (number; documentado)
- `offsides` (number; documentado)
- `shirtNumber` (number; documentado)
- `statistics.assists` (number; documentado)
- `statistics.cardsRed` (number; documentado)
- `statistics.cardsSecondYellow` (number; documentado)
- `statistics.cardsYellow` (number; documentado)
- `statistics.dribbleSuccessRate` (string; documentado)
- `statistics.dribblesFailed` (number; documentado)
- `statistics.dribblesSuccessful` (number; documentado)
- `statistics.dribblesTotal` (number; documentado)
- `statistics.duelSuccessRate` (string; documentado)
- `statistics.duelsLost` (number; documentado)
- `statistics.duelsTotal` (number; documentado)
- `statistics.duelsWon` (number; documentado)
- `statistics.expectedAssists` (number; documentado)
- `statistics.expectedGoals` (number; documentado)
- `statistics.expectedGoalsOnTarget` (number; documentado)
- `statistics.expectedGoalsOnTargetConceded` (number; documentado)
- `statistics.expectedGoalsPrevented` (number; documentado)
- `statistics.fouledByOthers` (number; documentado)
- `statistics.fouledOthers` (number; documentado)
- `statistics.goalsConceded` (number; documentado)
- `statistics.goalsSaved` (number; documentado)
- `statistics.goalsScored` (number; documentado)
- `statistics.interceptionsTotal` (number; documentado)
- `statistics.passesAccuracy` (string; documentado)
- `statistics.passesFailed` (number; documentado)
- `statistics.passesKey` (number; documentado)
- `statistics.passesSuccessful` (number; documentado)
- `statistics.passesTotal` (number; documentado)
- `statistics.penaltiesAccuracy` (string; documentado)
- `statistics.penaltiesMissed` (number; documentado)
- `statistics.penaltiesScored` (number; documentado)
- `statistics.penaltiesTotal` (number; documentado)
- `statistics.shotsAccuracy` (string; documentado)
- `statistics.shotsOffTarget` (number; documentado)
- `statistics.shotsOnTarget` (number; documentado)
- `statistics.shotsTotal` (number; documentado)
- `statistics.tacklesTotal` (number; documentado)

### Escalações

10 campos/métricas:

- `awayTeam.formation` (string; documentado)
- `awayTeam.initialLineup.number` (number; documentado)
- `awayTeam.substitutes.number` (number; documentado)
- `formation` (string; documentado)
- `homeTeam.formation` (string; documentado)
- `homeTeam.initialLineup.number` (number; documentado)
- `homeTeam.substitutes.number` (number; documentado)
- `initialLineup.number` (number; documentado)
- `number` (number; documentado)
- `substitutes.number` (number; documentado)

### Estatísticas de equipe

6 campos/métricas:

- `away` (object; documentado) — Goal and game statistics team has played away for given season/year.
- `home` (object; documentado) — Goal and game statistics team has played at home for given season/year.
- `leagueId` (number; documentado) — Id of league to which team statistics are associated.
- `leagueName` (string; documentado) — Name of league to which team statistics are associated.
- `season` (number; documentado) — Season year to which team statistics are associated.
- `total` (object; documentado) — Goal and game statistics for given season/year.

### Estatísticas de partida

42 campos/métricas:

- `Aerial Duels` (number; observado) — Métrica observada em resposta real.
- `Attacks` (number; observado) — Métrica observada em resposta real.
- `Backward Passes` (number; observado) — Métrica observada em resposta real.
- `Big Chances Created` (number; observado) — Métrica observada em resposta real.
- `Blocked shots` (number; observado) — Métrica observada em resposta real.
- `Clearances` (number; observado) — Métrica observada em resposta real.
- `Corners` (number; observado) — Métrica observada em resposta real.
- `Crosses` (number; observado) — Métrica observada em resposta real.
- `Dribbles` (number; observado) — Métrica observada em resposta real.
- `Expected Assists` (number; observado) — Métrica observada em resposta real.
- `Expected Goals` (number; observado) — Métrica observada em resposta real.
- `Failed passes` (number; observado) — Métrica observada em resposta real.
- `Fouls` (number; observado) — Métrica observada em resposta real.
- `Free Kicks` (number; observado) — Métrica observada em resposta real.
- `Goal Kicks` (number; observado) — Métrica observada em resposta real.
- `Goalkeeper saves` (number; observado) — Métrica observada em resposta real.
- `Interceptions` (number; observado) — Métrica observada em resposta real.
- `Key Passes` (number; observado) — Métrica observada em resposta real.
- `Long Passes` (number; observado) — Métrica observada em resposta real.
- `Offsides` (number; observado) — Métrica observada em resposta real.
- `Passes Into Final Third` (number; observado) — Métrica observada em resposta real.
- `Passes Opposition Half` (number; observado) — Métrica observada em resposta real.
- `Passes Own Half` (number; observado) — Métrica observada em resposta real.
- `Possession` (number; observado) — Métrica observada em resposta real.
- `Red cards` (number; observado) — Métrica observada em resposta real.
- `Shots accuracy` (number; observado) — Métrica observada em resposta real.
- `Shots off target` (number; observado) — Métrica observada em resposta real.
- `Shots on target` (number; observado) — Métrica observada em resposta real.
- `Shots outside penalty area` (number; observado) — Métrica observada em resposta real.
- `Shots within penalty area` (number; observado) — Métrica observada em resposta real.
- `Successful Aerial Duels` (number; observado) — Métrica observada em resposta real.
- `Successful Crosses` (number; observado) — Métrica observada em resposta real.
- `Successful Dribbles` (number; observado) — Métrica observada em resposta real.
- `Successful Long Passes` (number; observado) — Métrica observada em resposta real.
- `Successful Tackles` (number; observado) — Métrica observada em resposta real.
- `Successful passes` (number; observado) — Métrica observada em resposta real.
- `Tackles` (number; observado) — Métrica observada em resposta real.
- `Throw-Ins` (number; observado) — Métrica observada em resposta real.
- `Total passes` (number; observado) — Métrica observada em resposta real.
- `Yellow cards` (number; observado) — Métrica observada em resposta real.
- `statistics.value` (number; documentado)
- `value` (number; documentado)

### Eventos

4 campos/métricas:

- `assist` (string; documentado)
- `assistingPlayerId` (number; documentado)
- `playerId` (number; documentado)
- `substituted` (string; documentado)

### Jogadores / estatísticas de temporada

168 campos/métricas:

- `absentDurationInDays` (number; documentado)
- `age` (number; documentado)
- `assists` (number; documentado)
- `birthDate` (string; documentado)
- `birthPlace` (string; documentado)
- `citizenship` (string; documentado)
- `cleanSheets` (number; documentado)
- `club` (string; documentado)
- `club.contractExpiry` (string; documentado)
- `club.current` (string; documentado)
- `club.joinedAt` (string; documentado)
- `club.latestContractExtension` (string; documentado)
- `contractExpiry` (string; documentado)
- `currency` (string; documentado)
- `current` (string; documentado)
- `current.club` (string; documentado)
- `current.rumourDate` (string; documentado)
- `current.transferProbability` (string; documentado)
- `deathDate` (string; documentado)
- `fee` (string; documentado)
- `foot` (string; documentado)
- `from` (string; documentado)
- `fromDate` (string; documentado)
- `gamesPlayed` (number; documentado)
- `goals` (number; documentado)
- `goalsConceded` (number; documentado)
- `height` (string; documentado)
- `historical.club` (string; documentado)
- `historical.rumourDate` (string; documentado)
- `historical.transferProbability` (string; documentado)
- `injuries.absentDurationInDays` (number; documentado)
- `injuries.fromDate` (string; documentado)
- `injuries.missedGames` (number; documentado)
- `injuries.reason` (string; documentado)
- `injuries.toDate` (string; documentado)
- `joinedAt` (string; documentado)
- `latestContractExtension` (string; documentado)
- `main` (string; documentado)
- `marketValue` (string; documentado)
- `marketValue.age` (number; documentado)
- `marketValue.club` (string; documentado)
- `marketValue.currency` (string; documentado)
- `marketValue.recordedDate` (string; documentado)
- `marketValue.value` (number; documentado)
- `minutesPlayed` (number; documentado)
- `missedGames` (number; documentado)
- `ownGoals` (number; documentado)
- `pagination.limit` (number; documentado)
- `pagination.offset` (number; documentado)
- `pagination.totalCount` (number; documentado) — Available number of items, relevant to the provided query.
- `penaltiesScored` (number; documentado)
- `perClub.assists` (number; documentado)
- `perClub.cleanSheets` (number; documentado)
- `perClub.club` (string; documentado)
- `perClub.gamesPlayed` (number; documentado)
- `perClub.goals` (number; documentado)
- `perClub.goalsConceded` (number; documentado)
- `perClub.minutesPlayed` (number; documentado)
- `perClub.ownGoals` (number; documentado)
- `perClub.penaltiesScored` (number; documentado)
- `perClub.redCards` (number; documentado)
- `perClub.secondYellowCards` (number; documentado)
- `perClub.substitutedIn` (number; documentado)
- `perClub.substitutedOut` (number; documentado)
- `perClub.yellowCards` (number; documentado)
- `perCompetition.assists` (number; documentado)
- `perCompetition.cleanSheets` (number; documentado)
- `perCompetition.club` (string; documentado)
- `perCompetition.gamesPlayed` (number; documentado)
- `perCompetition.goals` (number; documentado)
- `perCompetition.goalsConceded` (number; documentado)
- `perCompetition.minutesPlayed` (number; documentado)
- `perCompetition.ownGoals` (number; documentado)
- `perCompetition.penaltiesScored` (number; documentado)
- `perCompetition.redCards` (number; documentado)
- `perCompetition.secondYellowCards` (number; documentado)
- `perCompetition.substitutedIn` (number; documentado)
- `perCompetition.substitutedOut` (number; documentado)
- `perCompetition.yellowCards` (number; documentado)
- `plan.message` (string; documentado) — Explanation message regarding your current tier.
- `plan.tier` (string; documentado) — Your current API subscription tier.
- `players.isCaptain` (boolean; documentado)
- `players.isSubstitute` (boolean; documentado)
- `players.matchRating` (string; documentado)
- `players.minutesPlayed` (number; documentado)
- `players.offsides` (number; documentado)
- `players.shirtNumber` (number; documentado)
- `players.statistics.assists` (number; documentado)
- `players.statistics.cardsRed` (number; documentado)
- `players.statistics.cardsSecondYellow` (number; documentado)
- `players.statistics.cardsYellow` (number; documentado)
- `players.statistics.dribbleSuccessRate` (string; documentado)
- `players.statistics.dribblesFailed` (number; documentado)
- `players.statistics.dribblesSuccessful` (number; documentado)
- `players.statistics.dribblesTotal` (number; documentado)
- `players.statistics.duelSuccessRate` (string; documentado)
- `players.statistics.duelsLost` (number; documentado)
- `players.statistics.duelsTotal` (number; documentado)
- `players.statistics.duelsWon` (number; documentado)
- `players.statistics.expectedAssists` (number; documentado)
- `players.statistics.expectedGoals` (number; documentado)
- `players.statistics.expectedGoalsOnTarget` (number; documentado)
- `players.statistics.expectedGoalsOnTargetConceded` (number; documentado)
- `players.statistics.expectedGoalsPrevented` (number; documentado)
- `players.statistics.fouledByOthers` (number; documentado)
- `players.statistics.fouledOthers` (number; documentado)
- `players.statistics.goalsConceded` (number; documentado)
- `players.statistics.goalsSaved` (number; documentado)
- `players.statistics.goalsScored` (number; documentado)
- `players.statistics.interceptionsTotal` (number; documentado)
- `players.statistics.passesAccuracy` (string; documentado)
- `players.statistics.passesFailed` (number; documentado)
- `players.statistics.passesKey` (number; documentado)
- `players.statistics.passesSuccessful` (number; documentado)
- `players.statistics.passesTotal` (number; documentado)
- `players.statistics.penaltiesAccuracy` (string; documentado)
- `players.statistics.penaltiesMissed` (number; documentado)
- `players.statistics.penaltiesScored` (number; documentado)
- `players.statistics.penaltiesTotal` (number; documentado)
- `players.statistics.shotsAccuracy` (string; documentado)
- `players.statistics.shotsOffTarget` (number; documentado)
- `players.statistics.shotsOnTarget` (number; documentado)
- `players.statistics.shotsTotal` (number; documentado)
- `players.statistics.tacklesTotal` (number; documentado)
- `position.main` (string; documentado)
- `position.secondary` (string; documentado)
- `profile.birthDate` (string; documentado)
- `profile.birthPlace` (string; documentado)
- `profile.citizenship` (string; documentado)
- `profile.club.contractExpiry` (string; documentado)
- `profile.club.current` (string; documentado)
- `profile.club.joinedAt` (string; documentado)
- `profile.club.latestContractExtension` (string; documentado)
- `profile.deathDate` (string; documentado)
- `profile.foot` (string; documentado)
- `profile.height` (string; documentado)
- `profile.position.main` (string; documentado)
- `profile.position.secondary` (string; documentado)
- `reason` (string; documentado)
- `recordedDate` (string; documentado)
- `redCards` (number; documentado)
- `relatedNews.title` (string; documentado)
- `relatedNews.url` (string; documentado)
- `rumourDate` (string; documentado)
- `rumours.current.club` (string; documentado)
- `rumours.current.rumourDate` (string; documentado)
- `rumours.current.transferProbability` (string; documentado)
- `rumours.historical.club` (string; documentado)
- `rumours.historical.rumourDate` (string; documentado)
- `rumours.historical.transferProbability` (string; documentado)
- `secondYellowCards` (number; documentado)
- `secondary` (string; documentado)
- `statistics.value` (object; documentado)
- `substitutedIn` (number; documentado)
- `substitutedOut` (number; documentado)
- `title` (string; documentado)
- `to` (string; documentado)
- `toDate` (string; documentado)
- `transferDate` (string; documentado)
- `transferProbability` (string; documentado)
- `transfers.fee` (string; documentado)
- `transfers.from` (string; documentado)
- `transfers.marketValue` (string; documentado)
- `transfers.to` (string; documentado)
- `transfers.transferDate` (string; documentado)
- `url` (string; documentado)
- `value` (object; documentado)
- `yellowCards` (number; documentado)

### Standings / campanha

63 campos/métricas:

- `away.draws` (number; documentado)
- `away.games` (number; documentado)
- `away.loses` (number; documentado)
- `away.receivedGoals` (number; documentado)
- `away.scoredGoals` (number; documentado)
- `away.wins` (number; documentado)
- `draws` (number; documentado)
- `games` (number; documentado)
- `groups.standings.away.draws` (number; documentado)
- `groups.standings.away.games` (number; documentado)
- `groups.standings.away.loses` (number; documentado)
- `groups.standings.away.receivedGoals` (number; documentado)
- `groups.standings.away.scoredGoals` (number; documentado)
- `groups.standings.away.wins` (number; documentado)
- `groups.standings.home.draws` (number; documentado)
- `groups.standings.home.games` (number; documentado)
- `groups.standings.home.loses` (number; documentado)
- `groups.standings.home.receivedGoals` (number; documentado)
- `groups.standings.home.scoredGoals` (number; documentado)
- `groups.standings.home.wins` (number; documentado)
- `groups.standings.points` (number; documentado)
- `groups.standings.total.draws` (number; documentado)
- `groups.standings.total.games` (number; documentado)
- `groups.standings.total.loses` (number; documentado)
- `groups.standings.total.receivedGoals` (number; documentado)
- `groups.standings.total.scoredGoals` (number; documentado)
- `groups.standings.total.wins` (number; documentado)
- `home.draws` (number; documentado)
- `home.games` (number; documentado)
- `home.loses` (number; documentado)
- `home.receivedGoals` (number; documentado)
- `home.scoredGoals` (number; documentado)
- `home.wins` (number; documentado)
- `loses` (number; documentado)
- `points` (number; documentado)
- `receivedGoals` (number; documentado)
- `scoredGoals` (number; documentado)
- `standings.away.draws` (number; documentado)
- `standings.away.games` (number; documentado)
- `standings.away.loses` (number; documentado)
- `standings.away.receivedGoals` (number; documentado)
- `standings.away.scoredGoals` (number; documentado)
- `standings.away.wins` (number; documentado)
- `standings.home.draws` (number; documentado)
- `standings.home.games` (number; documentado)
- `standings.home.loses` (number; documentado)
- `standings.home.receivedGoals` (number; documentado)
- `standings.home.scoredGoals` (number; documentado)
- `standings.home.wins` (number; documentado)
- `standings.points` (number; documentado)
- `standings.total.draws` (number; documentado)
- `standings.total.games` (number; documentado)
- `standings.total.loses` (number; documentado)
- `standings.total.receivedGoals` (number; documentado)
- `standings.total.scoredGoals` (number; documentado)
- `standings.total.wins` (number; documentado)
- `total.draws` (number; documentado)
- `total.games` (number; documentado)
- `total.loses` (number; documentado)
- `total.receivedGoals` (number; documentado)
- `total.scoredGoals` (number; documentado)
- `total.wins` (number; documentado)
- `wins` (number; documentado)


## Handball

### Estatísticas de equipe

6 campos/métricas:

- `away` (object; documentado) — Game and point statistics corresponding to specific league-season, where the team has played as an away team.
- `home` (object; documentado) — Game and point statistics corresponding to specific league-season, where the team has played as a home team.
- `leagueId` (number; documentado) — League id to which team statistics are associated.
- `leagueName` (string; documentado) — League name to which team statistics are associated.
- `season` (number; documentado) — Season year to which team statistics are associated.
- `total` (object; documentado) — Total game and points statistics corresponding to specific league-season.

### Standings / campanha

18 campos/métricas:

- `draws` (number; documentado)
- `gamesPlayed` (number; documentado)
- `groups.standings.draws` (number; documentado)
- `groups.standings.gamesPlayed` (number; documentado)
- `groups.standings.loses` (number; documentado)
- `groups.standings.receivedGoals` (number; documentado)
- `groups.standings.scoredGoals` (number; documentado)
- `groups.standings.wins` (number; documentado)
- `loses` (number; documentado)
- `receivedGoals` (number; documentado)
- `scoredGoals` (number; documentado)
- `standings.draws` (number; documentado)
- `standings.gamesPlayed` (number; documentado)
- `standings.loses` (number; documentado)
- `standings.receivedGoals` (number; documentado)
- `standings.scoredGoals` (number; documentado)
- `standings.wins` (number; documentado)
- `wins` (number; documentado)


## Hockey global

### Estatísticas de equipe

6 campos/métricas:

- `away` (object; documentado) — Game and point statistics corresponding to specific league-season, where the team has played as an away team.
- `home` (object; documentado) — Game and point statistics corresponding to specific league-season, where the team has played as a home team.
- `leagueId` (number; documentado) — League id to which team statistics are associated.
- `leagueName` (string; documentado) — League name to which team statistics are associated.
- `season` (number; documentado) — Season year to which team statistics are associated.
- `total` (object; documentado) — Total game and points statistics corresponding to specific league-season.

### Standings / campanha

21 campos/métricas:

- `gamesPlayed` (number; documentado)
- `groups.standings.gamesPlayed` (number; documentado)
- `groups.standings.loses` (number; documentado)
- `groups.standings.losesOvertime` (number; documentado)
- `groups.standings.receivedGoals` (number; documentado)
- `groups.standings.scoredGoals` (number; documentado)
- `groups.standings.wins` (number; documentado)
- `groups.standings.winsOvertime` (number; documentado)
- `loses` (number; documentado)
- `losesOvertime` (number; documentado)
- `receivedGoals` (number; documentado)
- `scoredGoals` (number; documentado)
- `standings.gamesPlayed` (number; documentado)
- `standings.loses` (number; documentado)
- `standings.losesOvertime` (number; documentado)
- `standings.receivedGoals` (number; documentado)
- `standings.scoredGoals` (number; documentado)
- `standings.wins` (number; documentado)
- `standings.winsOvertime` (number; documentado)
- `wins` (number; documentado)
- `winsOvertime` (number; documentado)


## NBA / NCAAB

### Box score / desempenho por jogador

8 campos/métricas:

- `boxScores.player.jersey` (number; documentado)
- `boxScores.statistics.value` (number; documentado)
- `jersey` (number; documentado)
- `player.jersey` (number; documentado)
- `statistics.value` (number; documentado)
- `team.boxScores.player.jersey` (number; documentado)
- `team.boxScores.statistics.value` (number; documentado)
- `value` (number; documentado)

### Escalações

15 campos/métricas:

- `away.lineup.isStarter` (boolean; documentado)
- `away.lineup.jersey` (number; documentado)
- `away.lineup.positionAbbreviation` (string; documentado)
- `away.team.abbreviation` (string; documentado)
- `home.lineup.isStarter` (boolean; documentado)
- `home.lineup.jersey` (number; documentado)
- `home.lineup.positionAbbreviation` (string; documentado)
- `home.team.abbreviation` (string; documentado)
- `isStarter` (boolean; documentado)
- `jersey` (number; documentado)
- `lineup.isStarter` (boolean; documentado)
- `lineup.jersey` (number; documentado)
- `lineup.positionAbbreviation` (string; documentado)
- `positionAbbreviation` (string; documentado)
- `team.abbreviation` (string; documentado)

### Estatísticas de equipe

4 campos/métricas:

- `away` (object; documentado) — Game and point statistics corresponding to specific league round, where the team has played as an away team.
- `home` (object; documentado) — Game and point statistics corresponding to specific league round, where the team has played as a home team.
- `leagueName` (string; documentado) — League name to which team statistics are associated.
- `total` (object; documentado) — Total game and points statistics corresponding to specific league round.

### Jogadores / estatísticas de temporada

42 campos/métricas:

- `abbreviation` (string; documentado)
- `birthDate` (string; documentado) — DD.MM.YYYY format
- `birthPlace` (string; documentado)
- `draft.pick` (number; documentado)
- `draft.round` (number; documentado)
- `draft.year` (number; documentado)
- `height` (string; documentado)
- `isActive` (boolean; documentado)
- `jersey` (string; documentado)
- `main` (string; documentado)
- `pagination.limit` (number; documentado)
- `pagination.offset` (number; documentado)
- `pagination.totalCount` (number; documentado) — Available number of items, relevant to the provided query.
- `perSeason.seasonBreakdown` (string; documentado) — Represents the coverage for the stored statistics. Pre-season is never included.
- `perSeason.stats.category` (string; documentado)
- `perSeason.stats.value` (number; documentado)
- `perSeason.teams.abbreviation` (string; documentado)
- `pick` (number; documentado)
- `plan.message` (string; documentado) — Explanation message regarding your current tier.
- `plan.tier` (string; documentado) — Your current API subscription tier.
- `position.abbreviation` (string; documentado)
- `position.main` (string; documentado)
- `profile.birthDate` (string; documentado) — DD.MM.YYYY format
- `profile.birthPlace` (string; documentado)
- `profile.draft.pick` (number; documentado)
- `profile.draft.round` (number; documentado)
- `profile.draft.year` (number; documentado)
- `profile.height` (string; documentado)
- `profile.isActive` (boolean; documentado)
- `profile.jersey` (string; documentado)
- `profile.position.abbreviation` (string; documentado)
- `profile.position.main` (string; documentado)
- `profile.team.abbreviation` (string; documentado)
- `profile.weight` (string; documentado)
- `round` (number; documentado)
- `seasonBreakdown` (string; documentado) — Represents the coverage for the stored statistics. Pre-season is never included.
- `stats.category` (string; documentado)
- `stats.value` (number; documentado)
- `team.abbreviation` (string; documentado)
- `teams.abbreviation` (string; documentado)
- `weight` (string; documentado)
- `year` (number; documentado)

### Standings / campanha

22 campos/métricas:

- `abbreviation` (string; documentado)
- `data.abbreviation` (string; documentado)
- `data.data.team.abbreviation` (string; documentado)
- `data.endDate` (string; documentado)
- `data.leagueName` (string; documentado)
- `data.leagueType` (string; documentado)
- `data.seasonType` (string; documentado)
- `data.startDate` (string; documentado)
- `data.statistics.value` (string; documentado)
- `data.team.abbreviation` (string; documentado)
- `data.year` (number; documentado)
- `endDate` (string; documentado)
- `leagueName` (string; documentado)
- `leagueType` (string; documentado)
- `pagination.limit` (number; documentado)
- `pagination.offset` (number; documentado)
- `pagination.totalCount` (number; documentado) — Available number of items, relevant to the provided query.
- `plan.message` (string; documentado) — Explanation message regarding your current tier.
- `plan.tier` (string; documentado) — Your current API subscription tier.
- `seasonType` (string; documentado)
- `startDate` (string; documentado)
- `year` (number; documentado)


## NHL / NCAAH

### Escalações

15 campos/métricas:

- `away.lineup.isScratched` (boolean; documentado)
- `away.lineup.jersey` (number; documentado)
- `away.lineup.positionAbbreviation` (string; documentado)
- `away.team.abbreviation` (string; documentado)
- `home.lineup.isScratched` (boolean; documentado)
- `home.lineup.jersey` (number; documentado)
- `home.lineup.positionAbbreviation` (string; documentado)
- `home.team.abbreviation` (string; documentado)
- `isScratched` (boolean; documentado)
- `jersey` (number; documentado)
- `lineup.isScratched` (boolean; documentado)
- `lineup.jersey` (number; documentado)
- `lineup.positionAbbreviation` (string; documentado)
- `positionAbbreviation` (string; documentado)
- `team.abbreviation` (string; documentado)

### Estatísticas de equipe

5 campos/métricas:

- `away` (object; documentado) — Game and goal statistics corresponding to specific league round, where the team has played as an away team.
- `home` (object; documentado) — Game and goal statistics corresponding to specific league round, where the team has played as a home team.
- `leagueName` (string; documentado) — League name to which team statistics are associated.
- `round` (string; documentado) — Round to which team statistics are associated.
- `total` (object; documentado) — Total game and goals statistics corresponding to specific league round.

### Eventos

4 campos/métricas:

- `clock` (string; documentado)
- `isScoringPlay` (boolean; documentado)
- `period` (number; documentado)
- `team.abbreviation` (string; documentado)

### Jogadores / estatísticas de temporada

42 campos/métricas:

- `abbreviation` (string; documentado)
- `birthDate` (string; documentado) — DD.MM.YYYY format
- `birthPlace` (string; documentado)
- `draft.pick` (number; documentado)
- `draft.round` (number; documentado)
- `draft.year` (number; documentado)
- `height` (string; documentado)
- `isActive` (boolean; documentado)
- `jersey` (string; documentado)
- `main` (string; documentado)
- `pagination.limit` (number; documentado)
- `pagination.offset` (number; documentado)
- `pagination.totalCount` (number; documentado) — Available number of items, relevant to the provided query.
- `perSeason.seasonBreakdown` (string; documentado) — Represents the coverage for the stored statistics. Pre-season is never included.
- `perSeason.stats.category` (string; documentado)
- `perSeason.stats.value` (number; documentado)
- `perSeason.teams.abbreviation` (string; documentado)
- `pick` (number; documentado)
- `plan.message` (string; documentado) — Explanation message regarding your current tier.
- `plan.tier` (string; documentado) — Your current API subscription tier.
- `position.abbreviation` (string; documentado)
- `position.main` (string; documentado)
- `profile.birthDate` (string; documentado) — DD.MM.YYYY format
- `profile.birthPlace` (string; documentado)
- `profile.draft.pick` (number; documentado)
- `profile.draft.round` (number; documentado)
- `profile.draft.year` (number; documentado)
- `profile.height` (string; documentado)
- `profile.isActive` (boolean; documentado)
- `profile.jersey` (string; documentado)
- `profile.position.abbreviation` (string; documentado)
- `profile.position.main` (string; documentado)
- `profile.team.abbreviation` (string; documentado)
- `profile.weight` (string; documentado)
- `round` (number; documentado)
- `seasonBreakdown` (string; documentado) — Represents the coverage for the stored statistics. Pre-season is never included.
- `stats.category` (string; documentado)
- `stats.value` (number; documentado)
- `team.abbreviation` (string; documentado)
- `teams.abbreviation` (string; documentado)
- `weight` (string; documentado)
- `year` (number; documentado)

### Standings / campanha

9 campos/métricas:

- `abbreviation` (string; documentado)
- `data.statistics.value` (string; documentado)
- `data.team.abbreviation` (string; documentado)
- `endDate` (string; documentado)
- `leagueName` (string; documentado)
- `leagueType` (string; documentado)
- `seasonType` (string; documentado)
- `startDate` (string; documentado)
- `year` (number; documentado)


## Rugby

### Escalações

35 campos/métricas:

- `away.initialLineup.birth` (string; documentado)
- `away.initialLineup.countryName` (string; documentado)
- `away.initialLineup.height` (string; documentado)
- `away.initialLineup.shirtNumber` (number; documentado)
- `away.initialLineup.shortName` (string; documentado)
- `away.substitutions.birth` (string; documentado)
- `away.substitutions.countryName` (string; documentado)
- `away.substitutions.height` (string; documentado)
- `away.substitutions.shirtNumber` (number; documentado)
- `away.substitutions.shortName` (string; documentado)
- `birth` (string; documentado)
- `countryName` (string; documentado)
- `height` (string; documentado)
- `home.initialLineup.birth` (string; documentado)
- `home.initialLineup.countryName` (string; documentado)
- `home.initialLineup.height` (string; documentado)
- `home.initialLineup.shirtNumber` (number; documentado)
- `home.initialLineup.shortName` (string; documentado)
- `home.substitutions.birth` (string; documentado)
- `home.substitutions.countryName` (string; documentado)
- `home.substitutions.height` (string; documentado)
- `home.substitutions.shirtNumber` (number; documentado)
- `home.substitutions.shortName` (string; documentado)
- `initialLineup.birth` (string; documentado)
- `initialLineup.countryName` (string; documentado)
- `initialLineup.height` (string; documentado)
- `initialLineup.shirtNumber` (number; documentado)
- `initialLineup.shortName` (string; documentado)
- `shirtNumber` (number; documentado)
- `shortName` (string; documentado)
- `substitutions.birth` (string; documentado)
- `substitutions.countryName` (string; documentado)
- `substitutions.height` (string; documentado)
- `substitutions.shirtNumber` (number; documentado)
- `substitutions.shortName` (string; documentado)

### Standings / campanha

21 campos/métricas:

- `draws` (number; documentado)
- `gamesPlayed` (number; documentado)
- `groups.standings.draws` (number; documentado)
- `groups.standings.gamesPlayed` (number; documentado)
- `groups.standings.loses` (number; documentado)
- `groups.standings.points` (number; documentado)
- `groups.standings.receivedPoints` (number; documentado)
- `groups.standings.scoredPoints` (number; documentado)
- `groups.standings.wins` (number; documentado)
- `loses` (number; documentado)
- `points` (number; documentado)
- `receivedPoints` (number; documentado)
- `scoredPoints` (number; documentado)
- `standings.draws` (number; documentado)
- `standings.gamesPlayed` (number; documentado)
- `standings.loses` (number; documentado)
- `standings.points` (number; documentado)
- `standings.receivedPoints` (number; documentado)
- `standings.scoredPoints` (number; documentado)
- `standings.wins` (number; documentado)
- `wins` (number; documentado)


## Shared / sport-dependent

### Box score / desempenho por jogador

37 campos/métricas:

- `assists` (number; documentado)
- `cardsRed` (number; documentado)
- `cardsSecondYellow` (number; documentado)
- `cardsYellow` (number; documentado)
- `dribbleSuccessRate` (string; documentado)
- `dribblesFailed` (number; documentado)
- `dribblesSuccessful` (number; documentado)
- `dribblesTotal` (number; documentado)
- `duelSuccessRate` (string; documentado)
- `duelsLost` (number; documentado)
- `duelsTotal` (number; documentado)
- `duelsWon` (number; documentado)
- `expectedAssists` (number; documentado)
- `expectedGoals` (number; documentado)
- `expectedGoalsOnTarget` (number; documentado)
- `expectedGoalsOnTargetConceded` (number; documentado)
- `expectedGoalsPrevented` (number; documentado)
- `fouledByOthers` (number; documentado)
- `fouledOthers` (number; documentado)
- `goalsConceded` (number; documentado)
- `goalsSaved` (number; documentado)
- `goalsScored` (number; documentado)
- `interceptionsTotal` (number; documentado)
- `passesAccuracy` (string; documentado)
- `passesFailed` (number; documentado)
- `passesKey` (number; documentado)
- `passesSuccessful` (number; documentado)
- `passesTotal` (number; documentado)
- `penaltiesAccuracy` (string; documentado)
- `penaltiesMissed` (number; documentado)
- `penaltiesScored` (number; documentado)
- `penaltiesTotal` (number; documentado)
- `shotsAccuracy` (string; documentado)
- `shotsOffTarget` (number; documentado)
- `shotsOnTarget` (number; documentado)
- `shotsTotal` (number; documentado)
- `tacklesTotal` (number; documentado)

### Estatísticas de equipe

2 campos/métricas:

- `statistics.name` (string; documentado) — Display name for each statistics info.
- `statistics.value` (number; documentado)

### Estatísticas de partida

6 campos/métricas:

- `awayTeam.statistics.name` (string; documentado) — Display name for each statistics info.
- `awayTeam.statistics.value` (number; documentado)
- `homeTeam.statistics.name` (string; documentado) — Display name for each statistics info.
- `homeTeam.statistics.value` (number; documentado)
- `name` (string; documentado) — Display name for each statistics info.
- `value` (number; documentado)

### Eventos

6 campos/métricas:

- `clock` (string; documentado)
- `description` (string; documentado)
- `isScoringPlay` (boolean; documentado) — boolean describing whether specific event is scoring or not
- `isShootingPlay` (boolean; documentado) — boolean describing whether specific play is shooting or not
- `period` (string; documentado)
- `team.abbreviation` (string; documentado)

### Jogadores / estatísticas de temporada

34 campos/métricas:

- `batting.statistics.value` (number; documentado)
- `batting.year` (number; documentado)
- `bowling.statistics.value` (number; documentado)
- `bowling.year` (number; documentado)
- `data.dateOfBirth` (number; documentado) — Player birth date in Unix timestamp
- `data.gender` (string; documentado)
- `data.longName` (string; documentado)
- `dateOfBirth` (number; documentado) — Player birth date in Unix timestamp
- `fielding.statistics.value` (number; documentado)
- `fielding.year` (number; documentado)
- `format` (string; documentado) — Match format
- `gender` (string; documentado)
- `inning` (number; documentado)
- `longName` (string; documentado)
- `pagination.limit` (number; documentado)
- `pagination.offset` (number; documentado)
- `pagination.totalCount` (number; documentado) — Available number of items, relevant to the provided query.
- `plan.message` (string; documentado) — Explanation message regarding your current tier.
- `plan.tier` (string; documentado) — Your current API subscription tier.
- `statistics.balls` (number; documentado)
- `statistics.economy` (number; documentado)
- `statistics.fours` (number; documentado)
- `statistics.overs` (number; documentado)
- `statistics.runs` (number; documentado)
- `statistics.runsConceded` (number; documentado)
- `statistics.sixes` (number; documentado)
- `statistics.strikeRate` (number; documentado)
- `statistics.value` (number; documentado)
- `statistics.wickets` (number; documentado)
- `summary.batting.year` (number; documentado)
- `summary.bowling.year` (number; documentado)
- `summary.fielding.year` (number; documentado)
- `summary.format` (string; documentado) — Match format
- `year` (number; documentado)

### Standings / campanha

3 campos/métricas:

- `statistics.value` (string; documentado)
- `team.abbreviation` (string; documentado)
- `value` (string; documentado)


## Volleyball

### Estatísticas de equipe

6 campos/métricas:

- `away` (object; documentado) — Game and point statistics corresponding to specific league-season, where the team has played as an away team.
- `home` (object; documentado) — Game and point statistics corresponding to specific league-season, where the team has played as a home team.
- `leagueId` (number; documentado) — League id to which team statistics are associated.
- `leagueName` (string; documentado) — League name to which team statistics are associated.
- `season` (number; documentado) — Season year to which team statistics are associated.
- `total` (object; documentado) — Total game and points statistics corresponding to specific league-season.

### Standings / campanha

18 campos/métricas:

- `gamesPlayed` (number; documentado)
- `groups.standings.gamesPlayed` (number; documentado)
- `groups.standings.loses` (number; documentado)
- `groups.standings.points` (number; documentado)
- `groups.standings.receivedPoints` (number; documentado)
- `groups.standings.scoredPoints` (number; documentado)
- `groups.standings.wins` (number; documentado)
- `loses` (number; documentado)
- `points` (number; documentado)
- `receivedPoints` (number; documentado)
- `scoredPoints` (number; documentado)
- `standings.gamesPlayed` (number; documentado)
- `standings.loses` (number; documentado)
- `standings.points` (number; documentado)
- `standings.receivedPoints` (number; documentado)
- `standings.scoredPoints` (number; documentado)
- `standings.wins` (number; documentado)
- `wins` (number; documentado)

## Metodologia

Os schemas cujo nome contém Statistics, BoxScore, Standings, Lineups, Events, Players ou Team foram percorridos recursivamente. Referências OpenAPI foram resolvidas e campos repetidos foram deduplicados por esporte, categoria e caminho. Métricas dinâmicas foram complementadas com amostras reais de football, WNBA e MLB.

## Limitações e robustez

- Alguns endpoints usam listas abertas de pares nome/valor, portanto o OpenAPI não enumera todos os nomes possíveis.
- Cobertura e nomes variam por liga. WNBA aparece como `NBA Women`.
- Odds e mercados não puderam ser observados no BASIC.
- Standings exigem validação semântica antes de alimentar modelos.

## Próximos passos recomendados

1. Após upgrade PRO, coletar odds prematch/live e anexar mercados, seleções e bookmakers observados.
2. Executar amostragem de sete dias por liga-alvo para medir preenchimento de cada campo.
3. Manter schema raw versionado e normalização separada, pois métricas dinâmicas podem surgir sem mudança de versão.
4. Bloquear payloads que falhem nos guardrails de identidade, consistência de placar e valores impossíveis.

## Questões ainda abertas

- Quais métricas aparecem apenas em ligas premium ou jogos com cobertura avançada?
- Qual é a completude histórica por métrica e liga?
- Quais mercados de odds e timestamps são efetivamente retornados no PRO?
