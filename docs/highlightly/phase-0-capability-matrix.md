# Fase 0 — matriz de capacidades Highlightly

Contrato congelado: OpenAPI `6.13.2` (`1981d47f1289fe7a0851267728f1e12dce3aa37ad1baa2dae143e26c43719ea6`).

Escopo V1: 64 operações — football: 25, baseball: 20, basketball: 19.

## Evidência

- `confirmed`: resposta real validada.
- `confirmed_pro`: resposta real de recurso PRO validada.
- `confirmed_quality_issue`: endpoint respondeu, mas apresentou corrupção semântica.
- `documented`: disponível no contrato, ainda sem confirmação real.

| Esporte | Recurso | Operação | Path | Paginação | Prioridade | Cadência | SLA | Evidência | Destino |
|---|---|---|---|---|---:|---|---|---|---|
| baseball | `lineups` | detail | `/baseball/lineups/{matchId}` | não | P0 | `t24h_t2h_t30m_kickoff` | `30m_prematch` | `confirmed` | `sports_lineups, sports_lineup_players` |
| baseball | `matches` | collection | `/baseball/matches` | sim | P0 | `adaptive_match_window` | `10m_game_day` | `confirmed` | `sports_matches` |
| baseball | `matches` | detail | `/baseball/matches/{id}` | não | P0 | `adaptive_match_window` | `10m_game_day` | `confirmed` | `sports_matches` |
| baseball | `odds` | collection | `/baseball/odds` | sim | P0 | `adaptive_odds_window` | `20m_prematch_12m_live` | `confirmed_pro` | `sports_odds_current, sports_odds_history` |
| baseball | `box_scores` | detail | `/baseball/box-scores/{id}` | não | P1 | `final_15m_2h_24h` | `26h_postmatch` | `confirmed` | `sports_player_box_scores` |
| baseball | `standings` | collection | `/baseball/standings` | sim | P1 | `daily_post_round` | `36h` | `documented` | `sports_standings_snapshots` |
| baseball | `match_statistics` | detail | `/baseball/statistics/{id}` | não | P1 | `final_15m_2h_24h` | `26h_postmatch` | `confirmed` | `sports_match_team_stats` |
| baseball | `team_statistics` | detail | `/baseball/teams/statistics/{id}` | não | P1 | `daily` | `36h` | `documented` | `sports_team_season_stats` |
| baseball | `bookmakers` | collection | `/baseball/bookmakers` | sim | P2 | `weekly` | `8d` | `documented` | `sports_bookmakers` |
| baseball | `bookmakers` | detail | `/baseball/bookmakers/{id}` | não | P2 | `weekly` | `8d` | `documented` | `sports_bookmakers` |
| baseball | `player_statistics` | detail | `/baseball/players/{id}/statistics` | não | P2 | `weekly_and_on_demand` | `8d` | `documented` | `sports_player_stats` |
| baseball | `teams` | collection | `/baseball/teams` | não | P2 | `daily` | `36h` | `documented` | `sports_teams` |
| baseball | `teams` | detail | `/baseball/teams/{id}` | não | P2 | `daily` | `36h` | `documented` | `sports_teams` |
| baseball | `head_to_head` | collection | `/baseball/head-2-head` | não | P3 | `on_demand_ttl_24h` | `on_demand` | `documented` | `sports_matches` |
| baseball | `highlights` | collection | `/baseball/highlights` | sim | P3 | `postmatch_30m_6h` | `8h` | `documented` | `sports_highlights` |
| baseball | `highlights` | detail | `/baseball/highlights/{id}` | não | P3 | `postmatch_30m_6h` | `8h` | `documented` | `sports_highlights` |
| baseball | `last_five_games` | collection | `/baseball/last-five-games` | não | P3 | `on_demand_ttl_6h` | `on_demand` | `confirmed` | `sports_matches` |
| baseball | `players` | collection | `/baseball/players` | sim | P3 | `weekly_and_on_demand` | `8d` | `documented` | `sports_players` |
| baseball | `players` | detail | `/baseball/players/{id}` | não | P3 | `weekly_and_on_demand` | `8d` | `documented` | `sports_players` |
| baseball | `highlight_geo_restrictions` | detail | `/baseball/highlights/geo-restrictions/{id}` | não | P4 | `on_demand` | `on_demand` | `documented` | `sports_highlights` |
| basketball | `matches` | collection | `/basketball/matches` | sim | P0 | `adaptive_match_window` | `10m_game_day` | `confirmed` | `sports_matches` |
| basketball | `matches` | detail | `/basketball/matches/{id}` | não | P0 | `adaptive_match_window` | `10m_game_day` | `confirmed` | `sports_matches` |
| basketball | `odds` | collection | `/basketball/odds` | sim | P0 | `adaptive_odds_window` | `20m_prematch_12m_live` | `confirmed_pro` | `sports_odds_current, sports_odds_history` |
| basketball | `standings` | collection | `/basketball/standings` | não | P1 | `daily_post_round` | `36h` | `confirmed_quality_issue` | `sports_standings_snapshots` |
| basketball | `match_statistics` | detail | `/basketball/statistics/{matchId}` | não | P1 | `final_15m_2h_24h` | `26h_postmatch` | `confirmed` | `sports_match_team_stats` |
| basketball | `team_statistics` | detail | `/basketball/teams/statistics/{id}` | não | P1 | `daily` | `36h` | `confirmed` | `sports_team_season_stats` |
| basketball | `bookmakers` | collection | `/basketball/bookmakers` | sim | P2 | `weekly` | `8d` | `documented` | `sports_bookmakers` |
| basketball | `bookmakers` | detail | `/basketball/bookmakers/{id}` | não | P2 | `weekly` | `8d` | `documented` | `sports_bookmakers` |
| basketball | `leagues` | collection | `/basketball/leagues` | sim | P2 | `daily` | `36h` | `documented` | `sports_competitions` |
| basketball | `leagues` | detail | `/basketball/leagues/{id}` | não | P2 | `daily` | `36h` | `documented` | `sports_competitions` |
| basketball | `teams` | collection | `/basketball/teams` | sim | P2 | `daily` | `36h` | `documented` | `sports_teams` |
| basketball | `teams` | detail | `/basketball/teams/{id}` | não | P2 | `daily` | `36h` | `documented` | `sports_teams` |
| basketball | `countries` | collection | `/basketball/countries` | não | P3 | `weekly` | `8d` | `documented` | `sports_countries` |
| basketball | `countries` | detail | `/basketball/countries/{countryCode}` | não | P3 | `weekly` | `8d` | `documented` | `sports_countries` |
| basketball | `head_to_head` | collection | `/basketball/head-2-head` | não | P3 | `on_demand_ttl_24h` | `on_demand` | `documented` | `sports_matches` |
| basketball | `highlights` | collection | `/basketball/highlights` | sim | P3 | `postmatch_30m_6h` | `8h` | `documented` | `sports_highlights` |
| basketball | `highlights` | detail | `/basketball/highlights/{id}` | não | P3 | `postmatch_30m_6h` | `8h` | `documented` | `sports_highlights` |
| basketball | `last_five_games` | collection | `/basketball/last-five-games` | não | P3 | `on_demand_ttl_6h` | `on_demand` | `confirmed` | `sports_matches` |
| basketball | `highlight_geo_restrictions` | detail | `/basketball/highlights/geo-restrictions/{id}` | não | P4 | `on_demand` | `on_demand` | `documented` | `sports_highlights` |
| football | `events` | detail | `/football/events/{id}` | não | P0 | `active_match_only` | `provider_live_cadence` | `confirmed` | `sports_match_events` |
| football | `lineups` | detail | `/football/lineups/{matchId}` | não | P0 | `t24h_t2h_t30m_kickoff` | `30m_prematch` | `confirmed` | `sports_lineups, sports_lineup_players` |
| football | `matches` | collection | `/football/matches` | sim | P0 | `adaptive_match_window` | `10m_game_day` | `confirmed` | `sports_matches` |
| football | `matches` | detail | `/football/matches/{id}` | não | P0 | `adaptive_match_window` | `10m_game_day` | `confirmed` | `sports_matches` |
| football | `odds` | collection | `/football/odds` | sim | P0 | `adaptive_odds_window` | `20m_prematch_12m_live` | `confirmed_pro` | `sports_odds_current, sports_odds_history` |
| football | `box_scores` | detail | `/football/box-score/{matchId}` | não | P1 | `final_15m_2h_24h` | `26h_postmatch` | `confirmed` | `sports_player_box_scores` |
| football | `standings` | collection | `/football/standings` | não | P1 | `daily_post_round` | `36h` | `documented` | `sports_standings_snapshots` |
| football | `match_statistics` | detail | `/football/statistics/{matchId}` | não | P1 | `final_15m_2h_24h` | `26h_postmatch` | `confirmed` | `sports_match_team_stats` |
| football | `team_statistics` | detail | `/football/teams/statistics/{id}` | não | P1 | `daily` | `36h` | `documented` | `sports_team_season_stats` |
| football | `bookmakers` | collection | `/football/bookmakers` | sim | P2 | `weekly` | `8d` | `confirmed` | `sports_bookmakers` |
| football | `bookmakers` | detail | `/football/bookmakers/{id}` | não | P2 | `weekly` | `8d` | `confirmed` | `sports_bookmakers` |
| football | `leagues` | collection | `/football/leagues` | sim | P2 | `daily` | `36h` | `documented` | `sports_competitions` |
| football | `leagues` | detail | `/football/leagues/{id}` | não | P2 | `daily` | `36h` | `documented` | `sports_competitions` |
| football | `player_statistics` | detail | `/football/players/{id}/statistics` | não | P2 | `weekly_and_on_demand` | `8d` | `documented` | `sports_player_stats` |
| football | `teams` | collection | `/football/teams` | sim | P2 | `daily` | `36h` | `documented` | `sports_teams` |
| football | `teams` | detail | `/football/teams/{id}` | não | P2 | `daily` | `36h` | `documented` | `sports_teams` |
| football | `countries` | collection | `/football/countries` | não | P3 | `weekly` | `8d` | `documented` | `sports_countries` |
| football | `countries` | detail | `/football/countries/{countryCode}` | não | P3 | `weekly` | `8d` | `documented` | `sports_countries` |
| football | `head_to_head` | collection | `/football/head-2-head` | não | P3 | `on_demand_ttl_24h` | `on_demand` | `documented` | `sports_matches` |
| football | `highlights` | collection | `/football/highlights` | sim | P3 | `postmatch_30m_6h` | `8h` | `documented` | `sports_highlights` |
| football | `highlights` | detail | `/football/highlights/{id}` | não | P3 | `postmatch_30m_6h` | `8h` | `documented` | `sports_highlights` |
| football | `last_five_games` | collection | `/football/last-five-games` | não | P3 | `on_demand_ttl_6h` | `on_demand` | `documented` | `sports_matches` |
| football | `players` | collection | `/football/players` | sim | P3 | `weekly_and_on_demand` | `8d` | `documented` | `sports_players` |
| football | `players` | detail | `/football/players/{id}` | não | P3 | `weekly_and_on_demand` | `8d` | `documented` | `sports_players` |
| football | `highlight_geo_restrictions` | detail | `/football/highlights/geo-restrictions/{id}` | não | P4 | `on_demand` | `on_demand` | `documented` | `sports_highlights` |

## Resumo de evidências

- `confirmed`: 19 operações
- `confirmed_pro`: 3 operações
- `confirmed_quality_issue`: 1 operações
- `documented`: 41 operações

A ausência de confirmação real não desabilita a operação na V1. Ela exige fixture, smoke test e validação de qualidade antes da ativação do scheduler correspondente.
