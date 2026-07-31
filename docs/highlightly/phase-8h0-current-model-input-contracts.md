# Phase 8H.0 — Current model input contracts

This inventory records what the production runners consume today. It separates the daily provider payload from historical datasets so the Central Esportiva can build reproducible inputs without silently changing a model contract.

## Shared boundary

`collection_long_v1` is the canonical daily layer. Each row represents one match/market/selection/line/bookmaker observation. An adapter converts it into `model_wide_v1`, one row per match with market-specific columns. Historical datasets stay outside the daily payload and must be referenced through lineage with a cutoff strictly before the target match date.

Every sealed build stores its contract and model version, source snapshot time, per-match payload, feature origin, exact odds snapshot, coverage/missing-required report, lineage and deterministic 64-character content fingerprint. Sealed builds and their children are immutable.

## ASP MatchMatrix — football

- Version: `FOOTBALL_V1_5`.
- Required long fields: `data`, `hora`, `esporte`, `liga`, `jogo`, `mandante`, `visitante`, `mercado`, `pick`, `linha`, `odd`, `bookmaker`, `fonte`.
- Optional consensus/lineage fields: `country`, `odd_melhor`, `odd_mediana`, `odd_media`, `bookmaker_melhor`, `odds_consistency_status`.
- Wide base: `date`, `time`, `country`, `league`, `home`, `away`.
- Markets: 1X2, double chance, totals, both teams to score and Asian handicap. Offered, median and best-bookmaker values are kept separately.
- External history: football-data/local match results, including `Date`, `HomeTeam`, `AwayTeam`, `FTHG`, `FTAG`, `Season`, `Liga`.

## ASP Diamond — MLB

- Versions: `MLB_V2_1_TEMPORAL_UNCERTAINTY`; handicap shadow contract `MLB_V2_2_HANDICAP_NB_SHADOW`.
- Effective long fields: sport/league filter, `data`, `hora`, `mandante`, `visitante`, `mercado`, `pick`, `linha`, `odd`; `jogo` and consensus/bookmaker fields enrich the row.
- Wide base: `date`, `time`, `home`, `away`.
- Markets: moneyline, totals and run line; offered and median odds remain distinct.
- External history: current, recent and previous MLB team statistics loaded locally with an as-of cutoff.

## ASP Court — NBA

- Version is controlled by the current NBA notebook; the runner does not expose a stable version constant, so the registry uses `NBA_NOTEBOOK_CURRENT` rather than inventing one.
- Required long fields: `data`, `hora`, `liga`, `mandante`, `visitante`, `mercado`, `pick`, `linha`, `odd`; `esporte`, `jogo` and consensus/bookmaker fields are optional.
- Wide base: `date`, `time`, `home`, `away`, `league`.
- Markets: moneyline, totals and paired half-line Asian handicaps.
- External history: NBA notebook/local team history and ratings, always as-of the target date.

## ASP Court W — WNBA

- Version: `BASKETBALL_WNBA_V2_2_ROBUST_GATES`.
- Daily long/wide contract is the basketball contract above.
- Manual/current historical minimum: `data`, `adversario`, `pontos_time`, `pontos_adversario`; optional context includes venue/result/offensive rating/defensive rating/pace.
- External history must pass freshness and no-future-data gates already enforced by the runner.

## Highlightly availability and explicit gaps

The canonical sports and odds tables can supply match identity, schedule, participants, markets, selections, lines, bookmakers, offered odds and observation timestamps. Model-specific historical aggregates, notebook features and any provider not represented in the canonical tables remain explicit external dependencies. A build reports these as lineage or missing-required data; it never substitutes a value implicitly.

This phase creates and seals inputs only. It does not execute a model or publish a prognosis.
