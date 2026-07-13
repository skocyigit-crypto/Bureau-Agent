import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { extractBearerToken, verifyApiToken } from "../lib/api-token";
import { authenticateApiKey, looksLikeApiKey } from "../lib/api-key-auth";
import { logTenantViolation } from "./tenant-guard";

/**
 * Cache court (60s) du plancher d'invalidation par utilisateur. Sans
 * cache, chaque requete Bearer ajoute un round-trip Postgres juste pour
 * lire `users.token_invalidated_at`, ce qui doublerait la latence des
 * endpoints les plus chauds (calls/contacts/tasks). 60s est court devant
 * la duree de vie d'un token (30j) et d'une compromission realiste, et
 * couvre l'effet de pic d'une requete de changement de mot de passe.
 *
 * Sentinelle `null` = utilisateur n'a jamais invalide ses tokens.
 * Sentinelle `undefined` = pas en cache.
 */
const invalidationCache = new Map<number, { value: number | null; fetchedAt: number }>();
const INVALIDATION_TTL_MS = 60 * 1000;
const INVALIDATION_CACHE_MAX = 10_000;

async function getTokenInvalidatedAt(userId: number): Promise<number | null> {
  const now = Date.now();
  const cached = invalidationCache.get(userId);
  if (cached && now - cached.fetchedAt < INVALIDATION_TTL_MS) return cached.value;
  // GC opportuniste pour borner la map. Une expulsion FIFO suffit, on ne
  // cherche pas d'eviction LRU exacte ici.
  if (invalidationCache.size > INVALIDATION_CACHE_MAX) {
    const cutoff = now - INVALIDATION_TTL_MS;
    for (const [k, v] of invalidationCache) if (v.fetchedAt < cutoff) invalidationCache.delete(k);
  }
  const [row] = await db
    .select({ tokenInvalidatedAt: usersTable.tokenInvalidatedAt, actif: usersTable.actif })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  // Compte inactif/supprime: traiter comme une invalidation "infinie"
  // pour rejeter le token sans 2e requete cote middleware.
  if (!row || !row.actif) {
    invalidationCache.set(userId, { value: Number.POSITIVE_INFINITY, fetchedAt: now });
    return Number.POSITIVE_INFINITY;
  }
  const value = row.tokenInvalidatedAt ? new Date(row.tokenInvalidatedAt).getTime() : null;
  invalidationCache.set(userId, { value, fetchedAt: now });
  return value;
}

/** Vide l'entree cache pour `userId` apres un changement de mot de passe. */
export function clearTokenInvalidationCache(userId: number): void {
  invalidationCache.delete(userId);
}

/**
 * Hydrate `req.session` a partir d'un Bearer token HMAC valide.
 * Pas d'effet si la session est deja peuplee (cookie classique) ou si
 * aucun token n'est present. Ne persiste rien — le token reste stateless.
 *
 * Apres cette etape, les routes en aval lisent `req.session.userId`,
 * `req.session.userRole`, etc. de la meme maniere que pour le flux
 * cookie, ce qui evite tout fork des controleurs existants.
 *
 * Verifie aussi le plancher `users.token_invalidated_at`: tout token
 * dont `iat < tokenInvalidatedAt` est rejete, meme si la signature
 * HMAC est valide. C'est la voie de revocation pour les tokens
 * stateless long-lived.
 */
export async function hydrateFromBearer(req: Request): Promise<void> {
  if (req.session?.userId) return;
  const token = extractBearerToken(req.get("authorization"));
  if (!token) return;

  // Voie 1 : clé API entrante (programmatique). Authentifie AU NOM du
  // créateur de la clé ; on n'essaie pas le HMAC stateless dans ce cas.
  if (looksLikeApiKey(token)) {
    const apiCtx = await authenticateApiKey(token);
    if (!apiCtx) return;
    const s = req.session as unknown as Record<string, unknown>;
    s.userId = apiCtx.userId;
    s.userRole = apiCtx.userRole;
    s.organisationId = apiCtx.organisationId;
    s.userEmail = apiCtx.userEmail;
    s.prenom = apiCtx.prenom;
    s.nom = apiCtx.nom;
    return;
  }

  // Voie 2 : token HMAC stateless (mobile / web).
  const payload = verifyApiToken(token);
  if (!payload) return;

  const invAt = await getTokenInvalidatedAt(payload.userId);
  if (invAt !== null && payload.iat < invAt) return;

  // express-session expose req.session comme un objet mutable; assigner
  // les champs sans appeler session.save() le maintient en memoire pour
  // la duree de la requete uniquement (comportement stateless souhaite).
  const s = req.session as unknown as Record<string, unknown>;
  s.userId = payload.userId;
  s.userRole = payload.userRole;
  s.organisationId = payload.organisationId;
  s.userEmail = payload.userEmail;
  s.prenom = payload.prenom;
  s.nom = payload.nom;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  await hydrateFromBearer(req);
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Non authentifie. Veuillez vous connecter." });
    return;
  }
  next();
}

const ROLE_HIERARCHY: Record<string, number> = {
  lecture_seule: 1,
  agent: 2,
  administrateur: 3,
  super_admin: 4,
};

function userHasAccess(userRole: string | undefined, requiredRoles: string[]): boolean {
  if (!userRole) return false;
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  if (userLevel === 0) return false;
  // Hierarchical access: user passes if their level meets or exceeds the
  // LOWEST listed required role. Callers must pass a contiguous chain
  // starting from the highest role they want to allow (e.g.
  // requireRole("super_admin", "administrateur", "agent") = "agent or higher").
  const minRequiredLevel = Math.min(
    ...requiredRoles.map(r => ROLE_HIERARCHY[r] ?? Infinity)
  );
  return userLevel >= minRequiredLevel;
}

/**
 * Hierarchical role guard. Pass a contiguous chain of roles from highest
 * to lowest (e.g. `requireRole("super_admin", "administrateur", "agent")`)
 * to allow `agent` and anyone above. Non-contiguous role sets are not
 * supported — they will widen access to any role between the lowest and
 * highest entry. A non-fatal warning is logged in development if a
 * non-contiguous set is detected.
 */
/**
 * Garde dediee au backoffice super-admin (SaaS owner). Equivalent strict de
 * `requireRole("super_admin")` mais expose un nom explicite pour documenter
 * l'intention dans les routes du panneau /admin (Prospects, Devis, Stock,
 * Factures B2B, gestion des licences).
 *
 * IMPORTANT: cette garde NE remplace PAS `requireTenant`. Les routes
 * historiques restent tenant-scoped pour eviter une fuite de donnees
 * pendant la migration progressive vers le backoffice global. Une tache
 * de suivi traitera la bascule complete (donnees tenant -> donnees SaaS
 * globales).
 */
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await hydrateFromBearer(req);
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Non authentifie." });
    return;
  }
  if (req.session?.userRole !== "super_admin") {
    logTenantViolation(req, "require_super_admin", "Attempt to access super-admin-only route");
    res.status(403).json({ error: "Acces reserve au super administrateur." });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  if (process.env.NODE_ENV !== "production" && roles.length > 1) {
    const levels = roles.map(r => ROLE_HIERARCHY[r] ?? -1).filter(l => l > 0);
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    const expectedSize = max - min + 1;
    const uniqueLevels = new Set(levels);
    if (uniqueLevels.size !== expectedSize) {
      // eslint-disable-next-line no-console
      console.warn(
        `[auth.requireRole] Non-contiguous role set detected: [${roles.join(", ")}]. ` +
        `Hierarchical semantics will allow ANY role between the lowest and highest entry. ` +
        `Use a contiguous chain or a single role.`
      );
    }
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await hydrateFromBearer(req);
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "Non authentifie." });
      return;
    }
    const userRole = req.session?.userRole as string | undefined;
    if (!userHasAccess(userRole, roles)) {
      res.status(403).json({ error: "Acces refuse. Permissions insuffisantes." });
      return;
    }
    next();
  };
}
