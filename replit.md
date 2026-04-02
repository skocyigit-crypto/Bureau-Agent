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
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Recharts

## Application: Agent de Bureau

A comprehensive French-language office/bureau agent application for managing phone calls, contacts, tasks, and messages. All UI is in French (France). Design: deep navy sidebar, warm amber accents.

### Features
- **Tableau de bord** (Dashboard) — Overview with call stats, weekly report, hourly performance heatmap, notification bell, recent activity, top contacts
- **Appels** (Calls) — Call management with creation dialog, clickable rows, call detail page (/appels/:id), sentiment badges
- **Contacts** — Professional directory with creation/edit dialog, clickable rows, contact detail page (/contacts/:id) with call history + related tasks tabs
- **Taches** (Tasks) — Task management with creation/edit dialogs, inline status changes, related contact links
- **Messages** — Voicemail and notes with creation dialog, read/unread toggle, visual unread indicators
- **Analyse** (Analytics) — Comprehensive analytics with Gemini AI insights, area/bar/pie/radar charts, hourly volume, period volume, sentiment distribution, weekly comparison, task stats, call distribution by status/direction, performance radar

### AI Integration
- **Gemini AI** via Replit AI Integrations (no API key needed, billed to credits)
- Endpoint: `POST /ai/analyze` — gathers all analytics data and sends to Gemini 2.5 Flash for structured insights
- Returns: executive summary, strengths, attention points with recommendations, trends, prioritized actions, global score (0-100)
- Frontend: Purple gradient "Analyse IA Gemini" button, results in tabbed card (Resume, Forces & Attention, Tendances, Actions)

### API Endpoints
- CRUD: `/calls`, `/contacts`, `/tasks`, `/messages`
- Contact sub-resources: `/contacts/:id/calls`, `/contacts/:id/tasks`
- Dashboard: `/dashboard/summary`, `/dashboard/call-analytics`, `/dashboard/recent-activity`, `/dashboard/call-distribution`, `/dashboard/top-contacts`
- Advanced dashboard: `/dashboard/hourly-performance`, `/dashboard/task-stats`, `/dashboard/weekly-report`, `/dashboard/notifications`
- AI: `POST /ai/analyze`, `GET /ai/status`

### Database Tables
- `contacts` — Professional contact directory (categories: client, prospect, fournisseur, partenaire, autre)
- `calls` — Call records with direction, status (repondu/manque/messagerie), duration, sentiment, tags
- `tasks` — Office tasks with status (en_attente/en_cours/termine/annule), priority (haute/moyenne/basse)
- `messages` — Voicemail, notes, reminders with read/unread and priority

### Important Patterns
- When using Drizzle SQL template literals with `to_char`, do NOT pass format strings as parameters — use inline SQL template literals like `sql\`to_char(col, 'Dy')\`` to avoid parameterized query issues with PostgreSQL
- Import hooks from `@workspace/api-client-react`, never relative paths
- Hooks return T directly (not wrapped in { data: T })
- Query hook options: `useGetCall(id, { query: { enabled: !!id } })`
- Mutation onSuccess receives T directly

## Promotional Landing Page (Site Vitrine)

A separate React+Vite artifact at `/tanitim/` — a premium SaaS marketing landing page for Agent de Bureau. Presentation-first, no backend. Deep navy (#1a2744) + amber (#f59e0b) brand colors, all text in French. Uses framer-motion for scroll animations, AI-generated product visuals and testimonial portraits.

### Landing Page Sections (14 total)
1. Hero with animated headline + dual CTA
2. Dashboard preview mockup image
3. Trust/social proof logo bar (CSS marquee scroll)
4. Animated statistics counters (2500+ bureaux, 1.2M+ appels, 98.5% satisfaction, 24/7)
5. Comprehensive features grid (8 feature cards)
6. Feature deep-dive: Call management (split layout)
7. Feature deep-dive: Analytics/dashboard (split layout)
8. "Comment ca marche" — 4-step how-it-works with visual timeline
9. Pricing section (3 tiers: Essentiel 29EUR, Professionnel 59EUR, Entreprise sur devis)
10. Testimonials with AI-generated portrait images (3 Paris professionals)
11. Integrations section (Outlook, Google, Teams, Salesforce, Slack, Zoom)
12. FAQ accordion (6 questions)
13. Security/compliance badges (RGPD, SSL, France hosting, ISO 27001)
14. Final CTA + newsletter form

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
