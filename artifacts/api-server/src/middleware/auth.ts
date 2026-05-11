import type { Request, Response, NextFunction } from "express";
import { extractBearerToken, verifyApiToken } from "../lib/api-token";

/**
 * Hydrate `req.session` a partir d'un Bearer token HMAC valide.
 * Pas d'effet si la session est deja peuplee (cookie classique) ou si
 * aucun token n'est present. Ne persiste rien — le token reste stateless.
 *
 * Apres cette etape, les routes en aval lisent `req.session.userId`,
 * `req.session.userRole`, etc. de la meme maniere que pour le flux
 * cookie, ce qui evite tout fork des controleurs existants.
 */
function hydrateFromBearer(req: Request): void {
  if (req.session?.userId) return;
  const token = extractBearerToken(req.get("authorization"));
  if (!token) return;
  const payload = verifyApiToken(token);
  if (!payload) return;
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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  hydrateFromBearer(req);
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

  return (req: Request, res: Response, next: NextFunction): void => {
    hydrateFromBearer(req);
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
