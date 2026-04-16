# Overview

"Agent de Bureau" is a TypeScript-based pnpm monorepo for a French-language office agent application. Its core purpose is to centralize and manage phone calls, contacts, tasks, and messages for businesses, significantly boosting productivity through advanced AI integration and comprehensive analytics. The application features full-featured management modules, extensive AI capabilities for analysis, suggestions, and validation, and a multi-agent AI system. The vision is to deliver a premium, intelligent office management solution tailored for French-speaking markets, leveraging cutting-edge AI to automate and optimize daily administrative tasks.

# User Preferences

I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the folder `/tanitim/`.
Do not make changes to the file `pnpm-workspace.yaml`.

# System Architecture

The project is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9.

## UI/UX Decisions
The application features a French UI with a deep navy and warm amber color scheme, built using `shadcn/ui` and `Recharts` for a modern, responsive experience. It also provides a premium device-aware experience with device environment detection, page transition animations, haptic feedback, safe-area CSS, and theme toggling (Dark/Light/System). The application is installable as a Progressive Web App (PWA) with offline capabilities.

## Technical Implementations
- **Backend:** Express 5, PostgreSQL, Drizzle ORM, Zod for validation, Orval for API codegen, and `esbuild` for CJS bundling.
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui, and Recharts.
- **AI Integration:** Leverages Gemini, OpenAI, and Anthropic for analytics, contextual suggestions, form validation, Q&A assistance, pattern recognition, email drafting, smart discovery, and an "Intelligence Centrale / Assistant Executif" for specialized tasks.
- **Multi-Agent AI System:** Ten specialist agents cover various office roles, generating scored reports, orchestrated by a "Super Agent IA." Includes an "Oto-Pilot IA" for continuous platform monitoring and auto-correction.
- **Authentication & User Management:** Database-backed system with bcryptjs, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout. Features an admin-initiated email invitation system with cryptographic tokens and license limit enforcement.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables ensure tenant isolation with `organisation_id` foreign keys and `requireTenant` middleware. Super Admin interface for full CRUD on client organizations and license management.
- **Mobile App:** A full-featured companion Expo mobile app with complete feature parity for key modules.
- **Email System:** Primarily uses the Gmail API via Replit Google Mail connector, with SMTP as a fallback.
- **Security Hardening:** Global `requireAuth` and `requireTenant` middleware, Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, structured error handling, mutex locks for AI processing, and advanced threat detection.
- **Sophie IA Elite Phone Agent:** Advanced AI receptionist with deep memory, automatic language detection, emotional intelligence, crisis management, negotiation & cross-selling capabilities, proactive insights, and smart appointment scheduling.
- **User Tracking:** All core entities track user creation and modification with "Cree par" / "Modifie par" and timestamps.
- **Application Resilience System:** Component-level error boundaries, network status detection, session expiration recovery, QueryClient with automatic retry and stale time, periodic session health checks, user-friendly error states, graceful server shutdown, enhanced global error handler, and defensive null checks.
- **Core Features:** Dashboard, Call, Contact, Task, Message Management, AI-driven automation, Command Palette, Notifications Center, and team performance analytics.
- **Prospect Calendar Sync:** Auto-discovers available calendars for team members, offering a real-time availability grid and direct scheduling with sync to internal and Google Calendars.
- **Smart Browser System:** Comprehensive browser intelligence layer including network status, battery monitoring, page visibility, speech recognition, smart keyboard shortcuts, clipboard intelligence, and push notifications.
- **Mathematical Engine:** Full math sub-component detection and analysis system integrated into Sophie AI assistant.
- **Google Workspace Hub & OAuth Integration:** Centralized dashboard for 14 Google services with full OAuth2 flow.
- **Usage-Based Billing System:** Integrated into Organisations/Licence management with forfait-linked invoicing and automatic overage calculation.
- **Legal Compliance System:** Full legal rights management in a "Juridique" tab for Super Admins, tracking legal documents with per-organization compliance.
- **Google Drive Secure Backup & Restore System:** Enterprise-grade backup system for 29 critical tables with AES-256-GCM encryption, auto-scheduling, 90-day retention, and full restore capabilities.
- **Document IA (AI Document Processor):** Intelligent document analysis and routing system that analyzes uploaded documents, extracts data, and recommends/executes actions. Supports PDF, images, Excel, Word, CSV, PowerPoint, and text files.
- **Universal Document Management System:** Centralized document storage with entity linking, drag-drop/batch upload, AI-powered analysis, download, search/filter, per-entity document panels, and storage stats.
- **AI Intelligent Import System:** Smart document-to-data pipeline for extracting structured data from various file types and importing it into target modules (Contacts, Tasks) with user confirmation and validation.
- **Voice Command System ("Hey Bureau"):** Full AI-powered voice assistant with wake word detection for web and mobile, supporting 15 intents.
- **AI Anomaly Detection:** Proactive anomaly detection across all systems, checking 11 anomaly types with suggested actions.
- **AI Predictive Intelligence:** Forecasting engine using historical data to generate weekly forecasts, operational risks, opportunities, and strategic recommendations.
- **AI Agents Background Processing:** AI agent routes use background processing to avoid HTTP timeouts, with immediate responses and asynchronous processing.
- **Face Recognition System (Mobile + API):** AI-powered face recognition for office security, including mobile scanning, profile registration, contact linking, and a backend API with multi-AI analysis, mood detection, and security assessment.
- **AI Commandant Engine:** Comprehensive AI orchestration engine with multi-provider fallback, covering smart call response, compilation, auto-task/appointment creation, email smart reply/compilation, overdue task/invoice reminders, meeting compilation, AI text analysis (6 modes), natural language command execution, weekly digest generation, and contact health scoring.
- **AI Agent Collaboration System:** Inter-agent intelligence with trend tracking, decay/improvement detection, cross-agent issue patterns, parallel insight fetching, and collaboration dashboard.
- **AI Agent Resilience:** 3-provider retry/fallback chain (Gemini → OpenAI → Anthropic) for individual agents, parallel batch execution, and trend-aware prompts.
- **Multi-Provider Telephony System:** Enterprise telephony integration supporting 6 providers with CRUD, make-call/send-SMS functionality, call/SMS logging, webhooks, testing, and statistics dashboard.
- **Auto Bank/Payment/Invoice System:** Configurable bank details, payment recording endpoint for invoice status updates, professional HTML invoices, and auto-sending via Resend email.
- **Customer Account Health System:** Automated financial health monitoring with health score, risk classification, aging analysis, credit limit enforcement, payment terms, and automated reminders.
- **Data Protection Monitor:** Background service monitoring backup status, detecting issues, and escalating critical issues.
- **AI SUPREME:** Ultra-powerful AI assistant with 43 executable action types, including core operations, financial intelligence, strategic intelligence, and autonomous chained actions.
- **App Update Management System:** Complete release management for SaaS customers with versioning, changelog, force-update, and dismiss options.
- **License Management & Billing Dashboard:** Admin-only page with comprehensive license security, payment tracking, and invoice management.
- **AI Auto-Fix Engine:** Automated correction endpoint for orphan call linking, overdue task escalation, duplicate contact detection, auto-categorization, and negative stock correction.
- **CRM Lead Scoring & Follow-up System:** AI-powered lead scoring, customer journey timeline, follow-up reminders that auto-create tasks, and built-in email templates.
- **Invoice Multi-Currency & Late Fees:** Currency conversion for 8 currencies and automatic late fee calculation per French law.
- **Predictive Analytics Dashboard:** Linear regression-based forecasting for calls, tasks, contacts, and revenue, with 5-week trend charts and AI-generated insights.
- **Notification Preferences Persistence:** Settings notification tab uses localStorage with `agent-bureau-notif-prefs` key. All 6 toggle switches are state-managed with a save button.
- **Comprehensive Error Handling:** Full error handling across all frontend pages and components — every mutation has `onError` toast handlers, all manual fetch calls have `try/catch` + `!res.ok` guards, no empty catch blocks remain (except intentional browser API fallbacks), all `console.warn` upgraded to `console.error` for proper error logging. Backend: all catch blocks in ai-commandant, ai-agents, workspace, and services have logging. JSON parse fallbacks log warnings.
- **API Client Cookie Auth:** `lib/api-client-react/src/custom-fetch.ts` defaults to `credentials: "include"` so all generated hooks send session cookies automatically.
- **Bulk Operations Authorization:** All bulk operations (`/bulk/*` and `/export/*`) require role-based access control — delete operations require `administrateur` or higher, update operations require `operateur` or higher, data export requires `administrateur` or higher.
- **Platform Connections Atomicity:** `platform_connections` table has unique index on `(platform, service_id)`. Connect/disconnect routes use atomic upsert (`onConflictDoUpdate`) instead of read-then-write to prevent race conditions and duplicate records.
- **Dashboard Memory Leak Prevention:** `useTeamStatus` and `useWeekComparison` hooks use `AbortController` + `mounted` flag to prevent state updates on unmounted components.
- **Search Term Sanitization:** Global search sanitizes LIKE wildcards (`%`, `_`, `\`) to prevent wide pattern matching attacks.
- **Query Parameter Validation:** `admin-reports` status/category/priority fields validated against whitelists; search terms sanitized.
- **Column Projection Security:** All `usersTable` queries that don't need `passwordHash` use explicit column projection (`db.select({ id, email, ... })`). Only `login` and `password-change` routes load `passwordHash` (needed for `bcrypt.compare`). Applied to: `checkins.ts`, `my-subscription.ts`, `ai-analysis.ts`, `auth.ts` (send-credentials).

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