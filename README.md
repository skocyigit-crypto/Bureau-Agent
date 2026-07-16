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

## Documentation

- [`Ajant_Bureau_Kullanma_Kilavuzu.md`](Ajant_Bureau_Kullanma_Kilavuzu.md) — end-user manual (Turkish)
- [`replit.md`](replit.md) — architecture notes and Replit dev-environment workflow
- [`AI_AUTOMATION_ROADMAP.md`](AI_AUTOMATION_ROADMAP.md) — running log of the AI-automation initiative
