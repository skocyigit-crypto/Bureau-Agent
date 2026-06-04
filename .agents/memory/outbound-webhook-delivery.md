---
name: Outbound webhook delivery constraints
description: Security/reliability invariants for delivering webhooks to tenant-supplied URLs
---

Delivering HTTP webhooks to URLs a tenant controls has three non-obvious invariants. Violating any one looks fine in unit tests but fails in production or opens a hole.

1. **SSRF: validate the target on EVERY attempt, with DNS resolution.** A literal-host blocklist is not enough — a public hostname can resolve to a private IP. Resolve the host and reject if any resolved address is loopback/private/link-local/metadata (169.254.169.254)/CGNAT/ULA. Reuse the shared guard `assertSafePublicUrl` (`api-server/src/lib/ssrf-guard.ts`). A blocked URL is a TERMINAL failure (no retry — it will never become valid).
   **Why:** without this, a tenant registers `http://169.254.169.254/...` and turns the server into an internal-network prober.

2. **Sign with a PER-ATTEMPT timestamp, not the event's business time.** Stripe-style receivers reject timestamps older than ±5 min (anti-replay). If you sign `${event.created}.${body}` once, every retry after backoff is rejected by a healthy endpoint. Compute `nowSec` fresh on each attempt for both the signature input and the `x-webhook-timestamp` header; keep `payload.created` as event time only. Idempotency across retries is the stable `x-webhook-id` (delivery eventId), not the timestamp.

3. **Failure-count / circuit-breaker updates must be ATOMIC SQL.** Read-modify-write from an in-memory endpoint snapshot loses increments under concurrent deliveries to the same endpoint, so the breaker trips late or never. Use `failure_count = failure_count + 1` plus a `CASE WHEN failure_count + 1 >= threshold THEN false ELSE active END` in one UPDATE ... RETURNING.

**How to apply:** any new outbound-delivery path (webhooks, callbacks, push to customer URLs) in this repo must go through `assertSafePublicUrl` and follow 2 & 3. Single-process/mono-instance assumption is documented in `webhook-service.ts`; DNS-rebinding (IP changes between resolve and fetch) is the accepted residual gap absent IP pinning.
