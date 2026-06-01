# Agent de Bureau

A TypeScript monorepo for a French-language office agent application that centralizes and manages phone calls, contacts, tasks, and messages for businesses using advanced AI.

## Run & Operate

To run the application, ensure the following environment variables are set (see `deploy/.env.example` for a full list):

- `DATABASE_URL`
- `SESSION_SECRET`
- `JWT_SECRET`
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (or Replit AI proxy vars)
- `RESEND_API_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `VIRUSTOTAL_API_KEY` (optional — real malware engine for file scanning; falls back to heuristics if absent), `GOOGLE_SAFE_BROWSING_API_KEY` (optional — URL threat lookup)
- `VIRUSTOTAL_SUBMIT_FILES` (optional, opt-in `=1` — when a hash lookup is "unknown", upload the file contents to VirusTotal to catch zero-day malware; off by default since the file leaves the server. `VIRUSTOTAL_MAX_UPLOAD_BYTES`, `VIRUSTOTAL_SUBMIT_TIMEOUT_MS` tune size cap / poll budget)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_{STARTER,PROFESSIONNEL,ENTREPRISE}`

Key commands:

- `pnpm install`
- `pnpm dev` (for local development)
- `pnpm build` (build all packages)
- `pnpm typecheck`
- `pnpm codegen` (API client generation)
- `pnpm db:push` (apply Drizzle schema changes)

## Stack

- **Frameworks**: Express 5 (backend), React, Vite (frontend)
- **Runtime**: Node.js 24, TypeScript 5.9
- **ORM**: Drizzle ORM
- **Validation**: Zod
- **Build Tool**: esbuild
- **UI**: Tailwind CSS, shadcn/ui, Recharts
- **AI**: Gemini 2.5 Pro, OpenAI, Anthropic
- **Database**: PostgreSQL

## Where things live

- `/apps/api`: Backend services and API definitions
- `/apps/web`: Frontend application
- `/apps/mobile`: Expo mobile application
- `/packages/lib`: Shared utilities and AI integration clients
- `/deploy`: Docker, Docker Compose, Caddy, and deployment scripts
- `drizzle/schema.ts`: Database schema definition
- `orval.config.ts`: API client generation configuration
- `tailwind.config.ts`: Tailwind CSS configuration

## Architecture decisions

- **Two-layer product (since Tâche #52)**: l'application est désormais découpée en deux couches.
  - **Couche client** (organisations payantes — KOBİ patron) : Aujourd'hui, Communication, Contacts,
    Tâches, Documents, Assistants IA, Analyse, Intégrations. Centrée sur l'usage quotidien d'un
    secrétariat IA. Pas de modules commerciaux.
  - **Couche backoffice SaaS** (`/admin`, super-admin uniquement — Serkan) : Prospects (leads),
    Devis kurumsal, Factures B2B, Stock de licences, dashboard MRR/churn. Sépare la gestion
    commerciale du SaaS du produit vendu aux clients. Garde côté frontend (sidebar + page guards) ;
    bascule complète des routes API vers `requireSuperAdmin` traitée dans les tâches de suivi.
- **Multi-Tenant Isolation**: Implemented `organisation_id` foreign keys and `requireTenant` middleware for strict data separation.
- **Multi-Provider AI & Telephony**: Abstracted AI and telephony integrations to support multiple providers, allowing flexibility and fallback mechanisms.
- **Background Processing for AI**: AI agent routes utilize background processing to prevent HTTP timeouts and provide immediate user feedback for long-running AI tasks.
- **Real-time Updates with SSE**: Uses Server-Sent Events (SSE) for real-time, organization-scoped updates across the application.
- **Portable Deployment**: Designed for portability beyond Replit, with deployment assets for Docker, PM2, and Nginx, and flexible AI client configuration.

## Product

Agent de Bureau offers comprehensive office management with AI-powered features:

- Centralized management for phone calls, contacts, tasks, and messages.
- Advanced AI for analytics, contextual suggestions, form validation, Q&A, email drafting, and a multi-agent system ("Intelligence Centrale").
- Full-featured companion mobile app with offline capabilities and privacy features.
- Multi-tenant architecture with robust authentication, role-based access, and client organization management.
- Google Workspace integration (Gmail, Calendar, Drive) and Google OAuth.
- Stripe-integrated SaaS subscription and usage-based billing system.
- Document management with AI analysis, intelligent import, and secure backup.
- Voice command system ("Hey Bureau") and AI anomaly detection.
- Project management (côté client). Modules commerciaux (Prospects, Stock, Devis, Factures B2B)
  déplacés dans le backoffice SaaS `/admin` (super-admin uniquement) — voir la décision
  d'architecture "Two-layer product" ci-dessus.
- Real-time sync, predictive analytics, and automated action engines.

## User preferences

I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the file `pnpm-workspace.yaml`.
The marketing site (`/tanitim/`) hosts a public AI demo and must stay aligned with the
in-app assistant — it can be edited freely.

## Gotchas

- **AI Quotas**: All AI routes enforce per-organization quotas. Ensure sufficient quota is available before extensive AI usage.
- **Stripe Webhook**: The Stripe webhook (`/api/stripe/webhook`) requires a RAW body parser and must be mounted before `express.json()`.
- **Tenant Guard Security**: Be mindful of the Tenant Guard Security Layer when making changes related to multi-tenancy.
- **Deployment-Specific Configurations**: AI integrations can use either Replit AI proxy environment variables or direct provider API keys; ensure correct configuration for the deployment environment.

### Faux positifs "l'app ne marche pas" — checklist avant de paniquer

L'utilisateur a deja signale plusieurs fois que "rien ne marche" alors que
tout fonctionnait. Avant de toucher au code, verifier dans cet ordre:

1. **`/api/auth/me` -> 401** dans la console est ATTENDU pour un visiteur
   anonyme (sonde de session). Ce n'est PAS une erreur.
2. **Mobile preview "ecran blanc" au premier chargement**: le bundle Metro
   met ~13s a se compiler la premiere fois. Recharger apres ~15s, ou
   capturer directement `/login` au lieu de `/` (la redirection passe par
   un loader sur fond clair quasi invisible).
3. **`screenshot` tool sur tanitim**: NE PAS passer `path="/tanitim/"` —
   le tool ajoute deja le prefix de l'artefact. Utiliser `path="/"`,
   sinon URL devient `/tanitim/tanitim/` -> 404 (false positive).
4. **Permissions-Policy**: utiliser uniquement les directives reconnues
   par Chromium courant. Liste autorisee dans `api-server/src/app.ts`,
   `buro-ajani/vite.config.ts`, `tanitim/vite.config.ts` (commentaires
   en tete). NE PAS reintroduire ambient-light-sensor, battery,
   document-domain, execution-while-not-rendered/out-of-viewport,
   navigation-override, web-share -> warnings console inutiles.
5. **Smoke obligatoire avant de declarer un bug**: lancer
   `curl -s -o /dev/null -w "%{http_code}\n" localhost:80{/api/healthz,/,/tanitim/}`
   et ouvrir Expo via `https://$REPLIT_EXPO_DEV_DOMAIN/`. Si tout est
   200 + body > 1KB, le serveur va bien et le probleme est cosmetique.

## Pointers

- **Drizzle ORM Documentation**: _Populate as you build_
- **Zod Documentation**: _Populate as you build_
- **Orval Documentation**: _Populate as you build_
- **Stripe API Documentation**: _Populate as you build_
- **Twilio API Documentation**: _Populate as you build_
- **Google Workspace API Docs**: _Populate as you build_
- **MIGRATION.md**: Step-by-step guide for self-hosting (in Turkish).