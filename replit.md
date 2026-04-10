# Overview

"Agent de Bureau" is a TypeScript-based pnpm monorepo for a French-language office agent application. Its core purpose is to centralize and manage phone calls, contacts, tasks, and messages for businesses, significantly boosting productivity through advanced AI integration and comprehensive analytics. The application features full-featured management modules, extensive AI capabilities for analysis, suggestions, and validation, and a multi-agent AI system. It also integrates with 21 popular business software solutions, offers PWA capabilities, and includes a companion native mobile app (Expo) with complete CRUD operations and real-time navigation. The vision is to deliver a premium, intelligent office management solution tailored for French-speaking markets, leveraging cutting-edge AI to automate and optimize daily administrative tasks.

# User Preferences

I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the folder `/tanitim/`.
Do not make changes to the file `pnpm-workspace.yaml`.

# System Architecture

The project is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9.

## UI/UX Decisions
The application features a French UI with a deep navy and warm amber color scheme, built using `shadcn/ui` and `Recharts` for a modern, responsive experience. A centralized `Icon3D` component ensures consistent branding.

## Technical Implementations
- **Backend:** Express 5, PostgreSQL, Drizzle ORM, Zod for validation, Orval for API codegen, and `esbuild` for CJS bundling.
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui, and Recharts.
- **AI Integration:** Leverages Gemini, OpenAI, and Anthropic for analytics, contextual suggestions, form validation, Q&A assistance, pattern recognition, email drafting, smart discovery, and an "Intelligence Centrale / Assistant Executif" for specialized tasks.
- **Multi-Agent AI System:** Ten specialist agents cover various office roles, generating scored reports with deep data analysis. A "Super Agent IA" orchestrates these agents using Gemini, OpenAI GPT-5.2, and Anthropic Claude Sonnet 4.6 for cross-domain analysis and strategic recommendations.
- **Oto-Pilot IA (Self-Improving Auto-Pilot):** An autonomous AI system that continuously monitors, diagnoses, and auto-corrects the platform. It features parallel multi-AI diagnostics, consensus scoring, automatic fixes, real-time log journaling, and 30-minute surveillance cycles. All schedulers are organization-scoped.
- **Authentication & User Management:** Database-backed system with bcryptjs, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables ensure tenant isolation. All data tables include an `organisation_id` foreign key, and a `requireTenant` middleware enforces organizational context. Subscription plans are managed via an API and settings page.
- **Organisation Management (Licence Admin):** A Super Admin-only interface for full CRUD operations on client organizations, including creation with auto-generated license keys, subscriptions, and admin users, with automated onboarding via email.
- **Mobile App (Expo):** A full-featured companion mobile app with complete feature parity, including key modules like Dashboard, Calls, Contacts, Tasks, Messages, Calendar, Stock, Analytics, and AI Agents.
- **Admin Reports System:** Organisation administrators can submit reports/requests to the platform super admin via a dedicated API and UI.
- **PWA Install:** The application is installable as a Progressive Web App, with an in-app prompt and full offline capabilities using a service worker with stale-while-revalidate caching.
- **Onboarding Wizard:** A 4-step first-login configuration wizard for Welcome, App Installation, Integration Discovery, and Ready. Skippable and stored in localStorage.
- **Email System:** Primarily uses the Gmail API via Replit Google Mail connector, with SMTP as a fallback.
- **Security Hardening (9-Layer Protection):** Global `requireAuth` and `requireTenant` middleware protect API routes. Implementations include Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, structured error handling, mutex locks for AI processing, session pruning, database indexing, resilient dashboard queries, and frontend ErrorBoundary.
    - **Advanced Threat Detection (`middleware/security.ts`):** Real-time multi-layer security system including file virus/malware scanning, XSS/injection protection, CSRF protection, IP blacklisting, AES-256-GCM data encryption, and security event monitoring.
    - **Security API (`/api/security/*`):** Admin-only endpoints for dashboard, events, stats, blacklist management, manual file scanning, and health checks.
    - **Security Monitor UI:** A real-time security panel in settings for threat stats, protection status, recent events, and IP blacklist management.
- **Sophie IA Elite Phone Agent (`routes/calls.ts`):** Advanced AI receptionist with: deep memory (10 recent calls + messages + upcoming events + open tasks), automatic language detection (fr/en/tr/de/es/ar), emotional intelligence with 5-level sentiment analysis, crisis management with 3-tier escalation urgency, negotiation & cross-selling capabilities, proactive insights based on client history, key information extraction (name/email/budget/deadline/needs), satisfaction scoring (0-10), 16+ intent categories, smart appointment scheduling (business hours/weekends/holidays), and enhanced fallback mode. Uses Gemini 2.5 Flash with thinkingConfig for deeper reasoning.
- **Features:** Core modules (Dashboard, Call, Contact, Task, Message Management), advanced AI (Incoming Call Overlay with AI Call Processor, AI Phone Agent "Sophie," AI Stock Management, Automation Engine), productivity tools (Software Integrations with AI Smart Discovery, Analytics, Phone Simulator, Auto-Backup), business workflow (Prospects Pipeline/Kanban CRM, Devis with line items/TVA, Factures Client with payment tracking, Projets with progress/budget tracking, Agenda), team performance analytics, advanced calendar, global search, Command Palette (Ctrl+K), Notifications Center, theme toggle, CSV export, and admin audit log.
- **New Modules (DB + API + Frontend):**
    - **Prospects (Pipeline CRM):** Kanban board with 7 stages (nouveau→gagne/perdu), list view, stats dashboard (pipeline value, win rate, weighted value), full CRUD with probability/priority/source tracking.
    - **Devis (Quotes):** Auto-referenced (DEV-YYYY-NNNN), line items with quantity/unit price/TVA calculation, status workflow (brouillon→envoye→accepte/refuse/expire), conversion rate stats.
    - **Factures Client (Invoices):** Auto-referenced (FAC-YYYY-NNNN), payment tracking with progress bars, overdue detection, line items with TVA, status workflow (brouillon→envoyee→payee/partielle/annulee).
    - **Projets (Project Management):** Card grid with progress bars, budget/spent tracking, milestone support, team members, date tracking with overdue detection.
    - **Command Palette:** Ctrl+K shortcut, keyboard navigation (arrows/enter/escape), search across all 22+ navigation commands, grouped by category.
    - **Notifications Center:** Full page with read/unread filtering, mark all read, type-specific icons/colors, relative timestamps.
- **Mathematical Engine (AI-Integrated):** Full math sub-component detection and analysis system integrated into Sophie AI assistant. Features: arithmetic, percentage, power/root, logarithm, trigonometry (degrees), statistics (mean/sum), financial (HT/TTC/TVA/margin), unit conversion, geometry (area/perimeter), ratio/proportion, comparison, fraction, date calculation. Each expression is decomposed into sub-components with step-by-step resolution. Engine results are authoritative (override LLM output). Dedicated API at `/api/math/*` (detect, analyze, evaluate, capabilities). Frontend `MathResultsPanel` renders expandable sub-components with type icons and step-by-step display in the AI chat.
- **Google Workspace Hub:** Centralized dashboard for 14 Google services (Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts, Tasks, Keep, Photos, YouTube, Meet, Chat, Forms) with category filtering, search, connection status, and stats.
- **Google Workspace OAuth Integration:** Full OAuth2 flow for credential management, dynamic authorization, and token handling.
- **Google Agenda → Pointage Sync:** API endpoint and UI for syncing Google Calendar events with check-in records. A background service (`google-auto-pointage.ts`) runs every 30 minutes to auto-create check-in records from Google Calendar events for configured users.
- **Usage-Based Billing System:** Integrated into the Organisations/Licence management area, featuring forfait-linked invoicing with automatic overage calculation, usage snapshots, a dedicated "Facturation" tab, per-organization billing details, bank statement import, and automatic payment matching.
- **Legal Compliance System:** Full legal rights management in a "Juridique" tab for Super Admins. Tracks 7 legal documents (CGU, CGV, RGPD, DPA, SLA, Propriete Intellectuelle, Securite) with per-organization compliance tracking, a compliance dashboard, document detail dialogs, and a legal document catalog.
- **Google Drive Secure Backup:** Encrypted backup service that uploads full database exports to Google Drive. Features AES-256-GCM encryption, full database export of 16 tables, `.adb.enc` envelope format, automatic scheduling, Google Drive folder management with retention policies, and a frontend UI in settings.

# External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI Services:** Gemini AI, OpenAI GPT-5.2, Anthropic Claude Sonnet 4.6
- **API Framework:** Express 5
- **Frontend Libraries:** React, Vite, Tailwind CSS, shadcn/ui, Recharts, framer-motion
- **Validation:** Zod, drizzle-zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Security Middleware:** Helmet
- **Logging:** Pino
- **Google Workspace Services:** Gmail, Calendar, Drive
- **Microsoft 365 Services:** Outlook, Teams, OneDrive
- **Apple/iCloud Services:** iCloud Mail, Calendrier iCloud, iCloud Drive
- **Third-party Business Software Integrations:** Salesforce, HubSpot, Pipedrive, Slack, Microsoft Teams, Zoom, Trello, Asana, Notion, Jira, Sage, QuickBooks, DocuSign, Dropbox, Mailchimp, Brevo, Zapier, Make, Intercom, Zendesk.