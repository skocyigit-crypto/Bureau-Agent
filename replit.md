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
- **Core Features:** Dashboard, Call, Contact, Task, Message Management, AI-driven automation, Command Palette, Notifications Center, and team performance analytics.
- **Prospect Calendar Sync:** Auto-discovers available calendars for team members, offering a real-time availability grid and direct RDV scheduling with sync to internal and Google Calendars.
- **Smart Browser System (15+ Capabilities):** Comprehensive browser intelligence layer including network status, battery monitoring, page visibility, speech recognition, smart keyboard shortcuts, clipboard intelligence, and push notifications.
- **Mathematical Engine (AI-Integrated):** Full math sub-component detection and analysis system integrated into Sophie AI assistant.
- **Google Workspace Hub & OAuth Integration:** Centralized dashboard for 14 Google services with full OAuth2 flow for credential management and Google Agenda → Pointage Sync.
- **Usage-Based Billing System:** Integrated into Organisations/Licence management, featuring forfait-linked invoicing with automatic overage calculation.
- **Legal Compliance System:** Full legal rights management in a "Juridique" tab for Super Admins, tracking legal documents with per-organization compliance.
- **Google Drive Secure Backup & Restore System:** Enterprise-grade backup system for 29 critical tables with AES-256-GCM encryption, auto-scheduling, 90-day retention, and full restore capabilities.
- **Document IA (AI Document Processor):** Intelligent document analysis and routing system that analyzes uploaded documents, extracts data, and recommends/executes actions.
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
- **AI Commandant Engine (20 Capabilities):** Comprehensive AI orchestration engine with multi-provider fallback. Includes 17 API endpoints covering smart call response, call compilation, auto-task/appointment creation, email smart reply/compilation, overdue task/invoice reminders, meeting compilation, and AI text analysis (6 modes).
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