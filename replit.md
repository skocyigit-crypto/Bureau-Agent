# Workspace

## Overview

This project is a pnpm workspace monorepo using TypeScript, designed as a comprehensive French-language office/bureau agent application called "Agent de Bureau." Its core purpose is to centralize and manage phone calls, contacts, tasks, and messages for businesses, aiming to enhance productivity and provide advanced analytics through integrated AI.

Key features include full-featured management modules, extensive AI integration for analysis, suggestions, validation, and a multi-agent AI system, comprehensive analytics powered by Gemini AI, and integration with 21 popular business software solutions. The application also supports PWA capabilities and a companion native mobile app (Expo).

The business vision is to deliver a premium, intelligent office management solution tailored for French-speaking markets, leveraging cutting-edge AI to automate and optimize daily administrative tasks.

## User Preferences

I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the folder `/tanitim/`.
Do not make changes to the file `pnpm-workspace.yaml`.

## System Architecture

The project is structured as a pnpm workspace monorepo, utilizing Node.js 24 and TypeScript 5.9.

**UI/UX Decisions:**
The application features a French UI with a deep navy and warm amber aesthetic, emphasizing clarity and intuitive workflows. `shadcn/ui` and `Recharts` are used for a modern, responsive experience. A centralized `Icon3D` component provides CSS-based 3D icons with customizable colors and sizes for consistent branding across the application.

**Technical Implementations:**
- **Backend:** Developed with Express 5, PostgreSQL, and Drizzle ORM. Zod is used for schema validation, and Orval handles API codegen from an OpenAPI specification. `esbuild` is used for CJS bundling.
- **Frontend:** Built with React, Vite, Tailwind CSS, shadcn/ui, and Recharts.
- **AI Integration:** Leverages Gemini, OpenAI, and Anthropic via Replit AI Integrations for:
    - **Analytics:** Structured insights.
    - **Contextual Suggestions:** Page-level recommendations.
    - **Form Validation:** AI-powered pre-submission checks.
    - **Q&A Assistant:** Natural language queries with database context.
    - **Pattern Recognition:** Cross-entity detection and health scores.
    - **Email Drafting:** AI-powered email generation.
    - **Smart Discovery:** Personalized AI analysis for integration recommendations.
    - **Intelligence Centrale / Assistant Executif:** An executive assistant for specific roles, offering crisis management (RECONNAISSANCE IA), communication drafting (COMMUNICATION), logistics management (LOGISTIQUE), and fiscal alerts (FISCAL & FLASH).
- **Multi-Agent AI System:** Seven specialist agents generate scored reports via Gemini, orchestrated by a "Super Agent IA" using Gemini, OpenAI GPT-5.2, and Anthropic Claude Sonnet 4.6 for comprehensive analysis, verification, and strategic recommendations.
- **Authentication & User Management:** Database-backed system with bcryptjs hashing, PostgreSQL session store, cookie-based sessions, role-based access (Super Admin, Administrateur, Agent, Lecture seule), and account lockout mechanisms.
- **Security Hardening:** Implements Helmet, rate limiting, strict CORS, HPP protection, Zod validation, Drizzle ORM, and structured error handling.
- **Features:**
    - **Core Modules:** Dashboard, Call Management, Contact Management, Task Management, Message Management.
    - **Advanced AI:** Incoming Call Overlay with AI Call Processor (appointment/task creation, sentiment analysis), AI-powered Stock Management (QR/barcode scanning, PDF import, auto-status), and Automation Engine (task/event reminders, inactive contact detection).
    - **Productivity Tools:** Software Integrations catalog, comprehensive Analytics, Settings page with multi-platform integrations (Google Workspace, Microsoft 365, Apple/iCloud), Phone Simulator for mobile preview, and Auto-Backup System to multiple destinations.
    - **Business Workflow (CRM / Gestion):** Modules for Prospects, Devis (quotes with line-item editor and automatic follow-up actions), Factures (invoicing), Chantiers (job site management), and Agenda (appointments).
    - **Utilities:** Calendar Module, Global Search, Theme Toggle (dark/light mode), CSV Export Menu, and an Admin-only Audit Log.
    - **Visuals:** Real Photo Banners integrated across all pages with gradient overlays.
- **Google Workspace OAuth Integration:** Full OAuth2 flow enabling Super Admin credential management, dynamic authorization URL generation, token handling, and self-service configuration.

## External Dependencies

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
- **Google Workspace Services:** Gmail, Calendar, Drive, Docs, Sheets, Meet, Chat, Contacts, Tasks, etc. (26 services)
- **Microsoft 365 Services:** Outlook, Teams, OneDrive, Word, Excel, PowerPoint, SharePoint, etc. (19 services)
- **Apple/iCloud Services:** iCloud Mail, Calendrier iCloud, iCloud Drive, Contacts iCloud, FaceTime, iMessage, etc. (13 services)
- **Third-party Business Software Integrations:** Salesforce, HubSpot, Pipedrive, Slack, Microsoft Teams, Zoom, Trello, Asana, Notion, Jira, Sage, QuickBooks, DocuSign, Dropbox, Mailchimp, Brevo, Zapier, Make, Intercom, Zendesk (21 services)