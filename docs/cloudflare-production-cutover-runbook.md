# Cloudflare production cutover runbook

Status: prepared, not executed. Last verified: 2026-08-13 (America/Sao_Paulo).

## Scope and safety boundary

This runbook promotes the already validated Cloudflare/Supabase/VM architecture from staging to production. It does not migrate data during cutover, enable Telegram, enable model publication, delete Lovable resources, or alter mail DNS records.

Production changes require a separate explicit approval. Until then:

- keep `staging.asp-insights.com.br` serving `asp-insights-staging`;
- do not deploy the default `asp-insights` Worker;
- do not bind `asp-insights.com.br` or `www.asp-insights.com.br`;
- keep the Lovable project and exports available for rollback;
- keep Highlightly disabled at rest and subject to its quality gate.

## Verified baseline

- Supabase project: `qjcetldbguawmfijuxrq`, region `sa-east-1`, Pro.
- Database: 84 public tables, 8 security-invoker views and 366 valid indexes.
- Storage import: 73,694 objects and 155,951,499 bytes; later Highlightly objects remain additive.
- Auth: one active administrator; the historical profile identifier is preserved and `user_id` references point to the active Auth UUID.
- Staging: authenticated smoke tests passed for all 14 protected routes with no browser console errors.
- VM API and systemd timers: active; Highlightly provider flag is false at rest.
- Public DNS baseline: apex has no application A/AAAA answer; `www` is NXDOMAIN; staging is proxied through Cloudflare.

## Production environment contract

Configure these independently for the production Worker. Never copy them into `VITE_*` variables unless explicitly listed as public.

Public build/runtime values:

- `SUPABASE_PROJECT_ID`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Server-only secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SCRAPER_API_URL`
- `SCRAPER_API_KEY`
- `HIGHLIGHTLY_INGEST_BRIDGE_SECRET`
- `FIRECRAWL_API_KEY`
- `GOOGLE_AI_API_KEY`

Do not configure Telegram/Lovable connector secrets unless Telegram is explicitly re-enabled in a later project decision.

## Pre-deployment gate

1. Confirm the Highlightly observation gate separately. Low odds coverage does not block hosting migration, but it blocks source promotion.
2. Run focused tests, full unit tests, TypeScript, lint, Python tests, Cloudflare build and both dry-runs.
3. Review the exact Git diff and deploy only a committed, reproducible revision.
4. Confirm production Worker secrets by name only; never print their values.
5. Confirm the VM bridge continues pointing to staging until production smoke tests pass.
6. Record a fresh DNS export from Cloudflare, including MX, SPF, DKIM and DMARC records.
7. Confirm a downloadable Supabase backup or an independent `pg_dump` immediately before cutover.

## Deployment gate (no public DNS yet)

1. Deploy the default `asp-insights` Worker to its `workers.dev` address.
2. Test unauthenticated redirect behavior and authenticated login/session refresh.
3. Test Dashboard, Histórico, Central Esportiva, Base de Dados, Coleta and Monitor Highlightly.
4. Verify Worker logs contain no secrets, authorization headers or sensitive payloads.
5. Point a single VM bridge canary at the production hook, verify persistence, then restore the bridge to staging.
6. Keep publication, training, Telegram and production DNS disabled.

## Public cutover gate

Only after the deployment gate passes:

1. Bind `asp-insights.com.br` to the validated production Worker.
2. Bind `www.asp-insights.com.br` and redirect it permanently to the apex.
3. Do not alter MX, SPF, DKIM, DMARC or unrelated subdomains.
4. Validate DNS, TLS, security headers, login, protected routes and server-side calls from two independent resolvers/networks.
5. Monitor Worker errors, Supabase API/Auth logs and VM health for at least 60 minutes.

## Rollback triggers

Rollback immediately if any of these occur after public cutover:

- login, refresh or protected-route failures;
- persistent Worker 5xx errors;
- Supabase writes going to the wrong project;
- VM bridge authentication or persistence failure;
- secrets or authorization data appearing in logs;
- material regression in Dashboard, Histórico or Central Esportiva.

## Rollback procedure

1. Remove the apex and `www` Worker custom-domain bindings or restore their exact pre-cutover DNS values from the fresh export.
2. Keep Supabase and Storage intact; do not roll back data destructively.
3. Point the VM bridge back to the last verified staging/Lovable endpoint, then restart only the affected systemd service if required.
4. Confirm Highlightly is false at rest and no duplicate worker is running.
5. Re-run login and data-read smoke tests on the restored endpoint.
6. Preserve logs and the failed deployment revision for diagnosis.

## Lovable retirement gate

Lovable can be cancelled only after the public site remains healthy through the agreed observation period and all of the following are independently available:

- database backup and restore instructions;
- verified Storage export;
- working Auth recovery flow;
- source repository and reproducible Cloudflare build;
- DNS export and rollback record;
- no remaining runtime calls to Lovable-hosted APIs or connectors.
