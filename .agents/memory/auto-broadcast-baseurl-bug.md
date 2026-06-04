---
name: auto-broadcast path matching
description: why SSE/mobile-notif/webhook fan-out silently dies for resources matched by URL path
---

The auto-broadcast middleware matches mutating requests against URL-path
regexes (e.g. `/^\/api\/contacts$/`) to decide what to broadcast over SSE,
push to mobile, and fan out to webhooks.

**Pitfall:** the API router is mounted at `app.use("/api", router)`, so inside
a handler `req.path` is the path *relative to the mount* (`/contacts`), NOT the
full `/api/contacts`. Matching `req.path` against `/^\/api\/...$/` therefore
never matches and the whole broadcast path goes silently dead for every
auto-broadcast-only resource (contacts/calls/tasks/messages/prospects/projets/notes).

**Rule:** reconstruct the full path with `` `${req.baseUrl}${req.path}` `` (or
match against the mount-relative path consistently). It fails silently — no
error, just no realtime/notif/webhook — so it won't show up in logs.
