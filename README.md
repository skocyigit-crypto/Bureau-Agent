# Ajant Bureau

Multi-tenant BTP (construction/office) management SaaS: CRM, telephony, tasks,
invoicing, project management, and AI-powered office automation, in a French-
speaking market. Built and operated by SK GROUP (Haguenau, France).

## Structure

pnpm workspace monorepo:

- `artifacts/api-server` — Express + Drizzle ORM backend (the production API)
- `artifacts/buro-ajani` — React web frontend (main customer-facing app)
- `artifacts/mobile` — Expo/React Native mobile app (iOS/Android)
- `artifacts/tanitim` — public marketing site
- `lib/db` — shared Drizzle ORM schema package
- `apps/api-py` — early-stage FastAPI rewrite of the backend (not deployed,
  in-progress; the live API is still `artifacts/api-server`)
- `deploy/` — deployment configs; current production runs on **Google Cloud
  Run** via `deploy/cloudbuild.yaml` + `deploy/gcp-deploy.sh` (the other
  deploy guides at the repo root — `MIGRATION.md`, `DEPLOY_IONOS.md`,
  `DEPLOY_GITHUB.md` — describe alternative self-hosting targets, not the
  current live setup)
- `scripts/` — one-off maintenance/utility scripts

## Getting started

```bash
pnpm install
pnpm dev          # local development
pnpm build        # build all packages
pnpm typecheck    # typecheck all packages
pnpm db:push      # apply Drizzle schema changes
```

See `deploy/.env.example` for required environment variables.

## Running the tests

```bash
pnpm db:setup-test   # once: create + migrate the local test database
pnpm test            # run every package's suite
```

Most suites need nothing. The API server has 19 files that exercise the
database itself; without a database they all fail on import with
`DATABASE_URL must be set`, which is a missing local database and not a
regression.

`setup-test-db` creates a dedicated, disposable `bureau_agent_test` database
and loads the schema into it. It is idempotent and never drops anything. The
dedicated database matters: **these tests truncate tables**, so they must
never point at a working database. To start over, drop it yourself and re-run
the command.

`vitest.config.ts` defaults `DATABASE_URL` to that database when the variable
is unset, so the command above is all the setup there is. The default cannot
hide a misconfiguration: CI supplies its own `DATABASE_URL`, and when `CI` is
set without one the default is deliberately withheld so the explicit error
surfaces instead of an obscure connection refusal.

## Documentation

- [`Ajant_Bureau_Kullanma_Kilavuzu.md`](Ajant_Bureau_Kullanma_Kilavuzu.md) — end-user manual (Turkish)
- [`replit.md`](replit.md) — architecture notes and Replit dev-environment workflow
- [`AI_AUTOMATION_ROADMAP.md`](AI_AUTOMATION_ROADMAP.md) — running log of the AI-automation initiative
