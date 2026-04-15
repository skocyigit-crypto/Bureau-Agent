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
The application features a French UI with a deep navy and warm amber color scheme, built using `shadcn/ui` and `Recharts` for a modern, responsive experience.

## Technical Implementations
- **Backend:** Express 5, PostgreSQL, Drizzle ORM, Zod for validation, Orval for API codegen, and `esbuild` for CJS bundling.
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui, and Recharts.
- **AI Integration:** Leverages Gemini, OpenAI, and Anthropic for analytics, contextual suggestions, form validation, Q&A assistance, pattern recognition, email drafting, smart discovery, and an "Intelligence Centrale / Assistant Executif" for specialized tasks.
- **AI Assistant ULTRA:** The AI chat assistant has full operational control with real-time access to all data and 28 executable actions.
- **Multi-Agent AI System:** Ten specialist agents cover various office roles, generating scored reports with deep data analysis, orchestrated by a "Super Agent IA" using Gemini, OpenAI GPT-5.2, and Anthropic Claude Sonnet 4.6.
- **Oto-Pilot IA (Self-Improving Auto-Pilot):** Autonomous AI system for continuous platform monitoring, diagnosis, and auto-correction.
- **Authentication & User Management:** Database-backed system with bcryptjs, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout.
- **Email Invitation System:** Admin-initiated user invitations with 72-hour expiry, cryptographic tokens, license limit enforcement, and role assignment. Professional HTML email via Gmail/Resend.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables ensure tenant isolation with `organisation_id` foreign keys and `requireTenant` middleware.
- **Organisation & License Management:** Super Admin interface for full CRUD on client organizations, license key generation, subscriptions, and onboarding. Includes a customer self-service "Mon Abonnement" page.
- **Mobile App (Expo):** A full-featured companion mobile app with complete feature parity for key modules.
- **PWA Install:** The application is installable as a Progressive Web App with offline capabilities.
- **Email System:** Primarily uses the Gmail API via Replit Google Mail connector, with SMTP as a fallback.
- **Security Hardening (9-Layer Protection):** Global `requireAuth` and `requireTenant` middleware, Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, structured error handling, mutex locks for AI processing, and advanced threat detection.
- **Sophie IA Elite Phone Agent:** Advanced AI receptionist with deep memory, automatic language detection, emotional intelligence, crisis management, negotiation & cross-selling capabilities, proactive insights, and smart appointment scheduling, powered by Gemini 2.5 Flash.
- **User Tracking (created_by/updated_by):** All core entities track user creation and modification, displaying "Cree par" / "Modifie par" with timestamps.
- **Application Resilience System:** Component-level error boundaries (SafeComponent) isolate dashboard widget crashes, NetworkStatusBanner for offline/online detection, SessionExpiredOverlay for session timeout recovery, QueryClient with automatic retry (exponential backoff) and stale time, periodic session health checks every 5 minutes, QueryErrorAlert for user-friendly error states on all pages, graceful server shutdown (SIGTERM/SIGINT) with DB pool cleanup, enhanced global error handler with error type classification, enriched /healthz endpoint with DB status/uptime/memory, and defensive null checks throughout the frontend.
- **Core Features:** Dashboard, Call, Contact, Task, Message Management, AI-driven automation, Command Palette, Notifications Center, and team performance analytics.
- **Prospect Calendar Sync:** Auto-discovers available calendars for team members, offering a real-time availability grid and direct RDV scheduling with sync to internal and Google Calendars.
- **Smart Browser System (15+ Capabilities):** Comprehensive browser intelligence layer including network status, battery monitoring, page visibility, speech recognition, smart keyboard shortcuts, clipboard intelligence, and push notifications.
- **Premium Device-Aware Experience:** Full device environment detection (iOS/Android/Mac/Windows, standalone PWA, screen class, connection tier, input mode, notch detection, pixel density). Page transition animations via Framer Motion AnimatePresence. Stagger-animated KPI cards, PressableCard with spring physics, HapticButton with device vibration. Safe-area CSS for notched phones, standalone PWA mode styles, thin scrollbars, glass effects, premium shadows. Connection quality + device type indicator in header. Touch-optimized targets on mobile (44px min). CSS keyframes: shimmer, glow-pulse. Utility classes: `.glass-effect`, `.premium-shadow`, `.premium-shadow-hover`, `.animate-shimmer`, `.animate-glow`, `.safe-area-*`. Respects `prefers-reduced-motion`.
- **Mathematical Engine (AI-Integrated):** Full math sub-component detection and analysis system integrated into Sophie AI assistant.
- **Google Workspace Hub & OAuth Integration:** Centralized dashboard for 14 Google services with full OAuth2 flow for credential management and Google Agenda → Pointage Sync.
- **Usage-Based Billing System:** Integrated into Organisations/Licence management, featuring forfait-linked invoicing with automatic overage calculation.
- **Legal Compliance System:** Full legal rights management in a "Juridique" tab for Super Admins, tracking legal documents with per-organization compliance.
- **Google Drive Secure Backup & Restore System:** Enterprise-grade backup system for 29 critical tables with AES-256-GCM encryption, auto-scheduling, 90-day retention, and full restore capabilities.
- **Document IA (AI Document Processor):** Intelligent document analysis and routing system that analyzes uploaded documents, extracts data, and recommends/executes actions. Supports PDF, images, Excel (.xlsx/.xls), Word (.docx), CSV, PowerPoint (.pptx), and text files up to 25MB.
- **Universal Document Management System:** Centralized document storage with entity linking (contacts, tasks, messages, invoices, etc.). Features: drag-drop upload, multi-file batch upload (up to 20), AI-powered analysis, download, search/filter by module and category, per-entity document panels, and storage stats dashboard. Backend routes at `/api/documents/*`. Reusable `FileUpload` and `DocumentsPanel` React components. DB table `documents` with full-text search indexes.
- **AI Intelligent Import System:** Smart document-to-data pipeline. Upload any file (Excel, CSV, Word, PDF) → AI reads and extracts structured rows → shows "what I understood" confirmation with per-row validation/error/duplicate detection → user approves → AI writes data to target module (Contacts, Tasks). Endpoints: `POST /api/documents/process` (AI extraction with MIME/size/scan validation), `POST /api/documents/import` (write to module with server-side field validation, 500-row limit, sanitization). Frontend at `/import`.
- **Navigation Safety:** Sidebar active state uses `startsWith` for sub-route highlighting. CentralIntelligence links validated against `VALID_ROUTES` list to prevent 404s from removed modules.
- **Notification Preferences Persistence:** Settings notification tab uses localStorage with `agent-bureau-notif-prefs` key. All 6 toggle switches are state-managed with a "Save" button. Preferences survive page refresh.
- **Comprehensive Error Handling:** Calendar mutations (create/update/delete) have `res.ok` guards, success toasts, and `onError` callbacks. Checkins mutations (checkout, pause, resume, delete) have `onError` handlers. Analytics AI analysis fetch includes `credentials: "include"`. Calendar events query surfaces errors via toast on `isError`. ContactAutocomplete has `res.ok` check.
- **Auto Bank/Payment/Invoice System:** Organisations configure bank details. Payment recording endpoint auto-updates invoice status, generates professional HTML invoices, auto-sends via Resend email.
- **Customer Account Health System (Comptes Clients):** Automated financial health monitoring for all customer accounts. Includes health score, risk classification, aging analysis, credit limit enforcement, payment terms, automatic payment reminder emails, and internal notifications.
- **Data Protection Monitor (Automated):** Background service that monitors backup status, detects issues, and escalates critical issues to super admins.
- **AI SUPREME (43 Actions — Superhuman):** Ultra-powerful AI assistant with 43 executable action types including core operations, financial intelligence, strategic intelligence, and autonomous chained actions.
- **App Update Management System:** Complete release management for SaaS customers with versioning, classification, changelog, force-update, and dismiss options.
- **License Management & Billing Dashboard:** Admin-only page with comprehensive license security, payment tracking, and invoice management.
- **AI Auto-Fix Engine:** Automated correction endpoint for orphan call linking, overdue task escalation, duplicate contact detection, auto-categorization, and negative stock correction.
- **CRM Lead Scoring & Follow-up System:** AI-powered lead scoring based on contact data, pipeline stage, value, and priority. Customer journey timeline with call history. Follow-up reminders that auto-create tasks. Built-in email templates.
- **Invoice Multi-Currency & Late Fees:** Currency conversion for 8 currencies. Automatic late fee calculation per French law (10% annual rate + 40EUR fixed indemnity).
- **Predictive Analytics Dashboard:** Linear regression-based forecasting for calls, tasks, contacts, and revenue. 5-week trend charts with next-week predictions. AI-generated insights based on trend analysis.
- **Mobile Theme System:** Dark/Light/System theme toggle in Settings.
- **Mobile Screens:** Dedicated mobile screens for Prospects CRM, Invoices, Projects, and AI Chat Assistant.
- **Voice Command System ("Hey Bureau") — AI-Powered:** Full voice assistant with wake word detection for both web and mobile. API endpoint at `/api/voice/command` with AI-powered intent parsing via Gemini. Supports 15 intents and unknown commands get natural AI conversational responses.
- **AI Anomaly Detection:** Proactive anomaly detection across all systems, checking 11 anomaly types with suggested actions.
- **AI Predictive Intelligence:** Forecasting engine using historical data to generate weekly forecasts, operational risks, opportunities, and strategic recommendations.
- **AI Agents Background Processing:** AI agent routes use background processing to avoid HTTP timeouts, with immediate responses and asynchronous processing.
- **Face Recognition System (Mobile + API):** AI-powered face recognition for office security. Mobile screen with camera access, face scanning, profile registration, contact linking, recognition history, and stats dashboard. Backend API with multi-AI analysis, mood detection, personalized greetings, security level assessment, and suggested actions.
- **AI Commandant Engine (23 Capabilities):** Comprehensive AI orchestration engine with multi-provider fallback. Includes 20 API endpoints covering smart call response, call compilation, auto-task/appointment creation, email smart reply/compilation, overdue task/invoice reminders, meeting compilation, AI text analysis (6 modes), natural language command execution (`/commandant/execute-command`), weekly digest generation (`/commandant/weekly-digest`), and contact health scoring (`/commandant/contact-health/:id`).
- **AI Agent Collaboration System:** Inter-agent intelligence with trend tracking (last 5 scores per agent), decay/improvement detection, 8+ cross-agent issue patterns (cascade, correlation, systemic), parallel insight fetching, collaboration dashboard (`/ai/collaboration/dashboard`), agent trend history (`/ai/collaboration/agent-trends/:agentId`), and enriched matrix with trend data.
- **AI Agent Resilience:** 3-provider retry/fallback chain (Gemini → OpenAI → Anthropic) for individual agents, parallel batch execution (batches of 3), and trend-aware prompts that feed historical score data into agent analysis.
- **Multi-Provider Telephony System:** Enterprise telephony integration supporting 6 providers (Twilio, Vonage, Telnyx, Plivo, Sinch, Bandwidth). Features: provider CRUD with per-tenant isolation, make-call and send-SMS via any configured provider, call/SMS logging, webhook endpoints, provider testing, statistics dashboard. Web UI at `/telephonie` and mobile screen.

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
- **Telephony Providers:** Twilio, Vonage, Telnyx, Plivo, Sinch, Bandwidth