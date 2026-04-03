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
- **Tableau de bord** (Dashboard) — KPI cards with trend indicators, weekly stats row (answer rate, avg duration, peak hour, weekly calls), hourly performance bar chart, task completion stats with priority breakdown, top contacts list, recent activity feed, quick action buttons (+ Appel, + Tache, Analyse)
- **Appels** (Calls) — Full-featured call log with search, status/direction filters, date range picker, sortable columns (contact, date, status, duration), bulk selection + bulk delete, CSV export, pagination with page controls, color-coded status badges, sentiment badges, creation dialog
- **Contacts** — Professional directory with search, category filter, sortable columns, table/grid view toggle, bulk selection + bulk delete, CSV export, pagination, avatar initials, color-coded category badges, creation dialog
- **Taches** (Tasks) — Dual view: table + Kanban board toggle, search, status/priority filters, sortable columns, bulk selection + bulk delete, overdue highlighting (red), inline status change via dropdown, priority color dots, related contact links, edit dialog, pagination
- **Messages** — Search, read/type/priority filters, bulk mark-read + bulk delete, color-coded type badges (Vocal/Note/Rappel), priority badges, bold unread rows, pagination, creation dialog
- **Analyse** (Analytics) — Comprehensive analytics with Gemini AI insights, area/bar/pie/radar charts, hourly volume, period volume, sentiment distribution, weekly comparison, task stats, call distribution by status/direction, performance radar

### AI Integration
- **Gemini AI** via Replit AI Integrations (no API key needed, billed to credits)
- Endpoint: `POST /ai/analyze` — gathers all analytics data and sends to Gemini 2.5 Flash for structured insights
- Endpoint: `POST /ai/suggest` — page-level contextual suggestions (urgence/amelioration/information/action)
- Endpoint: `POST /ai/validate` — AI-powered form validation with duplicate detection, returns errors/warnings/suggestions per field
- Endpoint: `POST /ai/assistant` — natural language Q&A about office data with real-time DB context
- Endpoint: `GET /ai/status` — check if Gemini AI is available
- Returns (analyze): executive summary, strengths, attention points with recommendations, trends, prioritized actions, global score (0-100)
- **Global AI Assistant Panel**: Floating purple brain button (bottom-right), opens chat panel with quick questions, contextual Q&A, real-time data responses with structured data cards and suggested actions
- **Per-page AI Suggestions**: Each page has an "Intelligence IA disponible" card that triggers page-specific analysis (dashboard briefing, call follow-ups, contact outreach, task priorities, message recommendations)
- **AI Form Validation**: Every create/edit dialog includes a "Verifier IA" button for AI-powered pre-submission checks (duplicate detection, data quality, logical consistency)
- Endpoint: `POST /ai/recognize` — comprehensive pattern recognition: cross-entity detection (missed calls, overdue tasks, VIP contacts, repeat callers, inactive contacts, sentiment analysis, response rate, task completion, urgent messages), health score (0-100), severity-sorted detections
- **AI Recognition Panel**: Auto-loading dashboard panel with dark gradient header, health score gauge, severity summary badges, category filter tabs, scrollable detection list with severity-colored rows, per-detection icons + values + navigation links
- **AI Health Badge**: Persistent header indicator showing global score and critical alert count across all pages
- **Shared Recognition Context**: `RecognitionProvider` wraps layout to share single `/ai/recognize` call between panel and header badge
- Components: `ai-assistant.tsx` (global panel), `ai-suggestions-card.tsx` (per-page cards), `ai-validation-feedback.tsx` (form feedback), `use-ai-validation.ts` (hook), `ai-recognition-panel.tsx` (recognition panel + health badge + context provider)

### API Endpoints
- CRUD: `/calls`, `/contacts`, `/tasks`, `/messages`
- Contact sub-resources: `/contacts/:id/calls`, `/contacts/:id/tasks`
- Dashboard: `/dashboard/summary`, `/dashboard/call-analytics`, `/dashboard/recent-activity`, `/dashboard/call-distribution`, `/dashboard/top-contacts`
- Advanced dashboard: `/dashboard/hourly-performance`, `/dashboard/task-stats`, `/dashboard/weekly-report`, `/dashboard/notifications`
- AI: `POST /ai/analyze`, `POST /ai/suggest`, `POST /ai/validate`, `POST /ai/assistant`, `POST /ai/recognize`, `GET /ai/status`

### Database Tables
- `contacts` — Professional contact directory (categories: client, prospect, fournisseur, partenaire, autre)
- `calls` — Call records with direction, status (repondu/manque/messagerie), duration, sentiment, tags
- `tasks` — Office tasks with status (en_attente/en_cours/termine/annule), priority (haute/moyenne/basse)
- `messages` — Voicemail, notes, reminders with read/unread and priority

### Security Hardening
- **Helmet** — Full security headers: CSP, HSTS (1yr+preload), X-Content-Type-Options, X-Frame-Options, Referrer-Policy, COOP/CORP
- **Rate limiting** — General: 200 req/15min, AI endpoints: 5 req/min, Write operations: 50 req/15min; uses library ipKeyGenerator for proper IPv6 subnet handling
- **CORS** — Restricted methods/headers, credentials support, configurable origins via ALLOWED_ORIGINS env var
- **HPP** — HTTP Parameter Pollution protection
- **Input validation** — Zod schemas on all endpoints, body size limit (1MB)
- **Error handling** — Production mode hides internal error details, structured logging via pino
- **SQL injection** — Drizzle ORM parameterized queries throughout
- **X-Powered-By** — Disabled (no tech stack disclosure)

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
