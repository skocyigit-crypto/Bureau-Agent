# Workspace

## Overview

This project is a pnpm workspace monorepo using TypeScript, designed to be a comprehensive French-language office/bureau agent application called "Agent de Bureau." Its primary purpose is to manage phone calls, contacts, tasks, and messages for businesses. The application aims to streamline office operations, enhance productivity, and provide insightful analytics through advanced AI integration.

The project includes a robust backend API, a React-based frontend with a distinctive French UI (deep navy and warm amber accents), and a separate promotional landing page. Key capabilities include:
- Full-featured management of calls, contacts, tasks, and messages.
- Extensive AI integration for analysis, suggestions, validation, and a global AI assistant.
- Integration with 21 popular business software across various categories.
- Comprehensive analytics powered by Gemini AI, offering actionable insights.
- A multi-agent AI system for specialized domain analysis and a Super Agent IA for cross-analysis.
- Advanced security features and robust user management with role-based permissions.
- Multi-device compatibility and Google Workspace integration.

The business vision is to provide a premium, efficient, and intelligent office management solution tailored for French-speaking markets, leveraging cutting-edge AI to automate and optimize daily administrative tasks.

## User Preferences

I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the folder `/tanitim/`.
Do not make changes to the file `pnpm-workspace.yaml`.

## System Architecture

The project is structured as a pnpm workspace monorepo, utilizing Node.js 24 and TypeScript 5.9.

**UI/UX Decisions:**
The application's UI is entirely in French (France), featuring a deep navy sidebar and warm amber accents to create a professional yet inviting aesthetic. The design emphasizes clarity, ease of navigation, and intuitive workflows. Components like `shadcn/ui` and `Recharts` are used for a modern and responsive user experience.

**Technical Implementations:**
- **Backend:** Built with Express 5, using PostgreSQL as the database and Drizzle ORM for database interactions. Zod is used for schema validation. API codegen is handled by Orval from an OpenAPI specification. `esbuild` is used for CJS bundling.
- **Frontend:** Developed with React, Vite, Tailwind CSS, shadcn/ui, and Recharts.
- **AI Integration:** Leverages Gemini AI via Replit AI Integrations for various functionalities:
    - **Analytics:** `POST /ai/analyze` for structured insights.
    - **Contextual Suggestions:** `POST /ai/suggest` for page-level recommendations.
    - **Form Validation:** `POST /ai/validate` for AI-powered pre-submission checks, including duplicate detection.
    - **Q&A Assistant:** `POST /ai/assistant` for natural language queries with real-time database context.
    - **Pattern Recognition:** `POST /ai/recognize` for cross-entity detection and health scores.
    - **Email Drafting:** `POST /ai/draft-email` for AI-powered email generation with context.
- **Multi-Agent AI System:** Comprises 7 specialist agents (Calls, Contacts, Tasks, Messages, Attendance, Security, Performance) that generate scored reports. A "Super Agent IA" orchestrates these reports for a unified action plan. This system can run automatically at configurable intervals.
- **User Management:** A robust role-based access control system with four tiers: Super Admin, Administrateur, Agent, and Lecture seule (Read-only). Features include Google Workspace user identification, seat-based licensing, and comprehensive user management functionalities.
- **Security Hardening:** Implements Helmet for security headers, rate limiting, strict CORS policies, HPP protection, Zod-based input validation, Drizzle ORM for SQL injection prevention, and structured error handling.
- **Features:**
    - **Dashboard:** KPI cards, weekly stats, performance charts, task completion, top contacts, activity feed.
    - **Call Management:** Full-featured call log with search, filters, bulk actions, CSV export, and AI analysis.
    - **Contact Management:** Professional directory with search, filters, table/grid views, and bulk actions.
    - **Task Management:** Dual view (table/Kanban), filters, bulk actions, and overdue highlighting.
    - **Message Management:** Search, filters, bulk actions, and color-coded badges.
    - **Software Integrations:** Catalog of 21 business software integrations with configuration and AI recommendations.
    - **Analytics:** Comprehensive reports with various charts and Gemini AI insights.
    - **Incoming Call Overlay:** Real-time call handling interface.
    - **Stock Management:** Full inventory management with article CRUD, QR/barcode scanning (camera + manual input), AI-powered PDF import (invoices, delivery notes, catalogs), auto-status calculation (en_stock/stock_faible/rupture), category filters, statistics dashboard.
    - **Settings Page:** Extensive configuration with multi-platform integrations (Google Workspace 26 services, Microsoft 365 19 services, Apple/iCloud 13 services = 58 total), call features, application installation (with interactive phone simulator for mobile app preview, App Store/Google Play download buttons), notifications, and security. Platform switcher UI with search and category filters per ecosystem.
    - **Phone Simulator:** Interactive mobile phone mockup component (`phone-simulator.tsx`) with 6 navigable screens (Accueil, Appels, Contacts, Taches, Messages, Agents IA), phone frame with status bar/nav bar, expandable full-screen dialog mode.
- **Promotional Landing Page (`/tanitim/`):** A separate React+Vite artifact for marketing, featuring deep navy and amber branding, `framer-motion` for animations, AI-generated visuals, and a comprehensive overview of the product.

## Integration Notes
- **Google Drive**: Connector available (`ccfg_google-drive_0F6D7EF5E22543468DB221F94F`) but user has not completed OAuth authorization. Integration is not active. To connect in the future, the user must approve the Google Drive authorization popup when prompted.

## External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI Service:** Gemini AI (via Replit AI Integrations)
- **API Framework:** Express 5
- **Frontend Libraries:** React, Vite, Tailwind CSS, shadcn/ui, Recharts, framer-motion
- **Validation:** Zod, drizzle-zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Security Middleware:** Helmet
- **Logging:** Pino
- **Google Workspace Services (26):** Gmail, Calendar, Drive, Docs, Sheets, Slides, Meet, Chat, Contacts, Tasks, Keep, Forms, Maps, Photos, Analytics, Ads, Search Console, Business Profile, YouTube, Cloud Platform, Voice, Translate, Workspace Admin, Sites, Vault, Classroom.
- **Microsoft 365 Services (19):** Outlook, Teams, OneDrive, Word, Excel, PowerPoint, SharePoint, OneNote, Planner, Power Automate, Power BI, Dynamics 365, Intune, Defender, Entra ID, Forms, Bookings, Viva Engage, 365 Admin.
- **Apple/iCloud Services (13):** iCloud Mail, Calendrier iCloud, iCloud Drive, Contacts iCloud, Pages, Numbers, Keynote, FaceTime, iMessage, Notes, Rappels, Localiser, Apple Business Manager.
- **Third-party Business Software Integrations (21):** Salesforce, HubSpot, Pipedrive, Slack, Microsoft Teams, Zoom, Trello, Asana, Notion, Jira, Sage, QuickBooks, DocuSign, Dropbox, Outlook, Mailchimp, Brevo, Zapier, Make, Intercom, Zendesk.