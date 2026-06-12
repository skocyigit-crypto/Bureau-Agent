---
name: buro-ajani public (unauthenticated) routes
description: How to add a page reachable without login in the buro-ajani SPA
---

The buro-ajani React app gates ALL routes behind auth state in `App.tsx`. A plain
`<Route>` inside `AppRoutes` is never reached by an anonymous visitor — the app
renders the LoginPage instead before `AppRoutes` mounts.

**Rule:** to expose a public page (no login), add a `window.location.pathname`
regex check in the top-level `App` component and return a self-contained tree
(`ErrorBoundary > QueryClientProvider > TooltipProvider > WouterRouter base={basePath}`)
BEFORE the auth-state branches — exactly like `isInvitationPath`. Then the page can
use `useRoute("/your/:token")` for params.

**Why:** the invitation-accept flow and the appointment-offer (`/rdv/:token`) public
booking page both need to work for logged-out external recipients of an email/SMS link.

**How to apply:** mirror the `isInvitationPath` block; the matching backend route must
also be mounted before `requireAuth` (token acts as the capability — no tenant scope).
