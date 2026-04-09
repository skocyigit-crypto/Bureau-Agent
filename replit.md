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
- **Multi-Agent AI System:** Seven specialist agents generate scored reports, orchestrated by a "Super Agent IA" using Gemini, OpenAI GPT-5.2, and Anthropic Claude Sonnet 4.6 for comprehensive analysis and recommendations.
- **Authentication & User Management:** Database-backed system with bcryptjs, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables ensure tenant isolation. All data tables include an `organisation_id` FK, and a `requireTenant` middleware enforces organizational context. Subscription plans (essai, starter, professionnel, entreprise) are managed via an API and a dedicated settings page.
- **Organisation Management (Licence Admin):** A Super Admin-only interface for full CRUD operations on client organizations. This includes creating organizations with auto-generated license keys, subscriptions, and admin users, with an automated onboarding flow that sends secure login credentials via email (using nodemailer).
- **Mobile App (Expo):** A full-featured companion mobile app with complete feature parity, including screens for Dashboard, Calls, Contacts, Tasks, Messages, Calendar, Stock, Analytics, AI Agents, Automations, Check-ins, Users, Audit Log, Integrations, Organisations (Super Admin), and Admin Reports. It utilizes reusable components like `FAB.tsx` and `FormModal.tsx`.
- **Admin Reports System:** Organisation administrators can submit reports/requests to the platform super admin, managed via a dedicated API and UI.
- **PWA Install:** The application is installable as a Progressive Web App, with a dismissible in-app prompt for installation.
- **Security Hardening:** Global `requireAuth` and `requireTenant` middleware protect API routes. Implementations include Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, structured error handling, mutex locks for AI processing, session pruning, database indexing, resilient dashboard queries, and frontend ErrorBoundary. Production environments enforce strict secret management. All AI routes enforce organization-scoped queries.
- **Features:**
    - **Core Modules:** Dashboard, Call, Contact, Task, and Message Management.
    - **Advanced AI:** Incoming Call Overlay with AI Call Processor, AI-powered Stock Management, and Automation Engine.
    - **Productivity Tools:** Software Integrations catalog, comprehensive Analytics, Settings with multi-platform integrations (Google Workspace, Microsoft 365, Apple/iCloud), Phone Simulator, and Auto-Backup.
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
    - **Usage bars in org cards:** Visual progress bars showing current usage vs. forfait limits directly in each organisation card.
    - API routes: `GET/POST /api/billing/*` (super_admin only). Service: `billing-engine.ts`.

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