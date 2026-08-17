# Cloudflare production cutover runbook

Status: production cutover completed. Last verified: 2026-08-17 (America/Sao_Paulo).

## Scope and safety boundary

This runbook promotes the already validated Cloudflare/Supabase/VM architecture from staging to production. It does not migrate data during cutover, enable model publication, delete Lovable resources, or alter mail DNS records. Telegram has been removed from the application runtime.

The production cutover was approved and completed. Keep
`staging.asp-insights.com.br` serving `asp-insights-staging`, retain the Lovable
project and exports only as a temporary rollback source, and keep Highlightly
disabled at rest and subject to its independent quality gate.

## Verified baseline

- Supabase project: `qjcetldbguawmfijuxrq`, region `sa-east-1`, Pro.
- Database: 84 public tables, 96 public functions, 77 user triggers, RLS enabled
  on every public table and no invalid indexes.
- Storage import: 73,694 objects and 155,951,499 bytes; later Highlightly objects remain additive.
- Auth: one active administrator; the historical profile identifier is preserved and `user_id` references point to the active Auth UUID.
- Staging and production: authenticated smoke tests passed for Dashboard,
  Histórico, Base de Dados, Coleta de Odds, Monitor Highlightly, Validação,
  Publicação and Configurações with no visible or browser console errors.
- VM API and systemd timers: active; Highlightly provider flag is false at rest.
- Public application: `asp-insights.com.br` serves the production Cloudflare
  Worker and `www` redirects to the canonical apex domain.

## Auth identity mapping

The migration preserved the historical profile record but not the Auth UUID
literally. Do not attempt to re-key the live user after cutover unless a separate
data migration is designed and tested.

- historical `profiles.id`: `d2038ca5-ae17-40c9-8575-b3b363af5207`;
- active `auth.users.id`: `87b2d283-d453-4942-afde-5b7f6f54145e`;
- `profiles.user_id` points to the active Auth UUID;
- the active user has the `admin` application role.

Verified on 2026-08-17: session persistence after reload, logout, new login,
protected-route access and a single active Auth session.

## Backup and restore inventory

- Supabase Pro physical backups run daily around midnight in the project region.
- Completed backups were visible for 10 through 17 August 2026; the newest
  verified backup was `17 Aug 2026 09:35:41 +0000`.
- Database backups include Storage metadata but do not restore deleted Storage
  object contents.
- The independent Storage recovery artifact remains the verified export of
  73,694 objects and 155,951,499 bytes. New Highlightly objects are additive and
  require a newer export before Lovable retirement.
- Never test restore over production. Use Supabase `Restore to new project` only
  after confirming the additional project cost and a cleanup plan.
- A restore drill passes only after schema counts, Auth mapping, critical row
  counts and read-only application queries match the source snapshot.

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

Do not configure Telegram or Lovable connector secrets; neither is part of the application runtime.

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
6. Keep publication, training and production DNS disabled.

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

### Retirement execution checklist

Do not cancel or delete Lovable before the post-renewal Highlightly observation
window (18-24 August 2026 UTC) is reviewed on or after 25 August 2026.

1. Create a fresh database recovery point and a fresh incremental Storage export.
2. Export Cloudflare DNS and record the active Worker version and secret names.
3. Confirm staging and production login, protected routes, VM bridge persistence
   and provider-disabled-at-rest behavior once more.
4. Search the deployed code and Worker logs for Lovable hosts/connectors.
5. Revoke Lovable-only tokens, connector credentials and deployment access.
6. Cancel recurring Lovable billing only after steps 1-5 pass.
7. Keep the source export and rollback documentation offline; do not delete the
   Lovable project in the same operation as billing cancellation.
