---
name: At-rest secret encryption
description: Canonical module + key-management policy for encrypting persisted secrets (webhook signing secrets, outbound API keys, integration secrets).
---

# At-rest secret encryption

All persisted secrets must be wrapped through the canonical AES-256-GCM helper
(`encryptSensitiveData` / `decryptSensitiveData` / `isEncrypted`). `security.ts`
re-exports it for back-compat — there is exactly ONE implementation, do not add
a second.

**Why:** there used to be two divergent crypto helpers (a strong PBKDF2-salted
one and a weak unsalted-sha256 one in `google-auth.ts`). Both were dead code, so
consolidation was risk-free. A single hardened helper prevents a future caller
from accidentally picking the weak path.

**Key management policy:** decryption key resolves to `DATA_ENCRYPTION_KEY`. In
production a dedicated stable key is REQUIRED — the helper throws if it is
missing rather than falling back to `SESSION_SECRET`. Falling back would couple
long-lived secret decryption to session-secret rotation, silently bricking every
stored secret on the next rotation. Outside production it falls back to
`SESSION_SECRET` for convenience.

**Format:** `enc:v1:` + base64(`salt(32) | iv(16) | authTag(16) | ciphertext`).
Decrypt is tolerant (returns non-`enc:v1:` input unchanged) to allow gradual
migration of any legacy plaintext. Empty-string plaintext is valid and must stay
round-trippable (min-payload check excludes the ciphertext byte).

**How to apply:** when persisting any new secret (Faz 1 webhook/API-key engine,
integration `connect` configs that are currently discarded), encrypt on write,
decrypt on read, never log the plaintext. The weak `google-auth.ts`
`encryptSecret/decryptSecret` is dead BYOC-revert code — leave its format
untouched (changing it would break any legacy stored blob); do not route new
code through it.
