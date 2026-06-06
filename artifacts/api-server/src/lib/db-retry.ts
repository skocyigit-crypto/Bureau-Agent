import { logger } from "./logger";

// Erreurs de connexion PG transitoires qu'il est sûr de réessayer : connexion
// fermée par un Postgres serverless (Neon) au repos, coupure réseau d'un
// middlebox, ou pool sous pression qui n'arrive pas à ouvrir une connexion à
// temps. On NE réessaie PAS les erreurs SQL (contrainte, syntaxe, timeout de
// requête) — seulement l'établissement/la perte de la connexion elle-même.
const TRANSIENT_MESSAGE_PATTERNS = [
  "connection terminated",
  "connection terminated unexpectedly",
  "timeout exceeded when trying to connect",
  "terminating connection due to",
  "server closed the connection",
  "connection refused",
  "read econnreset",
];

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08006", // connection_failure
  "08003", // connection_does_not_exist
  "08001", // sqlclient_unable_to_establish_sqlconnection
]);

function isTransient(err: unknown): boolean {
  const e = err as { message?: unknown; code?: unknown; cause?: unknown } | null;
  if (!e) return false;
  const code = typeof e.code === "string" ? e.code.toUpperCase() : "";
  if (code && TRANSIENT_CODES.has(code)) return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (TRANSIENT_MESSAGE_PATTERNS.some((p) => msg.includes(p))) return true;
  // Drizzle enveloppe l'erreur pg ; la cause porte souvent le vrai code/message.
  if (e.cause && e.cause !== e) return isTransient(e.cause);
  return false;
}

export interface DbRetryOptions {
  /** Nombre total de tentatives, première incluse. Défaut 3. */
  attempts?: number;
  /** Backoff de base en ms (exponentiel + jitter). Défaut 250. */
  baseDelayMs?: number;
  /** Étiquette pour les logs. */
  label?: string;
}

/**
 * Exécute une opération DB en la réessayant UNIQUEMENT sur des erreurs de
 * connexion transitoires. À réserver aux opérations idempotentes (lectures,
 * counts) : un INSERT/UPDATE non idempotent ne doit pas être enveloppé ici.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: DbRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 250;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransient(err)) throw err;
      const delay = base * 2 ** i + Math.floor(Math.random() * 100);
      logger.warn(
        { err, attempt: i + 1, attempts, label: opts.label },
        "[db-retry] erreur de connexion transitoire — nouvelle tentative",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
