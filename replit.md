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
- **AI Assistant ULTRA:** The AI chat assistant has full operational control with real-time access to all data and 28 executable actions, including CRUD for tasks/contacts/events/projects/prospects, email sending, calendar scheduling, and report generation.
- **Multi-Agent AI System:** Ten specialist agents cover various office roles, generating scored reports with deep data analysis. A "Super Agent IA" orchestrates these agents using Gemini, OpenAI GPT-5.2, and Anthropic Claude Sonnet 4.6.
- **Oto-Pilot IA (Self-Improving Auto-Pilot):** An autonomous AI system that continuously monitors, diagnoses, and auto-corrects the platform.
- **Authentication & User Management:** Database-backed system with bcryptjs, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout.
- **Multi-Tenant Architecture:** `organisations` and `subscriptions` tables ensure tenant isolation with `organisation_id` foreign keys and `requireTenant` middleware.
- **Organisation & License Management:** Super Admin interface for full CRUD on client organizations, including license key generation, subscriptions, and onboarding. Includes a customer self-service "Mon Abonnement" page for plan management and upgrade requests.
- **Mobile App (Expo):** A full-featured companion mobile app with complete feature parity for key modules.
- **PWA Install:** The application is installable as a Progressive Web App with offline capabilities.
- **Email System:** Primarily uses the Gmail API via Replit Google Mail connector, with SMTP as a fallback.
- **Security Hardening (9-Layer Protection):** Global `requireAuth` and `requireTenant` middleware, Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, structured error handling, mutex locks for AI processing, and advanced threat detection.
- **Sophie IA Elite Phone Agent:** Advanced AI receptionist with deep memory, automatic language detection, emotional intelligence, crisis management, negotiation & cross-selling capabilities, proactive insights, and smart appointment scheduling, powered by Gemini 2.5 Flash.
- **Core Features:** Dashboard, Call, Contact, Task, Message Management, AI-driven automation, Prospects Pipeline/Kanban CRM, Devis, Factures Client, Projets, Command Palette, Notifications Center, and team performance analytics.
- **Prospect Calendar Sync:** Auto-discovers all available calendars for each team member. Real-time availability grid, direct RDV scheduling with automatic sync to internal calendar + Google Calendar. Team availability overview.
- **Smart Browser System (15+ Capabilities):** Comprehensive browser intelligence layer including network status, battery monitoring, page visibility, speech recognition, smart keyboard shortcuts, clipboard intelligence, fullscreen, push notifications, device capability detection, wake lock, geolocation, tab sync, performance monitoring, share API, and print/PDF export.
- **Mathematical Engine (AI-Integrated):** Full math sub-component detection and analysis system integrated into Sophie AI assistant.
- **Google Workspace Hub & OAuth Integration:** Centralized dashboard for 14 Google services with full OAuth2 flow for credential management and Google Agenda → Pointage Sync.
- **Usage-Based Billing System:** Integrated into Organisations/Licence management, featuring forfait-linked invoicing with automatic overage calculation.
- **Legal Compliance System:** Full legal rights management in a "Juridique" tab for Super Admins, tracking 7 legal documents with per-organization compliance.
- **Google Drive Secure Backup & Restore System:** Enterprise-grade backup system for 29 critical tables with AES-256-GCM encryption, auto-scheduling, 90-day retention, and full restore capabilities.
- **Document IA (AI Document Processor):** Intelligent document analysis and routing system that analyzes uploaded documents, extracts data, and recommends/executes actions.
- **Auto Bank/Payment/Invoice System:** Organisations configure bank details. Payment recording endpoint auto-updates invoice status, generates professional HTML invoices, auto-sends via Resend email.
- **Customer Account Health System (Comptes Clients):** Automated financial health monitoring for all customer accounts. Includes health score, risk classification, aging analysis, credit limit enforcement, payment terms, automatic payment reminder emails, and internal notifications.
- **Data Protection Monitor (Automated):** Background service that monitors backup status, detects issues, and escalates critical issues to super admins.
- **AI SUPREME (43 Actions — Superhuman):** Ultra-powerful AI assistant with 43 executable action types including core operations, financial intelligence (invoice creation, payment recording, cash flow/revenue forecasting), strategic intelligence (client 360, daily briefing, meeting prep, risk analysis, performance audit, smart campaigns), and autonomous chained actions.
- **App Update Management System:** Complete release management for SaaS customers. Super admins publish versioned releases with changelog. Customers see smart update banners. Supports versioning, classification, changelog, force-update, and dismiss options.
- **License Management & Billing Dashboard:** Admin-only page with comprehensive license security, payment tracking, and invoice management. Features subscription overview, security alerts, client invoice management with payment reminders, auto-invoice generation, billing settings management, and full audit logging.
- **AI Auto-Fix Engine:** Automated correction endpoint for orphan call linking, overdue task escalation, duplicate contact detection, auto-categorization, and negative stock correction.
- **CRM Lead Scoring & Follow-up System:** AI-powered lead scoring (A-F grades, 0-100 score) based on contact data, pipeline stage, value, and priority. Customer journey timeline with call history. Follow-up reminders that auto-create tasks. Built-in email templates (Introduction, Relance, Proposition, Remerciement). Slide-in detail panel with tabs (Historique, Relance, Email).
- **Invoice Multi-Currency & Late Fees:** Currency conversion for 8 currencies (EUR, USD, GBP, CHF, TRY, CAD, MAD, XOF). Automatic late fee calculation per French law (10% annual rate + 40EUR fixed indemnity). Invoice tools panel accessible from row dropdown.
- **Predictive Analytics Dashboard:** Linear regression-based forecasting for calls, tasks, contacts, and revenue. 5-week trend charts with next-week predictions. AI-generated insights based on trend analysis.
- **Mobile Theme System:** Dark/Light/System theme toggle in Settings. ThemeContext provider synced with useColors hook. Three-button selector (Systeme, Clair, Sombre).
- **Mobile Prospects CRM Screen:** Full pipeline view with stage filters, lead scoring badges (A-F), prospect cards with company/value/priority, search, detail modal with stage timeline and score breakdown.
- **Mobile Invoices Screen:** Invoice list with status badges, payment progress bars, overdue highlighting with days count, amount breakdown, currency support, detail modal with HT/TTC/TVA breakdown.
- **Mobile Projects Screen:** Project cards with progress bars, budget tracking, days remaining, priority/status badges, detail modal with full project info including budget burn rate.
- **Mobile AI Chat Assistant:** Conversational AI interface using smart-search API. Welcome message, quick action buttons (Briefing, Analyse clients, Performance, Risques, Suggestions, Recherche), message bubbles with timestamps, typing indicator.
- **Enhanced Mobile Dashboard:** Revenue summary card (encaisse/impaye/en retard), project status banner, updated quick access grid (CRM, Factures, Projets), dual AI cards (Assistant IA + Agents IA).
- **Mobile Navigation Enhancement:** "Plus" menu reorganized with COMMERCIAL section (Prospection CRM, Factures, Projets), AI section includes Assistant IA chat and Assistant Vocal.
- **Voice Command System ("Hey Bureau"):** Full voice assistant with wake word detection for both web and mobile. API endpoint at `/api/voice/command` (POST) with 16 intents: daily briefing, count calls/tasks/contacts, invoice status, recent calls, urgent tasks, create task, call contact, search, calendar, prospects/projects/stock summary, performance, and help. Web floating widget (bottom-left, VoiceAssistant.tsx) uses Web Speech API for speech-to-text and SpeechSynthesis for text-to-speech. Mobile screen (`voice-assistant.tsx`) with chat-style interface, tap-to-speak, and command quick list. Route mapping ensures API navigation keys work with French-slug web routes.
- **AI Anomaly Detection:** Proactive anomaly detection across all systems, checking 11 anomaly types with suggested actions.
- **AI Predictive Intelligence:** Forecasting engine using historical data to generate weekly forecasts, operational risks, opportunities, and strategic recommendations.
- **AI Agents Background Processing:** AI agent routes use background processing to avoid HTTP timeouts, with immediate responses and asynchronous processing.
- **Face Recognition System (Mobile + API):** AI-powered face recognition for office security. Mobile screen with camera access, face scanning, profile registration, contact linking, recognition history, and stats dashboard. Backend API with multi-AI analysis, mood detection, personalized greetings, security level assessment, and suggested actions.
- **AI Commandant Engine (20 Capabilities):** Comprehensive AI orchestration engine with multi-provider fallback. Includes 17 API endpoints covering smart call response, call compilation, auto-task/appointment creation, email smart reply/compilation, overdue task/invoice reminders, meeting compilation, photo+GPS location, employee statistics, payment/invoice overview, Google Drive file sending, attachment saving, daily AI briefing, task reminder emails, AI-powered cross-module smart search, and AI text analysis (6 modes).
- **Multi-Provider Telephony System:** Enterprise telephony integration supporting 6 providers (Twilio, Vonage, Telnyx, Plivo, Sinch, Bandwidth). Features: provider CRUD with per-tenant isolation, make-call and send-SMS via any configured provider, call/SMS logging, webhook endpoints (unauthenticated for external provider callbacks), provider testing, statistics dashboard. Web UI at `/telephonie` with tabs for Providers, Call, SMS, History, Stats. Mobile screen with call/SMS + native fallback. DB tables: `telephony_providers`, `telephony_call_logs`, `telephony_sms_logs`.

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