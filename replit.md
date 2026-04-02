# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui

## Application: Agent de Bureau

A comprehensive French-language office/bureau agent application for managing phone calls, contacts, tasks, and messages. All UI is in French (France).

### Features
- **Tableau de bord** (Dashboard) — Overview with call stats, recent activity, top contacts
- **Appels** (Calls) — Incoming/outgoing call management, status tracking, sentiment analysis
- **Contacts** — Professional directory with categories (client, prospect, fournisseur, partenaire)
- **Taches** (Tasks) — Office task management with priorities and statuses
- **Messages** — Voicemail and notes management with read/unread tracking
- **Analyse** (Analytics) — Call performance charts, distribution analysis, trends

### Database Tables
- `contacts` — Professional contact directory
- `calls` — Call records with direction, status, duration, sentiment, tags
- `tasks` — Office tasks with status, priority, assignments
- `messages` — Voicemail, notes, reminders

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
