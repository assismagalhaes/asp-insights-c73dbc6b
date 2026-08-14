# Cloudflare migration — Phase 1 baseline

Status: staging deployed and authenticated smoke tests complete; production remains unbound.

## Target architecture

- Cloudflare Workers: TanStack Start SSR, static assets and server functions.
- Supabase: managed Postgres, Auth and current Storage.
- Magalu VM: FastAPI, Python models, scrapers and long-running jobs.
- Cloudflare DNS: application and API subdomains, SSL and traffic protection.

## Lovable coupling status

| Area | Current dependency | Migration action |
| --- | --- | --- |
| Build/runtime | `@lovable.dev/vite-tanstack-config` | Replaced with official TanStack, React, Tailwind and Cloudflare Vite plugins. |
| Development MCP | `@lovable.dev/mcp-js` and `.lovable/mcp` | Removed from the application runtime and dependency graph. |
| Highlightly ingest | `HIGHLIGHTLY_INGEST_BRIDGE_URL` points to the hosted app | Repoint the VM to the staging Worker hook, then production. |
| Telegram | Previously used the Lovable connector gateway | Removed by product decision; historical database records are preserved without active runtime routes or jobs. |
| Naming only | Python exports and model functions containing `lovable` | Keep initially; these are data-contract names, not hosting dependencies. Rename later if useful. |

## Environment contract

Public build-time configuration:

- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Server-only configuration/secrets:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SCRAPER_API_URL`
- `SCRAPER_API_KEY`
- `HIGHLIGHTLY_INGEST_BRIDGE_SECRET`
- `FIRECRAWL_API_KEY`
- `GOOGLE_AI_API_KEY`

Never place `SUPABASE_SERVICE_ROLE_KEY`, VM credentials, AI keys or connector keys in a `VITE_*` variable.

## Server workload inventory

- One public hook: Highlightly ingest.
- Scraper/model server functions call the Magalu VM and include long timeouts.
- AI validation server functions call Google AI and Firecrawl.
- Authenticated server functions read and write Supabase using publishable or service-role clients depending on operation.
- There are 184 local Supabase migrations; the migration does not replace or recreate the database.

## Deployment environments

1. `asp-insights-staging`: isolated Worker URL and secrets; no production DNS.
2. `asp-insights`: reserved production Worker configuration. Do not deploy or bind the apex domain until the cutover gate is explicitly approved.

Secrets must be configured separately in both environments. Deployments must not overwrite dashboard-managed secrets.

## Acceptance gates before DNS cutover

- Clean official Cloudflare build without either Lovable build package.
- Lint, TypeScript, unit tests, AI release gates and Python tests pass.
- Auth login, logout, refresh and protected-route behavior pass in staging.
- Supabase reads/writes and RLS behavior match production.
- Scraper job create, polling, raw/normalized/CSV downloads and model execution pass.
- Highlightly bridge canary reaches staging without enabling analysis or automatic publication.
- Telegram UI, jobs, hooks and connector secrets are absent.
- Worker logs contain no leaked secrets or sensitive payloads.
- Rollback to the Lovable URL is tested before changing the primary DNS record.

## Rollback

- Keep the current Lovable deployment and secrets unchanged during staging.
- Record the previous DNS target before cutover.
- Switch only the application DNS record; do not migrate Supabase or VM data during the hosting cutover.
- If auth, server functions or bridge health fail, restore the previous DNS target and stop persistent Highlightly work.

## Completed implementation package

1. Pinned `wrangler` and `@cloudflare/vite-plugin` in `bun.lock`.
2. Replaced the Lovable Vite preset with explicit official plugins while preserving `src/server.ts`.
3. Added `wrangler.jsonc` with `nodejs_compat`, staging isolation and observability.
4. Added Cloudflare build and deployment dry-run checks to CI; CI does not deploy.
5. Passed TypeScript, lint, 120 frontend tests, 80 AI release gates, 743 Python tests, the Cloudflare build and Wrangler dry-run.

## Current verified staging state (2026-08-13)

- Cloudflare account, `asp-insights-staging` Worker and `staging.asp-insights.com.br` are active.
- Supabase project `qjcetldbguawmfijuxrq` is active in `sa-east-1` on the Pro plan.
- Database, Auth and Storage were reconciled; the imported Storage snapshot has 73,694 objects and 155,951,499 bytes.
- Authenticated smoke tests passed on all application routes without browser console errors.
- The VM-to-Cloudflare Highlightly bridge persists data in the new Supabase project.
- Highlightly remains disabled at rest; Telegram was removed from the application runtime.
- The apex `asp-insights.com.br` has no public A/AAAA application target and `www` is not defined. Production is therefore not cut over.

## Next controlled step

Use `docs/cloudflare-production-cutover-runbook.md`. Preparation and dry-runs are allowed now; production Worker deployment, custom-domain binding and apex/`www` DNS changes remain a separate approval gate.
