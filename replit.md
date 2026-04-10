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
- **Oto-Pilot IA (Self-Improving Auto-Pilot):** An autonomous AI system that continuously monitors, diagnoses, and auto-corrects the platform.
- **Authentication & User Management:** Database-backed system with bcryptjs, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables ensure tenant isolation. All data tables include an `organisation_id` foreign key, and a `requireTenant` middleware enforces organizational context.
- **Organisation Management (Licence Admin):** A Super Admin-only interface for full CRUD operations on client organizations, including creation with auto-generated license keys, subscriptions, and admin users, with automated onboarding via email.
- **Mobile App (Expo):** A full-featured companion mobile app with complete feature parity for key modules.
- **Admin Reports System:** Organisation administrators can submit reports/requests to the platform super admin via a dedicated API and UI.
- **PWA Install:** The application is installable as a Progressive Web App, with an in-app prompt and full offline capabilities.
- **Onboarding Wizard:** A 4-step first-login configuration wizard for Welcome, App Installation, Integration Discovery, and Ready.
- **Email System:** Primarily uses the Gmail API via Replit Google Mail connector, with SMTP as a fallback.
- **Security Hardening (9-Layer Protection):** Global `requireAuth` and `requireTenant` middleware protect API routes. Implementations include Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, structured error handling, mutex locks for AI processing, session pruning, database indexing, resilient dashboard queries, and frontend ErrorBoundary. Advanced threat detection and a security API/UI are also integrated.
- **Sophie IA Elite Phone Agent:** Advanced AI receptionist with deep memory, automatic language detection, emotional intelligence, crisis management, negotiation & cross-selling capabilities, proactive insights, key information extraction, satisfaction scoring, intent categories, smart appointment scheduling, and enhanced fallback mode. Uses Gemini 2.5 Flash.
- **Features:** Core modules (Dashboard, Call, Contact, Task, Message Management), advanced AI (Incoming Call Overlay with AI Call Processor, AI Phone Agent "Sophie," AI Stock Management, Automation Engine), productivity tools (Software Integrations with AI Smart Discovery, Analytics, Phone Simulator, Auto-Backup), business workflow (Prospects Pipeline/Kanban CRM, Devis, Factures Client, Projets, Agenda), team performance analytics, advanced calendar, global search, Command Palette (Ctrl+K), Notifications Center, theme toggle, CSV export, and admin audit log.
- **New Modules (DB + API + Frontend):** Prospects (Pipeline CRM), Devis (Quotes), Factures Client (Invoices), Projets (Project Management), Command Palette, Notifications Center.
- **Mathematical Engine (AI-Integrated):** Full math sub-component detection and analysis system integrated into Sophie AI assistant, supporting various mathematical operations with step-by-step resolution. Dedicated API and frontend rendering.
- **Google Workspace Hub:** Centralized dashboard for 14 Google services with category filtering, search, connection status, and stats.
- **Google Workspace OAuth Integration:** Full OAuth2 flow for credential management, dynamic authorization, and token handling.
- **Google Agenda → Pointage Sync:** API endpoint and UI for syncing Google Calendar events with check-in records via a background service.
- **Usage-Based Billing System:** Integrated into the Organisations/Licence management area, featuring forfait-linked invoicing with automatic overage calculation, usage snapshots, and payment matching.
- **Legal Compliance System:** Full legal rights management in a "Juridique" tab for Super Admins, tracking 7 legal documents with per-organization compliance tracking and a compliance dashboard.
- **Google Drive Secure Backup & Restore System:** Enterprise-grade backup system for 29 critical tables with AES-256-GCM encryption, auto-scheduling, 90-day retention, full restore capabilities (including dry-run and selective restore), and a frontend UI.
- **Document IA (AI Document Processor):** Intelligent document analysis and routing system that analyzes uploaded documents (PDF, images), identifies types, extracts data, recommends destination modules, finds related entities, and suggests/executes actions (e.g., create contact, invoice).
- **Data Protection Monitor (Automated):** Background service that runs every 6 hours to monitor backup status for active organizations, detect issues, send in-app notifications, and escalate critical issues to super admins.

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

# Code Architecture Notes

## Settings Page Refactoring
The Settings page (`artifacts/buro-ajani/src/pages/settings.tsx`) was refactored from a single 4,681-line file into a thin shell that imports 7 self-contained tab components from `artifacts/buro-ajani/src/pages/settings/`:
- `tab-abonnement.tsx` — Subscription plans and usage
- `tab-plateformes.tsx` — Google/Microsoft/Apple platform integrations, security workspace (file protection, antivirus, DLP, phishing), sync settings
- `tab-appels.tsx` — Call settings and AI call features
- `tab-sauvegardes.tsx` — Auto-backup, Google Drive backup with verify/restore, data protection monitor
- `tab-installation.tsx` — macOS native app, PWA install, PhoneSimulator
- `tab-notifications.tsx` — Notification toggle preferences
- `tab-securite.tsx` — Security settings with embedded SecurityMonitorPanel

Each tab component is fully self-contained with its own state, API calls, and handlers. OAuth callback handling (google_success/google_error URL params) is processed at the parent shell level.

## AI Chat Assistant (Interactive Q&A)
POST `/api/ai/chat` — Interactive AI assistant with full real-time data access. Accepts `{message, context, history}`, queries all DB tables for current stats (calls, contacts, tasks, messages), and returns structured JSON with `{message, actions[], insights[], mood, stats}`. Actions support types: `auto_fix`, `navigate` (allowlisted relative paths only), `reminder`. Frontend: floating chat panel in `ai-assistant.tsx` with action buttons, mood indicators, and conversation history.

## AI Auto-Fix Engine
POST `/api/ai/agents/auto-fix` — Automated correction endpoint (admin only). Performs: orphan call linking by phone number, overdue task escalation to high priority, stuck task notifications, stale message alerts, incomplete contact flagging. All fixes logged to `audit_logs` table. Returns `{totalFixes, fixes[]}`.

## AI Predictive Intelligence
GET `/api/ai/predictions` — Forecasting engine using 4 weeks of historical data. Gemini analyzes call volume trends, task completion velocity, contact growth, and customer satisfaction to generate: weekly forecasts (per-day predictions with alert levels), operational risks with mitigation strategies, opportunities, and strategic recommendations. Frontend: "Predictions IA" tab on AI agents page with visual cards and daily forecast grid.

## AI Agents Background Processing
The AI agent routes (`/api/ai/agents/run` and `/api/ai/autopilot/run`) use background processing to avoid HTTP timeouts. They respond immediately with `{ status: "started" }` and process AI calls asynchronously. The frontend polls `/api/ai/agents/run/status` every 3 seconds to track progress (completedAgents/totalAgents). Both routes have in-flight guards to prevent duplicate concurrent executions per organization. The mobile app uses `useRef`-based polling with 5-minute timeout cap and proper unmount cleanup.

## Database Performance
24 indexes added across all major tables on frequently queried columns: `createdAt`, `organisationId`, `status`, `read`, `type`, `priority`. FK columns added to `notifications`, `daily_reports`, and `google_oauth_tokens` tables for `organisation_id`.

## Structured Logging
API server uses Pino structured logger (`lib/logger`) for all error handling in critical routes (AI agents, autopilot, document AI, security). Format: `logger.error({ err, context }, "message")`.

## Security Middleware Notes
- Command injection patterns are checked on URL **path only** (not query string) to avoid false positives from `&` query parameter separators.
- Command injection patterns are additionally checked on **parsed query values** via `detectThreatInValue`, so malicious payloads like `$(id)` or `foo;bar` in query values are still detected.