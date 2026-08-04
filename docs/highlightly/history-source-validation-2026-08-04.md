# Highlightly historical source validation — 2026-08-04

## Decision

The direct API is transport-stable for the sampled dates, but broad historical backfill remains blocked. Football and Basketball have usable sampled leagues; WNBA standings remain quarantined; sampled MLB standings are empty despite HTTP 200.

Operational flags remain unchanged:

- `HIGHLIGHTLY_ANALYSIS_ENABLED=false`
- `automatic_publication=false`

No migration, canonical persistence, prediction publication, or source replacement was performed by this audit.

## Scope and grain

- Dates: `2026-08-01`, `2026-06-01`, `2025-08-01`.
- Sports: Football, Basketball, Baseball.
- Match sample: up to two matches per sport/date.
- Detailed fan-out: one match per sport/date.
- Standings: one request per sampled league/season.
- Provider budget: maximum 80 requests; minimum reserve 750.
- Actual usage: 66 requests; quota remaining 7,197 of 7,500.

The evidence artifact is `docs/highlightly/history-source-canary-2026-08-04.json`. It contains endpoint metadata and coverage only, with no API key or raw provider payload.

## Results

All 66 provider requests returned HTTP 200. Match listing succeeded for all three sports on all three dates. Football and Baseball player-statistics probes returned one record each. Basketball player statistics remain outside the current contract because the sampled flow has no Basketball player box-score endpoint.

### Standings coverage

| Sport | League/season | Positions | Quality decision |
|---|---|---:|---|
| Football | Major League Soccer 2026 | 30 | usable in sampled response |
| Football | Primera División - Apertura 2026 | 16 | usable in sampled response |
| Football | Primera B 2026 | 16 | usable in sampled response |
| Football | CONCACAF Caribbean Club Shield 2025 | 0 | unavailable |
| Football | Copa Argentina 2025 | 0 | unavailable; cup standings may be non-applicable |
| Basketball | CEBL 2026 | 10 | usable in sampled response |
| Basketball | Superliga 2026 | 14 | usable in sampled response |
| Basketball | LNB 2025 | 16 | usable in sampled response |
| Basketball | CEBL 2025 | 10 | usable in sampled response |
| Basketball | NBA Women 2026 | 30 | critical corruption; quarantined |
| Basketball | NBA Women 2025 | 26 | provider policy quarantine |
| Baseball | MLB 2026 | 0 | unavailable despite HTTP 200 |
| Baseball | MLB 2025 | 0 | unavailable despite HTTP 200 |

The WNBA 2026 response repeated a single team identity across the standings and triggered `STANDINGS_SINGLE_TEAM_REPEATED`, `STANDINGS_TEAM_DUPLICATED`, and `BASKETBALL_STANDINGS_PROVIDER_QUARANTINED`.

## Quality risks and gates

- Critical: WNBA standings cannot enter canonical data, features, models, or UI.
- High: MLB standings are empty in both sampled seasons, so Baseball backfill cannot require this endpoint without an alternate source or derived standings.
- Medium: zero-row Football cup/tournament standings must be treated as optional rather than silently complete.
- Medium: the sample covers 13 league/seasons, not the provider's full league catalog.

Before broad backfill:

1. Define an explicit allowlist of leagues from business scope.
2. Run this audit for the allowlist across representative dates/seasons.
3. Require non-empty, semantically valid standings for league competitions; keep standings optional for cups, tournaments, and friendlies.
4. Keep WNBA standings quarantined and select an alternate or derived source.
5. Keep MLB standings blocked until the endpoint returns data or an alternate/derived source is approved.
6. Start with a one-day, one-league canary using the existing dry-run, dedupe, quota reserve, and deterministic quality gates.

## Current backfill decision

`BLOCKED_FOR_BROAD_BACKFILL`. A narrow canary may proceed only for explicitly allowlisted Football/Basketball leagues whose sampled standings are non-empty and valid. It must not enable analysis or automatic publication.
