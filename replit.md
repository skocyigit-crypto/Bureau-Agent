# Overview

This project is a TypeScript-based pnpm monorepo for "Agent de Bureau," a French-language office agent application. Its primary goal is to centralize and manage phone calls, contacts, tasks, and messages for businesses, significantly enhancing productivity through advanced AI integration and comprehensive analytics. The application features full-featured management modules, extensive AI capabilities for analysis, suggestions, and validation, and a multi-agent AI system. It also integrates with 21 popular business software solutions, offers PWA capabilities, and includes a companion native mobile app (Expo) with complete CRUD operations, real-time navigation, and a professional UI. The vision is to deliver a premium, intelligent office management solution tailored for French-speaking markets, leveraging cutting-edge AI to automate and optimize daily administrative tasks.

# User Preferences

I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the folder `/tanitim/`.
Do not make changes to the file `pnpm-workspace.yaml`.

# System Architecture

The project is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9.

## UI/UX Decisions
The application features a French UI with a deep navy and warm amber color scheme, prioritizing clarity and intuitive workflows. `shadcn/ui` and `Recharts` are used for a modern, responsive experience, complemented by a centralized `Icon3D` component for consistent branding.

## Technical Implementations
- **Backend:** Express 5, PostgreSQL, Drizzle ORM, Zod for validation, Orval for API codegen, and `esbuild` for CJS bundling.
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui, and Recharts.
- **AI Integration:** Leverages Gemini, OpenAI, and Anthropic for analytics, contextual suggestions, form validation, Q&A assistance, pattern recognition, email drafting, smart discovery, and an "Intelligence Centrale / Assistant Executif" for specialized tasks like crisis management, communication, logistics, and fiscal alerts.
- **Multi-Agent AI System:** Ten specialist agents covering every office role (Appels, CRM, Productivite, Communication, Presences, Facturation, Stock, RH, Securite, Performance) generate scored reports with deep data analysis. Orchestrated by a "Super Agent IA" using Gemini, OpenAI GPT-5.2, and Anthropic Claude Sonnet 4.6 for comprehensive cross-domain analysis, correlation detection, and strategic recommendations. Each agent acts as a real office employee (e.g., Agent RH = DRH, Agent Facturation = Controleur Financier, Agent Securite = RSSI).
- **Oto-Pilot IA (Self-Improving Auto-Pilot):** Autonomous AI system that continuously monitors, diagnoses, and auto-corrects the entire platform. Features: parallel multi-AI diagnostics (Gemini anomaly detection + OpenAI process optimization + Anthropic risk analysis), consensus scoring, automatic fixes (orphan call linking, overdue task escalation, stuck task flagging with duplicate-guard), real-time log journal, 30-minute surveillance cycles with race condition guards. All schedulers (auto-run + autopilot) are org-scoped via `Map<orgId>` to prevent cross-tenant interference. Endpoints: `POST /ai/autopilot/run|start|stop`, `GET /ai/autopilot/status|logs`. UI: "Oto-Pilot" tab in AI Agents page with status cards, AI diagnostic panels, issue/fix lists, predictions, and live log viewer.
- **Authentication & User Management:** Database-backed system with bcryptjs, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables ensure tenant isolation. All data tables include an `organisation_id` FK, and a `requireTenant` middleware enforces organizational context. Subscription plans (essai, starter, professionnel, entreprise) are managed via an API and a dedicated settings page.
- **Organisation Management (Licence Admin):** A Super Admin-only interface for full CRUD operations on client organizations. This includes creating organizations with auto-generated license keys, subscriptions, and admin users, with an automated onboarding flow that sends secure login credentials via email (using nodemailer).
- **Mobile App (Expo):** A full-featured companion mobile app with complete feature parity, including screens for Dashboard, Calls, Contacts, Tasks, Messages, Calendar, Stock, Analytics, AI Agents, Automations, Check-ins, Users, Audit Log, Integrations, Organisations (Super Admin), and Admin Reports. It utilizes reusable components like `FAB.tsx` and `FormModal.tsx`.
- **Admin Reports System:** Organisation administrators can submit reports/requests to the platform super admin, managed via a dedicated API and UI.
- **PWA Install:** The application is installable as a Progressive Web App, with a dismissible in-app prompt for installation. Full offline-capable service worker with stale-while-revalidate caching strategy.
- **Onboarding Wizard:** First-login experience with a 4-step configuration wizard: Welcome → Install (PWA/mobile) → Integration Discovery (select from 20+ business tools) → Ready. Stored in localStorage per user. Skippable.
- **Email System:** Gmail API via Replit Google Mail connector (primary), SMTP fallback. License emails include PWA install instructions, mobile download guidance, and integration discovery notice.
- **Gmail Integration:** Uses `googleapis` package with Replit connector SDK for OAuth token management. Connector: `conn_google-mail_01KNRVNK046999PTYSKSGR9HHV`. Never cache the Gmail client (tokens expire).
- **Security Hardening:** Global `requireAuth` and `requireTenant` middleware protect API routes. Implementations include Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, structured error handling, mutex locks for AI processing, session pruning, database indexing, resilient dashboard queries, and frontend ErrorBoundary. Production environments enforce strict secret management. All AI routes enforce organization-scoped queries. Performance endpoints (`/api/performance/*`) are org-scoped. Audit log writes have error logging (no silent failures). Foreign key references defined on `messages.contactId`, `calendar_events.createdBy/relatedContactId/relatedTaskId`, `audit_logs.userId`, `performance_reports.userId`. All timestamps use `withTimezone: true` consistently. Comprehensive DB indexes on `audit_logs` (user_id, action, resource, created_at), `messages` (contact_id), `ai_agent_reports` (org_id, agent_id, report_date, created_at), `performance_reports` (user_id, org_id, periode, created_at), `calendar_events` (created_by). Google OAuth config endpoint returns volatile config warning.
- **Features:**
    - **Core Modules:** Dashboard, Call, Contact, Task, and Message Management.
    - **Advanced AI:** Incoming Call Overlay with AI Call Processor, AI Phone Agent "Sophie" (auto-answer with Gemini AI conversation, intent detection, auto-task/appointment creation), AI-powered Stock Management, and Automation Engine.
    - **Productivity Tools:** Software Integrations catalog with AI Smart Discovery (auto-detects platforms, industry, and recommends integrations via Gemini AI), comprehensive Analytics, Settings with multi-platform integrations (Google Workspace, Microsoft 365, Apple/iCloud), Phone Simulator, and Auto-Backup.
    - **Business Workflow (CRM / Gestion):** Modules for Prospects, Devis (quotes), Factures (invoicing), Chantiers (job site management), and Agenda (appointments).
    - **Performance de l'equipe:** Employee performance analytics page with AI-powered Gemini analysis generating scores and recommendations.
    - **Advanced Calendar:** Full-featured calendar with Day/Week/Month views, direct appointment creation, contact autocomplete, event statuses, priorities, and reminders.
    - **Utilities:** Global Search, Theme Toggle, CSV Export, and Admin-only Audit Log.
    - **Visuals:** Real Photo Banners with gradient overlays across all pages.
- **Google Workspace OAuth Integration:** Full OAuth2 flow for credential management, dynamic authorization, token handling, and self-service configuration.
- **Google Agenda → Pointage Sync:** API endpoint to sync Google Calendar events with check-in records, with a UI button for date-range selection and import.
    - **Google Workspace Auto-Pointage:** Background service (`google-auto-pointage.ts`) that runs every 30 minutes, automatically creating check-in records from Google Calendar events for all users with valid OAuth tokens. Tagged with `[google-auto]` in notes. Mobile checkins screen shows auto-synced entries with a Google Workspace badge and "Auto" chip. Gracefully disabled when Google OAuth credentials are not configured.
- **Usage-Based Billing System:** Integrated into the Organisations/Licence management area (Super Admin). DB tables: `invoices` and `payments`. Features:
    - **Forfait-linked invoicing:** Monthly invoice generation based on each customer's plan limits (users, contacts, calls) with automatic overage calculation (extra users: 10 EUR/each, extra contacts: 2 EUR/100, extra calls: 3 EUR/100).
    - **Usage snapshot:** Each invoice stores a frozen snapshot of usage vs. plan limits at generation time.
    - **Billing tab:** New "Facturation" tab in the Organisations page with global billing stats (total due, paid, overdue, pending payments).
    - **Per-org billing detail:** Dialog showing invoice history, usage bars, overage breakdown, and manual status updates (payee/retard/annulee).
    - **Bank statement import:** Super Admin can paste bank statement lines (CSV format) to import payments.
    - **Automatic payment matching:** Algorithm matches payments to invoices based on amount, payer name, and reference similarity.
    - **Usage bars in org cards:** Visual progress bars showing current usage vs. forfait limits directly in each organisation card (real-time contact/call counts from DB).
    - API routes: `GET/POST /api/billing/*` (super_admin only). Service: `billing-engine.ts`.
- **Legal Compliance System:** Full legal rights management for licensed customers, integrated as a "Juridique" tab in the Organisations page (Super Admin). Features:
    - **7 legal documents** tracked: CGU, CGV, RGPD, DPA, SLA, Propriete Intellectuelle, Securite. 5 mandatory, 2 optional.
    - **Per-org compliance tracking:** DB table `legal_agreements` records who accepted which document, when, from which IP, with version tracking.
    - **Compliance dashboard:** KPI cards (compliant/non-compliant/rate/documents), alert banner for non-compliant orgs, progress bars per org.
    - **Document detail dialog:** Accept/revoke individual documents per org, accept all at once, full audit trail (signer name, date, IP).
    - **Legal document catalog:** Visual reference of all required documents with categories and mandatory/optional badges.
    - API routes: `GET/POST /api/legal/*` (super_admin only). Schema: `legal-agreements.ts`.
- **Google Drive Secure Backup:** Encrypted backup service that uploads full database exports to Google Drive with military-grade security. Features:
    - **AES-256-GCM encryption:** All data is encrypted before upload with a derived key (SHA-256). Each backup includes IV, auth tag, and dual integrity checksums (original + encrypted).
    - **Full database export:** 16 tables exported (organisations, users, contacts, calls, tasks, messages, checkins, stock, automations, invoices, payments, legal_agreements, etc.).
    - **Envelope format:** `.adb.enc` files with JSON envelope containing encryption metadata, integrity hashes, and base64-encoded encrypted data.
    - **Automatic scheduling:** Runs every 6 hours when Google OAuth is configured. Gracefully disabled when not configured.
    - **Google Drive folder management:** Auto-creates "Agent de Bureau - Sauvegardes" folder. Auto-cleans files older than retention period (90 days).
    - **Frontend UI:** Dedicated "Sauvegarde Google Drive" card in Settings > Sauvegardes tab with manual trigger, Drive file listing, backup history, stats, and security info.
    - API routes: `GET/POST /api/google-drive-backup/*` (super_admin only). Service: `google-drive-backup.ts`.

# External Dependencies

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
- **Google Workspace Services:** Gmail, Calendar, Drive, Docs, Sheets, Meet, Chat, Contacts, Tasks, etc.
- **Microsoft 365 Services:** Outlook, Teams, OneDrive, Word, Excel, PowerPoint, SharePoint, etc.
- **Apple/iCloud Services:** iCloud Mail, Calendrier iCloud, iCloud Drive, Contacts iCloud, FaceTime, iMessage, etc.
- **Third-party Business Software Integrations:** Salesforce, HubSpot, Pipedrive, Slack, Microsoft Teams, Zoom, Trello, Asana, Notion, Jira, Sage, QuickBooks, DocuSign, Dropbox, Mailchimp, Brevo, Zapier, Make, Intercom, Zendesk.