# Overview

"Agent de Bureau" is a TypeScript-based pnpm monorepo for a French-language office agent application. Its core purpose is to centralize and manage phone calls, contacts, tasks, and messages for businesses, significantly boosting productivity through advanced AI integration and comprehensive analytics. The application features full-featured management modules, extensive AI capabilities for analysis, suggestions, and validation, and a multi-agent AI system. The vision is to deliver a premium, intelligent office management solution tailored for French-speaking markets, leveraging cutting-edge AI to automate and optimize daily administrative tasks.

# User Preferences

I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the folder `/tanitim/`.
Do not make changes to the file `pnpm-workspace.yaml`.

# Portable Deployment (off-Replit)

The app is portable beyond Replit. Migration assets live under `deploy/` plus `MIGRATION.md` (Turkish step-by-step guide):
- `deploy/Dockerfile.api`, `deploy/Dockerfile.web`, `deploy/docker-compose.yml`, `deploy/Caddyfile` — single-command Docker Compose stack (Postgres + API + Caddy reverse proxy with automatic Let's Encrypt TLS).
- `deploy/.env.example` — full env template (DATABASE_URL, SESSION/JWT secrets, GEMINI/OPENAI/ANTHROPIC keys, Resend, Twilio, Google OAuth).
- `deploy/scripts/export-from-replit.sh` + `deploy/scripts/restore-on-new-server.sh` — pg_dump/restore helpers.
- `deploy/non-docker/` — alternative install (PM2 + nginx + native Postgres) for environments without Docker.

The AI integration clients in `lib/integrations-{gemini,openai,anthropic}-ai/src/client.ts` accept either Replit AI proxy env vars (`AI_INTEGRATIONS_*_BASE_URL` / `_API_KEY`) OR direct provider API keys (`GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`), so the same code runs both on Replit and self-hosted.

Excluded from portable build: `mockup-sandbox` (Replit canvas tool), `mobile` (Expo dev), `tanitim` (vitrine site) — these stay Replit-side.

# System Architecture

The project is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9.

## UI/UX Decisions
The application features a French UI with a deep navy and warm amber color scheme, built using `shadcn/ui` and `Recharts` for a modern, responsive experience. It also provides a premium device-aware experience with device environment detection, page transition animations, haptic feedback, safe-area CSS, and theme toggling (Dark/Light/System). The application is installable as a Progressive Web App (PWA) with offline capabilities.

## Technical Implementations
- **Backend:** Express 5, PostgreSQL, Drizzle ORM, Zod for validation, Orval for API codegen, and `esbuild` for CJS bundling.
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui, and Recharts.
- **AI Integration:** Leverages Gemini 2.5 Pro, OpenAI, and Anthropic for analytics, contextual suggestions, form validation, Q&A assistance, pattern recognition, email drafting, smart discovery, and an "Intelligence Centrale / Assistant Executif" for specialized tasks. Features a multi-agent AI system with ten specialist agents and an "Oto-Pilot IA" for continuous platform monitoring. AI cost and usage are tracked per organization, with quota enforcement and warning notifications. All AI routes enforce per-org quotas.
- **Authentication & User Management:** Database-backed system with bcryptjs, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout. Features an admin-initiated email invitation system and a password reset flow.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables ensure tenant isolation with `organisation_id` foreign keys and `requireTenant` middleware. Includes a Super Admin interface for client organization and license management, and a comprehensive Tenant Guard Security Layer for abuse prevention.
- **Daily Digest:** AI-powered daily work summary per user, gathering user-scoped data and generating an AI-briefing with mood, productivity score, strengths, suggestions, and priorities.
- **Mobile App:** A full-featured companion Expo mobile app with privacy protection features including background shield, auto-lock, PIN lock, biometric unlock, sensitive data masking, and manual lock. It provides comprehensive CRUD and detail views for all core modules (Contacts, Tasks, Calls, Prospects, Devis, Factures, Stock, Projets, etc.) with feature parity, offline capabilities, and context-aware quick actions.
- **Email System:** Uses Gmail API primarily, with SMTP as a fallback.
- **Security Hardening:** Global `requireAuth` and `requireTenant` middleware, Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, structured error handling, mutex locks for AI processing, advanced threat detection, and Guardian WAF for comprehensive traffic inspection and behavioral profiling. Column projection security is enforced for sensitive data like `passwordHash`. Search terms are sanitized globally.
- **Application Resilience System:** Component-level error boundaries, network status detection, session expiration recovery, QueryClient with automatic retry and stale time, periodic session health checks, user-friendly error states, graceful server shutdown, enhanced global error handler, and defensive null checks. Comprehensive error handling is implemented across frontend and backend.
- **Core Features:** Dashboard, Call, Contact, Task, Message Management, AI-driven automation, Command Palette, Notifications Center, team performance analytics, and a mathematical engine.
- **Prospect Calendar Sync:** Auto-discovers available calendars for team members, offering a real-time availability grid and direct scheduling.
- **Smart Browser System:** Comprehensive browser intelligence layer including network status, battery monitoring, page visibility, speech recognition, smart keyboard shortcuts, clipboard intelligence, and push notifications.
- **Google Workspace Hub & OAuth Integration:** Centralized dashboard for 14 Google services with full OAuth2 flow.
- **Usage-Based Billing System:** Integrated into Organizations/License management with forfait-linked invoicing and automatic overage calculation.
- **Legal Compliance System:** Full legal rights management in a "Juridique" tab for Super Admins, tracking legal documents with per-organization compliance. Includes GDPR compliance system for data subject requests.
- **Google Drive Secure Backup & Restore System:** Enterprise-grade backup system for 29 critical tables with AES-256-GCM encryption, auto-scheduling, and 90-day retention.
- **Document IA (AI Document Processor):** Intelligent document analysis and routing system that analyzes uploaded documents, extracts data, and recommends/executes actions. Supports various file formats.
- **Universal Document Management System:** Centralized document storage with entity linking, drag-drop/batch upload, AI-powered analysis, download, search/filter, and per-entity document panels.
- **AI Intelligent Import System:** Smart document-to-data pipeline for extracting structured data from various file types and importing it into target modules.
- **Voice Command System ("Hey Bureau"):** Full AI-powered voice assistant with wake word detection for web and mobile, supporting 15 intents.
- **AI Anomaly Detection:** Proactive anomaly detection across all systems, checking 11 anomaly types with suggested actions.
- **AI Predictive Intelligence:** Forecasting engine using historical data to generate weekly forecasts, operational risks, opportunities, and strategic recommendations.
- **AI Agents Background Processing:** AI agent routes use background processing to avoid HTTP timeouts, with immediate responses and asynchronous processing.
- **Face Recognition System (Mobile + API):** AI-powered face recognition for office security, including mobile scanning, profile registration, contact linking, and a backend API with multi-AI analysis, mood detection, and security assessment.
- **AI Commandant Engine:** Comprehensive AI orchestration engine with multi-provider fallback, covering smart call response, compilation, auto-task/appointment creation, email smart reply/compilation, overdue reminders, meeting compilation, AI text analysis, natural language command execution, weekly digest generation, and contact health scoring. AI Commandant prompt sanitization is applied.
- **AI Agent Collaboration System:** Inter-agent intelligence with trend tracking, decay/improvement detection, cross-agent issue patterns, parallel insight fetching, and collaboration dashboard.
- **Multi-Provider Telephony System:** Enterprise telephony integration supporting 6 providers with CRUD, make-call/send-SMS functionality, call/SMS logging, webhooks, and testing. Includes Twilio TwiML Inbound Voice for an AI receptionist.
- **Automation Rule Execution Engine:** Executes rules based on trigger types (schedule, missed call, no activity, overdue task) and performs actions like sending notifications, creating tasks, or sending SMS/emails.
- **Auto Bank/Payment/Invoice System:** Configurable bank details, payment recording endpoint, professional HTML invoices, and auto-sending via email. Includes multi-currency and late fee calculation.
- **Customer Account Health System:** Automated financial health monitoring with health score, risk classification, aging analysis, credit limit enforcement, payment terms, and automated reminders.
- **Data Protection Monitor:** Background service monitoring backup status, detecting issues, and escalating critical issues.
- **AI SUPREME:** Ultra-powerful AI assistant with 43 executable action types, including core operations, financial intelligence, strategic intelligence, and autonomous chained actions.
- **App Update Management System:** Complete release management for SaaS customers with versioning, changelog, force-update, and dismiss options.
- **License Management & Billing Dashboard:** Admin-only page with comprehensive license security, payment tracking, and invoice management.
- **AI Auto-Fix Engine:** Automated correction endpoint for orphan call linking, overdue task escalation, duplicate contact detection, auto-categorization, and negative stock correction.
- **CRM Lead Scoring & Follow-up System:** AI-powered lead scoring, customer journey timeline, follow-up reminders that auto-create tasks, and built-in email templates.
- **Predictive Analytics Dashboard:** Linear regression-based forecasting for calls, tasks, contacts, and revenue, with trend charts and AI-generated insights.
- **Notification Preferences Persistence:** Notification settings are persisted locally.
- **Pino Structured Logging:** All console calls are replaced with structured pino logging.
- **Nav Sidebar Groups:** 27 flat nav items restructured into 8 logical groups for better organization.
- **Équipe Tab (Settings):** Admin-only tab for team member management, role badges, last access dates, and invitation management.
- **Cookie Consent Banner:** RGPD-compliant sticky banner on the site vitrine.
- **Self-Hosting Migration:** Removed all `@replit/connectors-sdk` dependencies, enabling self-hosting with standard environment variables. Includes deployment artifacts for Nginx, PM2, and Docker.
- **CRM & Commercial Modules:** Comprehensive modules for Prospects/Pipeline CRM, Stock/Inventaire, Devis, and Factures Client, all with multi-tenant isolation, CRUD, pagination, search/filter, stats endpoints, CSV export, email sending, duplication, and print/preview pages. Also includes a Purchase Order module for suppliers and a Client Account Summary.
- **Global Search Extended:** Search now covers 9 entity types: contacts, appels, tâches, messages, prospects, devis, factures, stock, and commandes.
- **Dashboard Notifications Enhanced:** Includes overdue invoices and low/zero stock alerts.
- **Rapport Commercial:** Full commercial analytics page with various charts and KPIs.
- **Relances Clients:** Page aggregating all overdue invoices with urgency badges and relance options.
- **Objectifs Commerciaux:** CRUD page for commercial targets with progress bars.
- **Notes Internes:** Sticky-note style internal notes with color coding, pin/unpin, tags, and inline editing.
- **Projets:** Full project management module with grid/kanban views, stats cards, milestones, tags, and deep integration across all reporting surfaces. Quick-create project buttons are integrated throughout the application.
- **Real-Time Sync (SSE):** `broadcaster.ts` provides in-memory org-scoped broadcasting for SSE streams, with `autoBroadcast` middleware triggering updates after successful mutations. Frontend `use-realtime-sync.ts` hook handles SSE connections and invalidates React Query keys.
- **Integration Auto-Discovery:** `GET /api/discovery/scan` checks the status of 10 connectable services, and the frontend `IntegrationDiscovery` component provides a UI for managing connections.

# External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI Services:** Gemini AI, OpenAI, Anthropic
- **API Framework:** Express
- **Frontend Libraries:** React, Vite, Tailwind CSS, shadcn/ui, Recharts, framer-motion
- **Validation:** Zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Security Middleware:** Helmet
- **Google Workspace Services:** Gmail, Calendar, Drive
- **Telephony Providers:** Twilio, Vonage, Telnyx, Plivo, Sinch, Bandwidth
- **Email Sending:** Resend (via API for automations and invoices)
- **Deployment Tools:** Nginx, PM2, Docker (for self-hosting)