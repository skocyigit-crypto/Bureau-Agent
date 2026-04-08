# Workspace

## Overview

This project is a pnpm workspace monorepo using TypeScript, designed as a comprehensive French-language office/bureau agent application called "Agent de Bureau." Its core purpose is to centralize and manage phone calls, contacts, tasks, and messages for businesses, aiming to enhance productivity and provide advanced analytics through integrated AI.

Key features include full-featured management modules, extensive AI integration for analysis, suggestions, validation, and a multi-agent AI system, comprehensive analytics powered by Gemini AI, and integration with 21 popular business software solutions. The application also supports PWA capabilities and a fully-featured companion native mobile app (Expo) with complete CRUD operations, real-time navigation, and professional UI.

The business vision is to deliver a premium, intelligent office management solution tailored for French-speaking markets, leveraging cutting-edge AI to automate and optimize daily administrative tasks.

## User Preferences

I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the folder `/tanitim/`.
Do not make changes to the file `pnpm-workspace.yaml`.

## System Architecture

The project is structured as a pnpm workspace monorepo, utilizing Node.js 24 and TypeScript 5.9.

**UI/UX Decisions:**
The application features a French UI with a deep navy and warm amber aesthetic, emphasizing clarity and intuitive workflows. `shadcn/ui` and `Recharts` are used for a modern, responsive experience. A centralized `Icon3D` component provides CSS-based 3D icons with customizable colors and sizes for consistent branding across the application.

**Technical Implementations:**
- **Backend:** Developed with Express 5, PostgreSQL, and Drizzle ORM. Zod is used for schema validation, and Orval handles API codegen from an OpenAPI specification. `esbuild` is used for CJS bundling.
- **Frontend:** Built with React, Vite, Tailwind CSS, shadcn/ui, and Recharts.
- **AI Integration:** Leverages Gemini, OpenAI, and Anthropic via Replit AI Integrations for:
    - **Analytics:** Structured insights.
    - **Contextual Suggestions:** Page-level recommendations.
    - **Form Validation:** AI-powered pre-submission checks.
    - **Q&A Assistant:** Natural language queries with database context.
    - **Pattern Recognition:** Cross-entity detection and health scores.
    - **Email Drafting:** AI-powered email generation.
    - **Smart Discovery:** Personalized AI analysis for integration recommendations.
    - **Intelligence Centrale / Assistant Executif:** An executive assistant for specific roles, offering crisis management (RECONNAISSANCE IA), communication drafting (COMMUNICATION), logistics management (LOGISTIQUE), and fiscal alerts (FISCAL & FLASH).
- **Multi-Agent AI System:** Seven specialist agents generate scored reports via Gemini, orchestrated by a "Super Agent IA" using Gemini, OpenAI GPT-5.2, and Anthropic Claude Sonnet 4.6 for comprehensive analysis, verification, and strategic recommendations.
- **Authentication & User Management:** Database-backed system with bcryptjs hashing, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout mechanisms. Admin password sourced from `ADMIN_PASSWORD` env var (no default). Passwordless login fully removed.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables provide tenant isolation. All data tables (contacts, calls, tasks, messages, stock_articles, checkins, calendar_events, users) have `organisation_id` FK. `requireTenant` middleware injects org context; all CRUD routes filter by `organisationId`. Subscription plans: essai (free/14-day trial), starter (29 EUR), professionnel (79 EUR), entreprise (199 EUR). Subscription management API at `/api/subscription/*`. Settings page has "Abonnement" tab with plan comparison, usage meters, and upgrade flow.
- **Organisation Management (Licence Admin):** Super Admin-only page at `/organisations` (sidebar: "Lisans") with full CRUD for client organisations. Create organisation with auto-generated licence key + subscription. Change plans, edit details, activate/deactivate, delete. **Email notification:** On licence creation, sends professional HTML email with licence key, plan info, and app access link via nodemailer (SMTP config: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Resend licence endpoint: `POST /api/organisations/:id/resend-license`. UI has "Envoyer la licence" button per org card. Email service: `artifacts/api-server/src/services/email.ts`. API at `/api/organisations/*`. Each organisation gets a unique licence key (format: `ADB-XXX-HEXHEX`). Stats dashboard shows total/active/trial/paid counts. Routes file: `artifacts/api-server/src/routes/organisations.ts`, UI: `artifacts/buro-ajani/src/pages/organisations.tsx`.
- **Mobile App (Expo):** Full-featured companion mobile app with complete feature parity. Screens: Dashboard (quick actions grid, recent calls, performance stats), Calls (CRUD, search, filter, detail modal, tap-to-call), Contacts (CRUD, category filter, detail with call/email actions), Tasks (CRUD, search, filter, checkbox toggle, priority indicators), Messages (CRUD, type filters, mark-as-read), Calendar (month navigation, event list, create events, contact info), Stock (CRUD, search, status badges, detail view), Analytics (stats, progress bars, response rate), Settings (profile, subscription info, app info). Reusable components: `FAB.tsx` (floating action button), `FormModal.tsx` (bottom-sheet form), `DetailModal.tsx` (detail view with actions). All screens have pull-to-refresh. Navigation from dashboard quick grid and "Plus" tab. Routes: `/(tabs)/index`, `/(tabs)/calls`, `/(tabs)/contacts`, `/(tabs)/tasks`, `/(tabs)/more`, `/messages`, `/calendar`, `/stock`, `/analytics`, `/settings`.
- **PWA Install:** App is installable as a Progressive Web App. `manifest.json`, `sw.js`, and icons are in `artifacts/buro-ajani/public/`. PWA install banner component at `artifacts/buro-ajani/src/components/pwa-install.tsx` shows a bottom sheet prompting users to install the app on their device. Dismissible per session.
- **Security Hardening:** Global `requireAuth` + `requireTenant` middleware in `artifacts/api-server/src/middleware/` protects all API routes except `/healthz` and `/auth/*`. Implements Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, and structured error handling. AI call processing has mutex lock + idempotency guard to prevent duplicate task/event creation. Session pruning enabled (15min interval). Database indexes on all major query columns (calls, contacts, tasks, calendar_events). Dashboard uses resilient `safeQuery` wrapper so one failed DB query doesn't crash the entire dashboard. Frontend ErrorBoundary wraps the app for crash recovery. Orphaned record cleanup on contact/call deletion. Automation engine has graceful shutdown handlers. **No hardcoded secrets:** `ADMIN_PASSWORD` required via env var (no fallback); `SESSION_SECRET` required in production (random key auto-generated in dev only). Server exits on missing secrets in production.
- **Features:**
    - **Core Modules:** Dashboard, Call Management, Contact Management, Task Management, Message Management.
    - **Advanced AI:** Incoming Call Overlay with AI Call Processor (appointment/task creation, sentiment analysis), AI-powered Stock Management (QR/barcode scanning, PDF import, auto-status), and Automation Engine (task/event reminders, inactive contact detection).
    - **Productivity Tools:** Software Integrations catalog, comprehensive Analytics, Settings page with multi-platform integrations (Google Workspace, Microsoft 365, Apple/iCloud), Phone Simulator for mobile preview, and Auto-Backup System to multiple destinations.
    - **Business Workflow (CRM / Gestion):** Modules for Prospects, Devis (quotes with line-item editor and automatic follow-up actions), Factures (invoicing), Chantiers (job site management), and Agenda (appointments).
    - **Performance de l'equipe:** Employee performance analytics page at `/performance`. Per-user metrics from audit logs, checkins, tasks, calls. AI-powered Gemini analysis generates scores (0-100), points forts/amelioration, team recommendations, comparisons, and a joke. DB table: `performance_reports`. Backend: `GET /api/performance/metriques`, `POST /api/performance/rapport`, `GET /api/performance/historique`. Service: `artifacts/api-server/src/services/performance-analyzer.ts`.
    - **Advanced Calendar:** Full-featured calendar with Jour/Semaine/Mois views. Click any time slot to instantly create an appointment. 3-tab form (General/Contact/Options) with contact autocomplete from existing contacts. Stores caller info (name, phone, email, company, notes). Event statuses (confirme/en_attente/annule/reporte), priorities, reminders. Event detail dialog with edit/delete. Current time indicator (red line). DB fields: contactName, contactPhone, contactEmail, contactCompany, contactNotes, status, priority.
    - **Utilities:** Global Search, Theme Toggle (dark/light mode), CSV Export Menu, and an Admin-only Audit Log.
    - **Visuals:** Real Photo Banners integrated across all pages with gradient overlays.
- **Google Workspace OAuth Integration:** Full OAuth2 flow enabling Super Admin credential management, dynamic authorization URL generation, token handling, and self-service configuration.

## External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI Services:** Gemini AI, OpenAI GPT-5.2, Anthropic Claude Sonnet 4.6 (via Replit AI Integrations)
- **API Framework:** Express 5
- **Frontend Libraries:** React, Vite, Tailwind CSS, shadcn/ui, Recharts, framer-motion
- **Validation:** Zod, drizzle-zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Security Middleware:** Helmet
- **Logging:** Pino
- **Google Workspace Services:** Gmail, Calendar, Drive, Docs, Sheets, Meet, Chat, Contacts, Tasks, etc. (26 services)
- **Microsoft 365 Services:** Outlook, Teams, OneDrive, Word, Excel, PowerPoint, SharePoint, etc. (19 services)
- **Apple/iCloud Services:** iCloud Mail, Calendrier iCloud, iCloud Drive, Contacts iCloud, FaceTime, iMessage, etc. (13 services)
- **Third-party Business Software Integrations:** Salesforce, HubSpot, Pipedrive, Slack, Microsoft Teams, Zoom, Trello, Asana, Notion, Jira, Sage, QuickBooks, DocuSign, Dropbox, Mailchimp, Brevo, Zapier, Make, Intercom, Zendesk (21 services)