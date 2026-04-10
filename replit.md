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
- **Mathematical Engine (AI-Integrated):** Full math sub-component detection and analysis system integrated into Sophie AI assistant, supporting various mathematical operations.
- **Google Workspace Hub & OAuth Integration:** Centralized dashboard for 14 Google services with full OAuth2 flow for credential management and Google Agenda → Pointage Sync.
- **Usage-Based Billing System:** Integrated into the Organisations/Licence management, featuring forfait-linked invoicing with automatic overage calculation.
- **Legal Compliance System:** Full legal rights management in a "Juridique" tab for Super Admins, tracking 7 legal documents with per-organization compliance.
- **Google Drive Secure Backup & Restore System:** Enterprise-grade backup system for 29 critical tables with AES-256-GCM encryption, auto-scheduling, 90-day retention, and full restore capabilities.
- **Document IA (AI Document Processor):** Intelligent document analysis and routing system that analyzes uploaded documents, extracts data, and recommends/executes actions.
- **Auto Bank/Payment/Invoice System:** Configurable bank details, payment recording, automatic invoice generation (HTML), and auto-sending via Resend email.
- **Data Protection Monitor (Automated):** Background service that monitors backup status, detects issues, and escalates critical issues to super admins.
- **AI Chat Assistant (Interactive Q&A + Command Execution):** Interactive AI assistant with full real-time data access and action execution powers. Supports 11 action types for tasks, contacts, messages, stock, and navigation.
- **AI Command Execution Engine:** Direct action execution from AI assistant supporting creation, completion, escalation, and notification actions.
- **AI Auto-Fix Engine:** Automated correction endpoint for orphan call linking, overdue task escalation, duplicate contact detection, auto-categorization, and negative stock correction.
- **AI Anomaly Detection:** Proactive anomaly detection across all systems, checking 11 anomaly types with suggested actions.
- **AI Predictive Intelligence:** Forecasting engine using historical data to generate weekly forecasts, operational risks, opportunities, and strategic recommendations.
- **AI Agents Background Processing:** AI agent routes use background processing to avoid HTTP timeouts, with immediate responses and asynchronous processing.

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